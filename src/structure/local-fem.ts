/** Small-strain orthotropic CST plane-stress specimens, SI units. No failure criterion. */
export type LocalSettings = {
  kind: "hole" | "tenon" | "plain";
  mode: "traction" | "pin";
  width: number;
  thickness: number;
  holeDiameter: number;
  tenonWidth: number;
  tenonLength: number;
  E: number;
  transverseE: number;
  G: number;
  poisson: number;
  axialN: number;
  shearN: number;
  momentNm: number;
  refinement: number;
  pinTravel: number;
  clearance: number;
};
type Point = [number, number];
type Triangle = [number, number, number];
export function localMesh(s: LocalSettings) {
  const points: Point[] = [],
    triangles: Triangle[] = [],
    hole: number[] = [];
  const halfLength = Math.max(s.width * 0.75, s.holeDiameter);
  if (s.kind === "hole") {
    const angles = new Set(
      Array.from({ length: 32 * s.refinement }, (_, i) => (i * 2 * Math.PI) / (32 * s.refinement)),
    );
    for (const x of [-halfLength, halfLength])
      for (const y of [-s.width / 2, s.width / 2])
        angles.add((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI));
    const sorted = [...angles].sort((a, b) => a - b),
      count = sorted.length,
      layers = 4 * s.refinement;
    for (let j = 0; j <= layers; j++)
      for (const [i, angle] of sorted.entries()) {
        const c = Math.cos(angle),
          t = Math.sin(angle),
          outer = Math.min(
            halfLength / Math.max(Math.abs(c), 1e-15),
            s.width / 2 / Math.max(Math.abs(t), 1e-15),
          );
        const r = s.holeDiameter / 2 + ((outer - s.holeDiameter / 2) * j) / layers;
        points.push([r * c, r * t]);
        if (j === 0) hole.push(i);
      }
    for (let j = 0; j < layers; j++)
      for (let i = 0; i < count; i++) {
        const a = j * count + i,
          b = j * count + ((i + 1) % count),
          c = (j + 1) * count + i,
          d = (j + 1) * count + ((i + 1) % count);
        const center = points.length;
        points.push([
          (points[a][0] + points[b][0] + points[c][0] + points[d][0]) / 4,
          (points[a][1] + points[b][1] + points[c][1] + points[d][1]) / 4,
        ]);
        triangles.push([a, c, center], [c, d, center], [d, b, center], [b, a, center]);
      }
  } else {
    const map = new Map<string, number>();
    const node = (x: number, y: number) => {
      const key = `${x.toFixed(10)},${y.toFixed(10)}`;
      const known = map.get(key);
      if (known !== undefined) return known;
      const id = points.length;
      points.push([x, y]);
      map.set(key, id);
      return id;
    };
    const ys =
      s.kind === "tenon"
        ? [-s.width / 2, -s.tenonWidth / 2, s.tenonWidth / 2, s.width / 2]
        : [-s.width / 2, s.width / 2];
    const rectangle = (x0: number, x1: number, y0: number, y1: number) => {
      const spacing = s.width / (12 * s.refinement),
        nx = Math.ceil((x1 - x0) / spacing),
        ny = Math.ceil((y1 - y0) / spacing);
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          const a = node(x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny),
            b = node(x0 + ((x1 - x0) * (i + 1)) / nx, y0 + ((y1 - y0) * j) / ny),
            c = node(x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * (j + 1)) / ny),
            d = node(x0 + ((x1 - x0) * (i + 1)) / nx, y0 + ((y1 - y0) * (j + 1)) / ny);
          const center = node((points[a][0] + points[d][0]) / 2, (points[a][1] + points[d][1]) / 2);
          triangles.push([a, b, center], [b, d, center], [d, c, center], [c, a, center]);
        }
    };
    for (let j = 0; j < ys.length - 1; j++)
      rectangle(-halfLength, s.kind === "tenon" ? 0 : halfLength, ys[j], ys[j + 1]);
    if (s.kind === "tenon") rectangle(0, s.tenonLength, -s.tenonWidth / 2, s.tenonWidth / 2);
  }
  return { points, triangles, hole, halfLength };
}
export function orthotropicMatrix(s: Pick<LocalSettings, "E" | "transverseE" | "G" | "poisson">) {
  const denominator = 1 - (s.poisson * s.poisson * s.transverseE) / s.E;
  if (
    ![s.E, s.transverseE, s.G, denominator].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(s.poisson)
  )
    throw new Error("直交異方性の材料定数が不正です");
  return [
    [s.E / denominator, (s.poisson * s.transverseE) / denominator, 0],
    [(s.poisson * s.transverseE) / denominator, s.transverseE / denominator, 0],
    [0, 0, s.G],
  ];
}
function triangleB(points: Point[], ids: Triangle) {
  const [a, b, c] = ids.map((i) => points[i]);
  const twice = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(twice) < 1e-16) throw new Error("退化した有限要素です");
  const dx = [b[1] - c[1], c[1] - a[1], a[1] - b[1]].map((v) => v / twice),
    dy = [c[0] - b[0], a[0] - c[0], b[0] - a[0]].map((v) => v / twice);
  return {
    area: Math.abs(twice) / 2,
    B: [dx.flatMap((v) => [v, 0]), dy.flatMap((v) => [0, v]), dx.flatMap((v, i) => [dy[i], v])],
  };
}
type Row = Map<number, number>;
const add = (rows: Row[], i: number, j: number, v: number) => rows[i].set(j, (rows[i].get(j) ?? 0) + v);
function solve(rows: Row[], force: number[], fixed: Set<number>) {
  const n = force.length,
    entries = rows.map((r) => [...r]);
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const apply = (x: number[]) =>
    entries.map((row, i) => (fixed.has(i) ? 0 : row.reduce((v, [j, k]) => v + k * x[j], 0)));
  const x = Array(n).fill(0),
    r = force.map((v, i) => (fixed.has(i) ? 0 : v)),
    diag = rows.map((row, i) => (fixed.has(i) ? 1 : (row.get(i) ?? 0)));
  if (diag.some((d) => d <= 0)) throw new Error("局所モデルの剛性が不足しています");
  let z = r.map((v, i) => v / diag[i]),
    p = [...z],
    rz = dot(r, z);
  const tolerance = Math.max(1e-10, Math.sqrt(dot(r, r)) * 1e-8);
  for (let iteration = 0; iteration < 8000; iteration++) {
    if (Math.sqrt(dot(r, r)) <= tolerance) return x;
    const ap = apply(p),
      den = dot(p, ap);
    if (!(den > 0)) throw new Error("局所解析が不安定です。支持と材料定数を確認してください");
    const alpha = rz / den;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
    }
    z = r.map((v, i) => v / diag[i]);
    const next = dot(r, z),
      beta = next / rz;
    p = z.map((v, i) => v + beta * p[i]);
    rz = next;
  }
  throw new Error("局所FEMが収束しませんでした。荷重・材料定数・メッシュを確認してください");
}
export function solveLocal(s: LocalSettings) {
  if (
    !["hole", "tenon", "plain"].includes(s.kind) ||
    !["traction", "pin"].includes(s.mode) ||
    ![1, 2, 3].includes(s.refinement)
  )
    throw new Error("局所解析の形状・分割数が不正です");
  if (
    ![s.width, s.thickness, s.holeDiameter, s.tenonWidth, s.tenonLength].every(
      (v) => Number.isFinite(v) && v > 0 && v <= 1,
    ) ||
    s.holeDiameter >= s.width ||
    s.tenonWidth >= s.width
  )
    throw new Error("局所解析の寸法が不正です");
  if (
    ![s.axialN, s.shearN, s.momentNm, s.pinTravel, s.clearance].every(Number.isFinite) ||
    Math.max(Math.abs(s.axialN), Math.abs(s.shearN)) > 100000 ||
    Math.abs(s.momentNm) > 10000 ||
    s.clearance < 0 ||
    s.clearance >= s.holeDiameter / 2 ||
    s.pinTravel < 0 ||
    s.pinTravel > 0.002
  )
    throw new Error("局所解析の荷重・隙間・押込み量が不正です");
  if (s.mode === "pin" && s.kind !== "hole") throw new Error("ピン接触は丸穴モデルで指定してください");
  const mesh = localMesh(s),
    D = orthotropicMatrix(s),
    n = mesh.points.length * 2;
  const rows: Row[] = Array.from({ length: n }, () => new Map()),
    fixed = new Set<number>(),
    force = Array(n).fill(0);
  const elementData = mesh.triangles.map((ids) => {
    const { B, area } = triangleB(mesh.points, ids),
      dofs = ids.flatMap((i) => [2 * i, 2 * i + 1]);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        let value = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) value += B[a][i] * D[a][b] * B[b][j];
        add(rows, dofs[i], dofs[j], value * area * s.thickness);
      }
    return { B, area, dofs };
  });
  const left = mesh.points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Math.abs(p[0] + mesh.halfLength) < 1e-8);
  for (const { i } of left) {
    fixed.add(2 * i);
    if (s.kind === "tenon" || s.mode === "pin") fixed.add(2 * i + 1);
  }
  const anchor = left.reduce((best, v) => (Math.abs(v.p[1]) < Math.abs(best.p[1]) ? v : best));
  fixed.add(anchor.i * 2 + 1);
  if (s.mode === "pin") {
    for (const [i, p] of mesh.points.entries())
      if (Math.abs(p[0] - mesh.halfLength) < 1e-8) {
        fixed.add(i * 2);
        fixed.add(i * 2 + 1);
      }
  } else {
    const rightX = s.kind === "tenon" ? s.tenonLength : mesh.halfLength;
    const right = mesh.points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Math.abs(p[0] - rightX) < 1e-8)
      .sort((a, b) => a.p[1] - b.p[1]);
    const width = s.kind === "tenon" ? s.tenonWidth : s.width;
    for (let j = 0; j < right.length - 1; j++) {
      const a = right[j],
        b = right[j + 1],
        length = b.p[1] - a.p[1];
      // Consistent nodal forces for linear edge traction; preserves force and bending moment.
      const t0 = s.axialN / width - (s.momentNm * a.p[1]) / (width ** 3 / 12),
        t1 = s.axialN / width - (s.momentNm * b.p[1]) / (width ** 3 / 12);
      force[2 * a.i] += (length * (2 * t0 + t1)) / 6;
      force[2 * b.i] += (length * (t0 + 2 * t1)) / 6;
      force[2 * a.i + 1] += (s.shearN * length) / width / 2;
      force[2 * b.i + 1] += (s.shearN * length) / width / 2;
    }
  }
  let displacement = Array(n).fill(0),
    contactIterations = 0;
  const contact = mesh.hole.map((i, j) => {
    const p = mesh.points[i],
      length = Math.hypot(...p),
      next = mesh.points[mesh.hole[(j + 1) % mesh.hole.length]],
      prev = mesh.points[mesh.hole[(j + mesh.hole.length - 1) % mesh.hole.length]];
    const arc = (Math.hypot(p[0] - next[0], p[1] - next[1]) + Math.hypot(p[0] - prev[0], p[1] - prev[1])) / 2;
    return { i, nx: p[0] / length, ny: p[1] / length, k: (s.transverseE * s.thickness * arc) / 0.01 };
  });
  if (s.mode === "traction") displacement = solve(rows, force, fixed);
  else {
    let active = contact.map((c) => s.pinTravel * c.ny - s.clearance > 0),
      converged = false;
    for (let iteration = 0; iteration < 60; iteration++) {
      contactIterations = iteration + 1;
      const matrix = rows.map((r) => new Map(r)),
        rhs = [...force];
      contact.forEach((c, j) => {
        if (!active[j]) return;
        const ids = [c.i * 2, c.i * 2 + 1],
          normal = [c.nx, c.ny];
        for (let a = 0; a < 2; a++) {
          rhs[ids[a]] += c.k * (s.pinTravel * c.ny - s.clearance) * normal[a];
          for (let b = 0; b < 2; b++) add(matrix, ids[a], ids[b], c.k * normal[a] * normal[b]);
        }
      });
      displacement = solve(matrix, rhs, fixed);
      const next = contact.map(
        (c) =>
          s.pinTravel * c.ny - s.clearance - c.nx * displacement[2 * c.i] - c.ny * displacement[2 * c.i + 1] >
          0,
      );
      if (next.every((v, j) => v === active[j])) {
        converged = true;
        break;
      }
      active = next;
    }
    if (!converged) throw new Error("ピン接触が収束しませんでした");
    contact.forEach((c) => {
      const penetration = Math.max(
        0,
        s.pinTravel * c.ny - s.clearance - c.nx * displacement[2 * c.i] - c.ny * displacement[2 * c.i + 1],
      );
      force[2 * c.i] += c.k * penetration * c.nx;
      force[2 * c.i + 1] += c.k * penetration * c.ny;
    });
  }
  const stresses = elementData.map(({ B, dofs }) => {
    const strain = B.map((row) => row.reduce((sum, v, i) => sum + v * displacement[dofs[i]], 0));
    const stress = D.map((row) => row.reduce((sum, v, i) => sum + v * strain[i], 0) / 1e6);
    return { sx: stress[0], sy: stress[1], shear: stress[2] };
  });
  const residual = rows.map(
    (row, i) => [...row].reduce((sum, [j, k]) => sum + k * displacement[j], 0) - force[i],
  );
  const freeResidual = Math.sqrt(residual.reduce((sum, v, i) => sum + (fixed.has(i) ? 0 : v * v), 0));
  const applied = [0, 0],
    reaction = [0, 0];
  for (let i = 0; i < n; i++) {
    applied[i % 2] += force[i];
    if (fixed.has(i)) reaction[i % 2] += residual[i];
  }
  const appliedMoment = mesh.points.reduce(
    (sum, p, i) => sum + p[0] * force[2 * i + 1] - p[1] * force[2 * i],
    0,
  );
  const reactionMoment = mesh.points.reduce(
    (sum, p, i) =>
      sum +
      (fixed.has(2 * i + 1) ? p[0] * residual[2 * i + 1] : 0) -
      (fixed.has(2 * i) ? p[1] * residual[2 * i] : 0),
    0,
  );
  const peakMPa = stresses.reduce(
    (max, s) => Math.max(max, Math.abs(s.sx), Math.abs(s.sy), Math.abs(s.shear)),
    0,
  );
  return {
    settings: s,
    mesh,
    displacement,
    stresses,
    force,
    fixed: [...fixed],
    applied,
    reaction,
    freeResidual,
    appliedMoment,
    reactionMoment,
    peakMPa,
    contactIterations,
  };
}
export type LocalResult = ReturnType<typeof solveLocal>;

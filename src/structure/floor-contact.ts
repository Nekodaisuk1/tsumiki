import type { Design, Vec3 } from "./design";
import { memberSolidPoints } from "./drawing-collision";

export type FloorContact = { member: string; point: Vec3; node: number; rows: number[][] };
/** End-contact approximation using the actual solid outline, never a fixed node or rotational clamp. */
export function floorContacts(design: Design, centers: Vec3[]) {
  const solids = design.members.map((member) => ({ member, points: memberSolidPoints(design, member) }));
  // Solid meshes repeat vertices across triangulated cells. Never spread their full cloud into a call.
  let floorY = Number.POSITIVE_INFINITY;
  for (const solid of solids) for (const point of solid.points) floorY = Math.min(floorY, point.y);
  const contacts: FloorContact[] = [];
  for (const { member, points } of solids) {
    const start = design.nodes.findIndex((n) => n.id === member.start),
      end = design.nodes.findIndex((n) => n.id === member.end);
    const a = design.nodes[start].position,
      b = design.nodes[end].position;
    const axis = b.map((v, i) => v - a[i]);
    const low = points.filter((p) => p.y <= floorY + 1e-7);
    if (!low.length) continue;
    const along = low.map((p) => p.toArray().reduce((sum, v, i) => sum + (v - a[i]) * axis[i], 0));
    const min = along.reduce((value, next) => Math.min(value, next), Number.POSITIVE_INFINITY);
    const max = along.reduce((value, next) => Math.max(value, next), Number.NEGATIVE_INFINITY);
    const seen = new Set<string>();
    low.forEach((p, i) => {
      if (Math.abs(along[i] - min) > 1e-8 && Math.abs(along[i] - max) > 1e-8) return;
      const key = p
        .toArray()
        .map((v) => v.toFixed(8))
        .join(":");
      if (seen.has(key)) return;
      seen.add(key);
      const node = along[i] <= axis.reduce((sum, v) => sum + v * v, 0) / 2 ? start : end;
      const r = p.toArray().map((v, j) => v - centers[node][j]);
      const rows = [
        [1, 0, 0, 0, r[2], -r[1]],
        [0, 1, 0, -r[2], 0, r[0]],
        [0, 0, 1, r[1], -r[0], 0],
      ];
      contacts.push({ member: member.id, point: p.toArray() as Vec3, node, rows });
    });
  }
  return { floorY, contacts };
}

export function solveFloorContact(
  K: number[][],
  load: number[],
  contacts: FloorContact[],
  friction: number,
  factor: (matrix: number[][]) => (rhs: number[]) => number[],
) {
  if (!contacts.length) throw new Error("地面との接点がありません");
  const size = load.length,
    stiffness = 1e7,
    regularization = 0.01;
  const tolerance = 1e-5 * load.reduce((max, value) => Math.max(max, Math.abs(value)), 1);
  let u = Array(size).fill(0) as number[];
  const normal = contacts.map(() => stiffness),
    tangential: number[] = contacts.map(() => (friction > 0 ? stiffness : 0));
  const measure = (c: FloorContact, row: number, values: number[]) =>
    c.rows[row].reduce((sum, v, i) => sum + v * values[c.node * 6 + i], 0);
  for (let iteration = 0; iteration < 300; iteration++) {
    const matrix = K.map((row, i) => row.map((v, j) => v + (i === j ? regularization : 0)));
    contacts.forEach((c, k) => {
      for (let axis = 0; axis < 3; axis++) {
        const spring = axis === 1 ? normal[k] : tangential[k];
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 6; j++)
            matrix[c.node * 6 + i][c.node * 6 + j] += spring * c.rows[axis][i] * c.rows[axis][j];
      }
    });
    const next = factor(matrix)(load);
    if (
      next.some((v) => !Number.isFinite(v)) ||
      next.reduce((max, value) => Math.max(max, Math.abs(value)), 0) > 0.05
    )
      throw new Error(
        "地面接触では静止状態を求められません。滑り・転倒・浮き上がり、または未支持の部材を確認してください（落下後の運動は未計算）",
      );
    const forces = contacts.map((c, k) => {
      const y = measure(c, 1, next),
        x = measure(c, 0, next),
        z = measure(c, 2, next);
      const n = Math.max(0, -stiffness * y),
        distance = Math.hypot(x, z);
      const kt =
        distance > 1e-14 ? Math.min(stiffness, (friction * n) / distance) : friction > 0 ? stiffness : 0;
      normal[k] = y <= 0 ? stiffness : 0;
      tangential[k] = kt;
      return [-kt * x, n, -kt * z] as Vec3;
    });
    const reactions = Array(size).fill(0) as number[];
    contacts.forEach((c, k) => {
      for (let axis = 0; axis < 3; axis++)
        for (let i = 0; i < 6; i++) reactions[c.node * 6 + i] += forces[k][axis] * c.rows[axis][i];
    });
    const residual = K.map(
      (row, i) => row.reduce((sum, v, j) => sum + v * next[j], 0) - load[i] - reactions[i],
    );
    const worst = residual.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const change = next.reduce((max, value, i) => Math.max(max, Math.abs(value - u[i])), 0);
    u = next;
    if (worst < tolerance && change < 1e-8)
      return {
        u,
        reactions,
        groundContacts: contacts.map((c, k) => ({
          member: c.member,
          point: c.point,
          force: forces[k],
          state:
            forces[k][1] <= tolerance
              ? "open"
              : Math.hypot(forces[k][0], forces[k][2]) >= friction * forces[k][1] * 0.999
                ? "limit"
                : "sticking",
        })),
        contactResidual: worst,
      };
  }
  throw new Error(
    "地面と摩擦の静止釣り合いが収束しません。摩擦不足・転倒の可能性があります。固定支持の結果には置き換えません。",
  );
}

import { type Design, type Material, type Vec3, validateDesign } from "./design";
import { holeSite } from "./holes";
import { ropeAttachments } from "./rope";
export type RopeMode = "none" | "slack" | "taut";
export type Excitation = "force" | "base";
type Matrix = number[][];
const zeros = (n: number, m = n): Matrix => Array.from({ length: n }, () => Array(m).fill(0));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]) => Math.hypot(...a);
const multiply = (a: Matrix, x: number[]) => a.map((row) => dot(row, x));
function factor(a: Matrix): (b: number[]) => number[] {
  const n = a.length;
  const l = zeros(n);
  const scale = Math.max(...a.map((row, i) => Math.abs(row[i])));
  if (n === 0) throw new Error("自由節点がありません。支持条件を変更してください");
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let v = a[i][j];
      for (let k = 0; k < j; k++) v -= l[i][k] * l[j][k];
      if (i === j) {
        if (v <= Math.max(1e-12, scale * 1e-12) || !Number.isFinite(v))
          throw new Error("支持・拘束不足、未接続節点、または剛性の数値条件が不適切です");
        l[i][j] = Math.sqrt(v);
      } else l[i][j] = v / l[j][j];
    }
  return (b) => {
    const x = Array(n).fill(0);
    const y = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let v = b[i];
      for (let j = 0; j < i; j++) v -= l[i][j] * y[j];
      y[i] = v / l[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let v = y[i];
      for (let j = i + 1; j < n; j++) v -= l[j][i] * x[j];
      x[i] = v / l[i][i];
    }
    return x;
  };
}
function beam(a: Vec3, b: Vec3, m: Material, roll: number) {
  const delta = sub(b, a);
  const length = norm(delta);
  const ex = delta.map((v) => v / length);
  const ref = Math.abs(ex[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const raw = cross(ref, ex);
  const ey = raw.map((v) => v / norm(raw));
  const ez = cross(ex, ey);
  const angle = (roll * Math.PI) / 180;
  const y = ey.map((v, i) => v * Math.cos(angle) + ez[i] * Math.sin(angle));
  const z = ez.map((v, i) => v * Math.cos(angle) - ey[i] * Math.sin(angle));
  const rotation = [ex, y, z];
  const transform = zeros(12);
  for (let block = 0; block < 4; block++)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) transform[3 * block + i][3 * block + j] = rotation[i][j];
  const local = zeros(12);
  const pair = (i: number, j: number, k: number) => {
    local[i][i] += k;
    local[j][j] += k;
    local[i][j] -= k;
    local[j][i] -= k;
  };
  pair(0, 6, (m.E * m.A) / length);
  pair(3, 9, (m.G * m.J) / length);
  const bending = (ids: number[], ei: number, sign: number) => {
    const l = length;
    const k = ei / l ** 3;
    const block = [
      [12, sign * 6 * l, -12, sign * 6 * l],
      [sign * 6 * l, 4 * l * l, -sign * 6 * l, 2 * l * l],
      [-12, -sign * 6 * l, 12, -sign * 6 * l],
      [sign * 6 * l, 2 * l * l, -sign * 6 * l, 4 * l * l],
    ];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) local[ids[i]][ids[j]] += k * block[i][j];
  };
  bending([1, 5, 7, 11], m.E * m.Iz, 1);
  bending([2, 4, 8, 10], m.E * m.Iy, -1);
  const temp = zeros(12);
  const global = zeros(12);
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) temp[i][j] += local[i][k] * transform[k][j];
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) global[i][j] += transform[k][i] * temp[k][j];
  return { global, local, transform, length };
}
/**
 * Scalar spring acting on a linear measure m = coef · u of the global displacement vector.
 * - "gap": clearance contact. Inside |m| <= gap only the small open stiffness acts; beyond it the
 *   contact stiffness engages on the closed side. Symmetric, frictionless.
 * - "rope": tension-only cable, T = max(0, t0 + k m).
 * Both have convex piecewise-quadratic energies, so equilibrium is a convex minimization.
 */
type Spring =
  | { kind: "gap"; ids: number[]; coef: number[]; k0: number; kc: number; gap: number; joint: number }
  | { kind: "rope"; ids: number[]; coef: number[]; k: number; t0: number; rope: string; length: number };
export type JointSite = {
  id: string;
  female: string;
  male: string;
  node: string;
  /** Translational clearance per side and rotational clearance about the shaft. */
  gap: number;
  torsionGap: number;
};
const measure = (s: Spring, u: number[]) => s.ids.reduce((sum, id, i) => sum + s.coef[i] * u[id], 0);
const springForce = (s: Spring, m: number) =>
  s.kind === "gap"
    ? s.k0 * m + s.kc * Math.sign(m) * Math.max(0, Math.abs(m) - s.gap)
    : Math.max(0, s.t0 + s.k * m);
const engaged = (s: Spring, m: number) =>
  s.kind === "gap" ? s.kc > 0 && Math.abs(m) > s.gap : s.t0 + s.k * m > 0;
const springStiffness = (s: Spring, m: number) =>
  s.kind === "gap" ? s.k0 + (engaged(s, m) ? s.kc : 0) : engaged(s, m) ? s.k : 0;
const springEnergy = (s: Spring, m: number) =>
  s.kind === "gap"
    ? 0.5 * s.k0 * m * m + 0.5 * s.kc * Math.max(0, Math.abs(m) - s.gap) ** 2
    : Math.max(0, s.t0 + s.k * m) ** 2 / (2 * s.k);
/** Rotational clearance of a square tenon (side a) turning inside a square hole (side h). */
export function squareTorsionGap(tenon: number, hole: number) {
  return Math.asin(Math.min(1, hole / (tenon * Math.SQRT2))) - Math.PI / 4;
}
function assemble(design: Design, mode: RopeMode) {
  validateDesign(design);
  const nodeCount = design.nodes.length;
  const index = new Map(design.nodes.map((n, i) => [n.id, i]));
  const centers = design.nodes.map((n) => [...n.position] as Vec3);
  const anchored = new Set<string>();
  for (const connection of design.connections) {
    const male = design.members.find((m) => m.id === connection.male);
    if (!male) throw new Error("接続先がありません");
    const id = male[connection.end];
    if (!anchored.has(id)) {
      const n = index.get(id);
      if (n === undefined) throw new Error("接続節点がありません");
      centers[n] = holeSite(design, connection.female, connection.hole).position;
      anchored.add(id);
    }
  }
  const offsets = design.nodes.map((n, i) => sub(n.position, centers[i]) as Vec3);
  const contact = design.jointModel === "clearance-contact";
  const notes: string[] = [];
  // Each board resting on a tenon gets its own 6-DOF set at the hole, appended after the nodes.
  const holeSets: { female: string; male: string; node: number; position: Vec3; normal: Vec3 }[] = [];
  const holeSetFor = (female: string, hole: number, node: number) => {
    if (!contact) return node;
    const nodeId = design.nodes[node].id;
    const site = holeSite(design, female, hole);
    const through = design.members.filter((m) => {
      if (m.kind !== "male" || (m.start !== nodeId && m.end !== nodeId)) return false;
      const a = design.nodes[index.get(m.start) ?? -1]?.position;
      const b = design.nodes[index.get(m.end) ?? -1]?.position;
      if (!a || !b) return false;
      const axis = sub(b, a);
      return Math.abs(dot(axis, site.normal)) >= norm(axis) * (1 - 1e-6);
    });
    if (through.length !== 1) {
      notes.push(
        `${female} の穴${hole}（${nodeId}）は貫通する雄材の凸部を特定できないため、剛接合として扱いました`,
      );
      return node;
    }
    holeSets.push({ female, male: through[0].id, node, position: site.position, normal: site.normal });
    return nodeCount + holeSets.length - 1;
  };
  type Joint = { node: number; position: Vec3; t: number };
  const memberJoints = design.members.map((member) => {
    const start = index.get(member.start);
    const end = index.get(member.end);
    if (start === undefined || end === undefined) throw new Error("部材参照が不正です");
    if (member.kind !== "female")
      return [
        { node: start, position: design.nodes[start].position, t: 0 },
        { node: end, position: design.nodes[end].position, t: 1 },
      ] as Joint[];
    const last = member.holeCount - 1;
    const joints: Joint[] = [
      { node: holeSetFor(member.id, 0, start), position: holeSite(design, member.id, 0).position, t: 0 },
      { node: holeSetFor(member.id, last, end), position: holeSite(design, member.id, last).position, t: 1 },
    ];
    for (const c of design.connections.filter((c) => c.female === member.id)) {
      const male = design.members.find((m) => m.id === c.male);
      if (!male) throw new Error("接続雄材がありません");
      const node = index.get(male[c.end]);
      if (node === undefined) throw new Error("接続節点がありません");
      const t = c.hole / last;
      if (!joints.some((j) => Math.abs(j.t - t) < 1e-8))
        joints.push({
          node: holeSetFor(member.id, c.hole, node),
          position: holeSite(design, member.id, c.hole).position,
          t,
        });
    }
    return joints.sort((a, b) => a.t - b.t);
  });
  const sets = nodeCount + holeSets.length;
  const size = sets * 6;
  for (const h of holeSets) {
    centers.push(h.position);
    offsets.push([0, 0, 0]);
  }
  const K = zeros(size);
  const mass = Array(size).fill(0);
  const recover = (u: number[]) => {
    const result = u.slice(0, nodeCount * 6);
    for (let n = 0; n < nodeCount; n++) {
      const delta = cross(u.slice(n * 6 + 3, n * 6 + 6), offsets[n]);
      for (let axis = 0; axis < 3; axis++) result[n * 6 + axis] += delta[axis];
    }
    return result;
  };
  const loadAt = (force: number[], node: number, axis: number, value: number, torque = 0) => {
    force[node * 6 + axis] += value;
    force[node * 6 + 3 + axis] += torque;
    const vector = [0, 0, 0];
    vector[axis] = value;
    const moment = cross(offsets[node], vector);
    for (let a = 0; a < 3; a++) force[node * 6 + 3 + a] += moment[a];
  };
  const members = design.members.flatMap((member, memberIndex) => {
    const material = design.materials.find((m) => m.id === member.material);
    if (!material) throw new Error("材料参照が不正です");
    const joints = memberJoints[memberIndex];
    return joints.slice(0, -1).map((a, part) => {
      const b = joints[part + 1];
      const element = beam(a.position, b.position, material, member.roll);
      const ids = [
        ...Array.from({ length: 6 }, (_, i) => a.node * 6 + i),
        ...Array.from({ length: 6 }, (_, i) => b.node * 6 + i),
      ];
      const B = zeros(12);
      for (let i = 0; i < 12; i++) B[i][i] = 1;
      for (const [block, joint] of [
        [0, a],
        [1, b],
      ] as const) {
        const r = sub(joint.position, centers[joint.node]);
        for (let axis = 0; axis < 3; axis++) {
          const e = [0, 0, 0];
          e[axis] = 1;
          const delta = cross(e, r);
          for (let row = 0; row < 3; row++) B[block * 6 + row][block * 6 + 3 + axis] = delta[row];
        }
      }
      const temp = zeros(12);
      const global = zeros(12);
      const transform = zeros(12);
      for (let i = 0; i < 12; i++)
        for (let j = 0; j < 12; j++)
          for (let k = 0; k < 12; k++) {
            temp[i][j] += element.global[i][k] * B[k][j];
            transform[i][j] += element.transform[i][k] * B[k][j];
          }
      for (let i = 0; i < 12; i++)
        for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) global[i][j] += B[k][i] * temp[k][j];
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[ids[i]][ids[j]] += global[i][j];
      const halfMass = (material.density * material.A * element.length) / 2;
      for (const n of [a.node, b.node])
        for (let i = 0; i < 6; i++)
          mass[n * 6 + i] += i < 3 ? halfMass : (halfMass * element.length ** 2) / 12;
      return {
        ...element,
        global,
        transform,
        id: joints.length > 2 ? `${member.id}[${part + 1}]` : member.id,
        ids,
      };
    });
  });
  const springs: Spring[] = [];
  const joints: JointSite[] = [];
  const { thickness, tenonSize, holeSize } = design.geometry;
  const gap = (holeSize - tenonSize) / 2;
  const torsionGap = squareTorsionGap(tenonSize, holeSize);
  const kc = design.joint.contactStiffness;
  const k0 = design.joint.openStiffness;
  holeSets.forEach((h, n) => {
    const set = nodeCount + n;
    const female = design.members.find((m) => m.id === h.female);
    if (!female) throw new Error("雌材がありません");
    const e1 = h.normal;
    const along = sub(
      design.nodes[index.get(female.end) ?? 0].position,
      design.nodes[index.get(female.start) ?? 0].position,
    );
    const raw = sub(
      along,
      e1.map((v) => v * dot(along, e1)),
    );
    const e2 = raw.map((v) => v / norm(raw));
    const e3 = cross(e1, e2);
    const joint = joints.length;
    joints.push({
      id: `${h.female}@${design.nodes[h.node].id}`,
      female: h.female,
      male: h.male,
      node: design.nodes[h.node].id,
      gap,
      torsionGap,
    });
    const ids = [
      ...Array.from({ length: 6 }, (_, i) => set * 6 + i),
      ...Array.from({ length: 6 }, (_, i) => h.node * 6 + i),
    ];
    // Relative motion of the hole wall against the tenon at point x along direction e.
    const relative = (x: Vec3, e: number[]) => [
      ...e,
      ...cross(sub(x, centers[set]), e),
      ...e.map((v) => -v),
      ...cross(sub(x, centers[h.node]), e).map((v) => -v),
    ];
    for (const face of [-0.5, 0.5]) {
      const x = h.position.map((v, i) => v + face * thickness * e1[i]) as Vec3;
      for (const e of [e2, e3])
        springs.push({ kind: "gap", ids, coef: relative(x, e), k0: k0 / 2, kc: kc / 2, gap, joint });
    }
    // No clearance is modeled along the shaft: the stack of boards and spacers is assumed seated.
    springs.push({ kind: "gap", ids, coef: relative(h.position, e1), k0: kc, kc: 0, gap: 0, joint });
    springs.push({
      kind: "gap",
      ids,
      coef: [0, 0, 0, ...e1, 0, 0, 0, ...e1.map((v) => -v)],
      k0: (k0 * tenonSize ** 2) / 2,
      kc: (kc * tenonSize ** 2) / 2,
      gap: torsionGap,
      joint,
    });
  });
  if (mode !== "none")
    for (const rope of design.ropes) {
      const attachments = ropeAttachments(design, rope);
      const t0 = rope.stiffness * (mode === "taut" ? rope.prestrain : -rope.slack);
      const segments = [0, 1, 2].map((segment) => {
        const a = attachments[segment];
        const b = attachments[segment + 1];
        const delta = sub(b.position, a.position);
        const length = norm(delta);
        const gradient = new Map<number, number>();
        for (const [attachment, sign] of [
          [a, -1],
          [b, 1],
        ] as const) {
          const node = index.get(attachment.node);
          if (node === undefined) throw new Error("ロープ参照が不正です");
          const g = delta.map((v) => (sign * v) / length);
          const rotational = cross(
            attachment.offset.map((v, i) => v + offsets[node][i]),
            g,
          );
          for (let axis = 0; axis < 3; axis++) {
            const t = node * 6 + axis;
            const r = node * 6 + 3 + axis;
            gradient.set(t, (gradient.get(t) ?? 0) + g[axis]);
            gradient.set(r, (gradient.get(r) ?? 0) + rotational[axis]);
          }
        }
        return { gradient, length };
      });
      // "sliding": frictionless wraps, one uniform tension over the whole path.
      // "locked": the rope cannot slip around the tenons at C and B, so each segment stretches on its own.
      const groups = design.ropeWrap === "sliding" ? [segments] : segments.map((segment) => [segment]);
      for (const group of groups) {
        const gradient = new Map<number, number>();
        for (const segment of group)
          for (const [id, v] of segment.gradient) gradient.set(id, (gradient.get(id) ?? 0) + v);
        const length = group.reduce((sum, segment) => sum + segment.length, 0);
        springs.push({
          kind: "rope",
          rope: rope.id,
          ids: [...gradient.keys()],
          coef: [...gradient.values()],
          k: rope.stiffness / length,
          t0,
          length,
        });
      }
    }
  const free = Array.from({ length: size }, (_, i) => i).filter(
    (i) => i >= nodeCount * 6 || !design.nodes[Math.floor(i / 6)].fixed,
  );
  const axis = { x: 0, y: 1, z: 2 }[design.analysis.direction];
  const loadNode = index.get(design.analysis.loadNode);
  if (loadNode === undefined) throw new Error("荷重点がありません");
  if (design.nodes[loadNode].fixed) throw new Error("荷重点が固定されています。自由節点を選んでください");
  return { K, mass, members, springs, joints, notes, free, axis, loadNode, size, nodeCount, recover, loadAt };
}
type System = ReturnType<typeof assemble>;
function gravityLoad(system: System, gravity: number) {
  const force = Array(system.size).fill(0);
  for (let i = 1; i < system.size; i += 6) force[i] -= system.mass[i] * gravity;
  return force;
}
/**
 * Winding: the rope is drawn in at constant tension until the joints settle, then it holds its length.
 * The prestrain is therefore the tension right after winding (no self-weight or load), not a strain
 * measured on the unseated geometry, which the clearance would otherwise absorb.
 */
function wind(system: System, mode: RopeMode) {
  if (mode !== "taut") return;
  const pull = Array(system.size).fill(0);
  for (const s of system.springs)
    if (s.kind === "rope") for (let i = 0; i < s.ids.length; i++) pull[s.ids[i]] -= s.t0 * s.coef[i];
  const wound = equilibrium({ ...system, springs: system.springs.filter((s) => s.kind !== "rope") }, pull);
  for (const s of system.springs) if (s.kind === "rope") s.t0 -= s.k * measure(s, wound.u);
}
/** Minimizes the convex piecewise-quadratic energy with Newton steps and a backtracking line search. */
function equilibrium(system: System, external: number[]) {
  const { K, springs, free, size } = system;
  const scale =
    1 + Math.max(...external.map(Math.abs), ...springs.map((s) => (s.kind === "rope" ? Math.abs(s.t0) : 0)));
  const tolerance = 1e-10 * scale;
  const residualOf = (u: number[]) => {
    const r = sub(multiply(K, u), external);
    for (const s of springs) {
      const f = springForce(s, measure(s, u));
      for (let i = 0; i < s.ids.length; i++) r[s.ids[i]] += f * s.coef[i];
    }
    return r;
  };
  const energyOf = (u: number[]) =>
    0.5 * dot(u, multiply(K, u)) -
    dot(external, u) +
    springs.reduce((e, s) => e + springEnergy(s, measure(s, u)), 0);
  let u = Array(size).fill(0);
  let residual = residualOf(u);
  for (let iteration = 0; iteration < 200; iteration++) {
    const worst = Math.max(0, ...free.map((i) => Math.abs(residual[i])));
    const tangent = K.map((row) => [...row]);
    for (const s of springs) {
      const k = springStiffness(s, measure(s, u));
      if (k === 0) continue;
      for (let i = 0; i < s.ids.length; i++)
        for (let j = 0; j < s.ids.length; j++) tangent[s.ids[i]][s.ids[j]] += k * s.coef[i] * s.coef[j];
    }
    if (worst <= tolerance) {
      const forces = springs.map((s) => springForce(s, measure(s, u)));
      return {
        u,
        tangent,
        forces,
        reactions: residual.map((v) => v),
        residual: worst,
        iterations: iteration,
      };
    }
    const solve = factor(free.map((i) => free.map((j) => tangent[i][j])));
    const step = solve(free.map((i) => -residual[i]));
    const direction = Array(size).fill(0);
    free.forEach((id, i) => {
      direction[id] = step[i];
    });
    const slope = dot(
      free.map((i) => residual[i]),
      step,
    );
    const current = energyOf(u);
    let alpha = 1;
    let trial = u.map((v, i) => v + direction[i]);
    while (energyOf(trial) > current + 1e-4 * alpha * slope + 1e-14 * Math.abs(current) && alpha > 1e-12) {
      alpha /= 2;
      trial = u.map((v, i) => v + alpha * direction[i]);
    }
    u = trial;
    residual = residualOf(u);
  }
  throw new Error("接合の接触・ロープの張りの釣り合いが収束しません。荷重や構造を変更してください");
}
/** Largest segment tension of each rope, in design order. */
function ropeTensions(system: System, forces: number[]) {
  const result = new Map<string, number>();
  system.springs.forEach((s, i) => {
    if (s.kind === "rope") result.set(s.rope, Math.max(result.get(s.rope) ?? 0, forces[i]));
  });
  return [...result.values()];
}
function ropeSegmentTensions(system: System, forces: number[]) {
  return system.springs.flatMap((s, i) => (s.kind === "rope" ? [{ rope: s.rope, tension: forces[i] }] : []));
}
function jointResults(system: System, u: number[], forces: number[]) {
  return system.joints.map((joint, n) => {
    let utilization = 0;
    let contactForce = 0;
    let closed = false;
    system.springs.forEach((s, i) => {
      if (s.kind !== "gap" || s.joint !== n || s.kc === 0) return;
      const m = measure(s, u);
      utilization = Math.max(utilization, Math.abs(m) / s.gap);
      if (engaged(s, m)) {
        closed = true;
        contactForce = Math.max(contactForce, Math.abs(forces[i] - s.k0 * m));
      }
    });
    return { ...joint, utilization, closed, contactForce };
  });
}
export function solveStatic(design: Design, mode: RopeMode) {
  const system = assemble(design, mode);
  wind(system, mode);
  const force = gravityLoad(system, design.analysis.gravity);
  system.loadAt(force, system.loadNode, system.axis, design.analysis.force, design.analysis.torque);
  const result = equilibrium(system, force);
  const initial = equilibrium(system, Array(system.size).fill(0));
  const displacement = system.recover(result.u);
  const initialDisplacement = system.recover(initial.u);
  const incremental = sub(displacement, initialDisplacement);
  const memberForces = system.members.map((m) => ({
    id: m.id,
    local: multiply(
      m.local,
      multiply(
        m.transform,
        m.ids.map((i) => result.u[i]),
      ),
    ),
  }));
  const nodes = design.nodes.map((_, n) => n);
  const maxDisplacement = Math.max(...nodes.map((n) => norm(incremental.slice(n * 6, n * 6 + 3))));
  const maxTotalDisplacement = Math.max(...nodes.map((n) => norm(displacement.slice(n * 6, n * 6 + 3))));
  return {
    displacement,
    incremental,
    initialDisplacement,
    reactions: result.reactions.slice(0, system.nodeCount * 6),
    residual: result.residual,
    ropeTensions: ropeTensions(system, result.forces),
    initialRopeTensions: ropeTensions(system, initial.forces),
    ropeSegmentTensions: ropeSegmentTensions(system, result.forces),
    joints: jointResults(system, result.u, result.forces),
    initialJoints: jointResults(system, initial.u, initial.forces),
    notes: system.notes,
    memberForces,
    maxDisplacement,
    maxTotalDisplacement,
  };
}
export function createNewmarkStepper(K: Matrix, M: number[], C: number[], dt: number) {
  if (!Number.isFinite(dt) || dt <= 0 || M.some((m) => !Number.isFinite(m) || m <= 0))
    throw new Error("Invalid integration parameters");
  const n = M.length;
  const effective = K.map((row, i) =>
    row.map((v, j) => v + (i === j ? (4 * M[i]) / dt ** 2 + (2 * C[i]) / dt : 0)),
  );
  const solve = factor(effective);
  let u = Array(n).fill(0);
  let v = Array(n).fill(0);
  let acc = Array(n).fill(0);
  return (force: number[]) => {
    const rhs = force.map(
      (f, i) =>
        f + M[i] * ((4 * u[i]) / dt ** 2 + (4 * v[i]) / dt + acc[i]) + C[i] * ((2 * u[i]) / dt + v[i]),
    );
    const next = solve(rhs);
    const nextAcc = next.map((value, i) => (4 * (value - u[i])) / dt ** 2 - (4 * v[i]) / dt - acc[i]);
    v = v.map((value, i) => value + (dt / 2) * (acc[i] + nextAcc[i]));
    acc = nextAcc;
    u = next;
    return [...u];
  };
}

/**
 * Linear vibration about the dead-load equilibrium. The tangent (including which joint contacts and
 * ropes are engaged at that state) is frozen. If any contact or rope would change state during the
 * response, the result is flagged as a reference value rather than corrected.
 */
export function simulate(design: Design, mode: RopeMode, excitation: Excitation) {
  const system = assemble(design, mode);
  wind(system, mode);
  const { free, mass, axis, loadNode, size, springs } = system;
  const initial = equilibrium(system, gravityLoad(system, design.analysis.gravity));
  const K = free.map((i) => free.map((j) => initial.tangent[i][j]));
  const M = free.map((i) => mass[i]);
  const a = design.analysis;
  const dt = a.timeStep;
  const count = Math.ceil(a.duration / dt);
  const n = free.length;
  const referenceOmega = Math.sqrt(free.reduce((s, id, i) => s + system.K[id][id] / M[i], 0) / n);
  const C = M.map((m) => 2 * a.damping * referenceOmega * m);
  const advance = createNewmarkStepper(K, M, C, dt);
  const baseline = springs.map((s) => measure(s, initial.u));
  const baselineState = springs.map((s, i) => engaged(s, baseline[i]));
  let u = Array(n).fill(0);
  let peak = 0;
  let cableSwitch = false;
  let contactSwitch = false;
  const times: number[] = [];
  const values: number[] = [];
  const input: number[] = [];
  const states: number[][] = [];
  for (let step = 0; step <= count; step++) {
    const t = step * dt;
    const wave = t <= a.excitationStop ? Math.sin(2 * Math.PI * a.frequency * t) : 0;
    const amplitude = (excitation === "force" ? a.force : a.baseAcceleration) * wave;
    const forcing = Array(size).fill(0);
    if (excitation === "force") system.loadAt(forcing, loadNode, axis, amplitude, a.torque * wave);
    else for (let id = 0; id < size; id++) if (id % 6 === axis) forcing[id] = -mass[id] * amplitude;
    const applied = free.map((id) => forcing[id]);
    if (step > 0) u = advance(applied);
    const full = Array(size).fill(0);
    free.forEach((id, i) => {
      full[id] = u[i];
    });
    springs.forEach((s, i) => {
      if (engaged(s, baseline[i] + measure(s, full)) === baselineState[i]) return;
      if (s.kind === "rope") cableSwitch = true;
      else contactSwitch = true;
    });
    const physical = system.recover(full);
    const max = Math.max(...design.nodes.map((_, i) => norm(physical.slice(i * 6, i * 6 + 3))));
    peak = Math.max(peak, max);
    if (!Number.isFinite(max)) throw new Error("動的計算が有限値を保てませんでした");
    times.push(t);
    values.push(physical[loadNode * 6 + axis]);
    input.push(amplitude);
    states.push(physical);
  }
  return {
    times,
    values,
    input,
    states,
    peak,
    cableSwitch,
    contactSwitch,
    initial: system.recover(initial.u),
    referenceOmega,
  };
}

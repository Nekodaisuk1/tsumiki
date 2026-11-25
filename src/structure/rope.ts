import type { Design, Member, Rope, Vec3 } from "./design";
import { ASSEMBLY_SLOTS } from "./seats";
export type RopeFrame = {
  id: string;
  nodes: [string, string, string, string];
  males: [string, string];
  females: [string, string];
};
const difference = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function ropeSideMember(design: Design, rope: Rope) {
  return design.members.find(
    (m) =>
      m.kind === "male" &&
      [m.start, m.end].sort().join(":") === [rope.route[1], rope.route[2]].sort().join(":"),
  );
}
export function ropeAttachments(design: Design, rope: Rope) {
  const winding = design.members.find((m) => m.id === rope.windingMember && m.kind === "male");
  const side = ropeSideMember(design, rope);
  if (!winding || !side) throw new Error("ロープを掛ける雄材がありません");
  const distance =
    design.version === 6
      ? design.geometry.tenonLength - design.geometry.thickness / 2
      : (ASSEMBLY_SLOTS + 0.5) * design.geometry.thickness;
  return rope.route.map((nodeId) => {
    const host = nodeId === winding.start || nodeId === winding.end ? winding : side;
    const node = design.nodes.find((n) => n.id === nodeId);
    const other = design.nodes.find((n) => n.id === (host.start === nodeId ? host.end : host.start));
    if (!node || !other) throw new Error("ロープの接触点がありません");
    const delta = difference(node.position, other.position);
    const length = Math.hypot(...delta);
    const offset = delta.map((v) => (v / length) * distance) as Vec3;
    return { node: nodeId, offset, position: node.position.map((v, i) => v + offset[i]) as Vec3 };
  });
}
export function detectRopeFrames(design: Design): RopeFrame[] {
  const males = design.members.filter((m) => m.kind === "male");
  const frames: RopeFrame[] = [];
  // The nodes each board touches (its ends and the tenons in its holes), gathered once: the pair loop
  // below asks for them a number of times that grows with the square of the male count.
  const members = new Map(design.members.map((m) => [m.id, m]));
  const points = new Map<string, Set<string>>();
  for (const m of design.members) if (m.kind === "female") points.set(m.id, new Set([m.start, m.end]));
  for (const c of design.connections) {
    const male = members.get(c.male);
    if (male) points.get(c.female)?.add(male[c.end]);
  }
  const byNode = new Map<string, Member[]>();
  for (const [id, nodes] of points)
    for (const node of nodes) {
      const list = byNode.get(node) ?? [];
      list.push(members.get(id) as Member);
      byNode.set(node, list);
    }
  // Outermost board first, so the first board found at both nodes is the one a rope would rest on.
  for (const list of byNode.values()) list.sort((a, b) => b.layer - a.layer);
  const female = (a: string, b: string) => byNode.get(a)?.find((m) => points.get(m.id)?.has(b));
  const seen = new Set<string>();
  for (let i = 0; i < males.length; i++)
    for (let j = i + 1; j < males.length; j++) {
      const left = males[i];
      const right = males[j];
      if (new Set([left.start, left.end, right.start, right.end]).size !== 4) continue;
      for (const [b, c] of [
        [right.start, right.end],
        [right.end, right.start],
      ]) {
        const a = left.start;
        const d = left.end;
        const ab = female(a, b);
        const dc = female(d, c);
        if (!ab || !dc) continue;
        const nodes: [string, string, string, string] = [a, b, c, d];
        const points = nodes.map((id) => design.nodes.find((n) => n.id === id)?.position);
        if (points.some((p) => !p)) continue;
        const [pa, pb, pc, pd] = points as Vec3[];
        const normal = cross(difference(pb, pa), difference(pd, pa));
        const length = Math.hypot(...normal);
        if (length < 1e-8 || Math.abs(dot(normal, difference(pc, pa))) > length * 1e-6) continue;
        const turns = nodes.map((_, k) =>
          dot(
            cross(
              difference((points as Vec3[])[(k + 1) % 4], (points as Vec3[])[k]),
              difference((points as Vec3[])[(k + 2) % 4], (points as Vec3[])[(k + 1) % 4]),
            ),
            normal,
          ),
        );
        if (!(turns.every((v) => v > 1e-10) || turns.every((v) => v < -1e-10))) continue;
        const id = `frame-${[...nodes].sort().join("-")}`;
        if (seen.has(id)) continue;
        seen.add(id);
        frames.push({ id, nodes, males: [left.id, right.id], females: [ab.id, dc.id] });
      }
    }
  return frames;
}
export function ropeOnFrame(design: Design, frame: RopeFrame) {
  return design.ropes.find((r) => [...r.route].sort().join(":") === [...frame.nodes].sort().join(":"));
}
export function windingUnavailable(design: Design, frame: RopeFrame, member: string, ignoreRope?: string) {
  const other = frame.males.find((id) => id !== member);
  if (!frame.males.includes(member)) return "この枠の雄材ではありません";
  for (const rope of design.ropes) {
    if (rope.id === ignoreRope) continue;
    const side = ropeSideMember(design, rope);
    if (rope.windingMember === member || side?.id === member || rope.windingMember === other)
      return "他のロープの固定・巻き取りに使用されています";
  }
  return "";
}
export function routeForWinder(frame: RopeFrame, windingMember: string): Rope["route"] {
  const [a, b, c, d] = frame.nodes;
  if (windingMember === frame.males[0]) return [a, c, b, d];
  if (windingMember === frame.males[1]) return [b, d, a, c];
  throw new Error("選択した枠の雄材を選んでください");
}

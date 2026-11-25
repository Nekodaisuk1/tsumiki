import { femaleMargin, holeOffsets, tenonOuterRadius } from "./catalog";
import type { Design, Member, Vec3 } from "./design";
export const add3 = (a: Vec3, b: Vec3) => a.map((v, i) => v + b[i]) as Vec3;
export const sub3 = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
export const scale3 = (a: Vec3, s: number) => a.map((v) => v * s) as Vec3;
export const dot3 = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit3 = (a: Vec3) => scale3(a, 1 / Math.hypot(...a));
/** Where each node id sits in its design's node list, kept per list and rebuilt when it goes stale. */
const nodeIndex = new WeakMap<Design["nodes"], Map<string, number>>();
/** The node with this id; the same as `design.nodes.find((n) => n.id === id)`, without the scan. */
export function nodeById(design: Design, id: string) {
  const at = nodeIndex.get(design.nodes)?.get(id);
  const node = at === undefined ? undefined : design.nodes[at];
  if (node?.id === id) return node;
  // Missing or moved (nodes were added, removed or reordered since): index the list again.
  const index = new Map(design.nodes.map((n, i) => [n.id, i]));
  nodeIndex.set(design.nodes, index);
  const i = index.get(id);
  return i === undefined ? undefined : design.nodes[i];
}
export function boardAxes(design: Design, member: Member) {
  const start = nodeById(design, member.start);
  const end = nodeById(design, member.end);
  if (!start || !end) throw new Error("部材の節点がありません");
  const x = unit3(sub3(end.position, start.position));
  const y = unit3(cross3(Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], x));
  const z = cross3(x, y);
  const angle = (member.roll * Math.PI) / 180;
  const normal = add3(scale3(z, Math.cos(angle)), scale3(y, -Math.sin(angle)));
  const host = design.members.find(
    (m) => m.kind === "male" && (m.start === member.start || m.end === member.start),
  );
  let sign = 1;
  if (host) {
    const other = nodeById(design, host.start === member.start ? host.end : host.start);
    if (other && dot3(normal, sub3(start.position, other.position)) < 0) sign = -1;
  }
  return {
    start: start.position,
    end: end.position,
    x,
    normal: scale3(normal, sign),
    length: Math.hypot(...sub3(end.position, start.position)),
  };
}
export function holeSite(design: Design, femaleId: string, hole: number) {
  const member = design.members.find((m) => m.id === femaleId && m.kind === "female");
  if (!member || !Number.isInteger(hole) || hole < 0 || hole >= member.holeCount)
    throw new Error("雌材の有効な穴を選んでください");
  const axes = boardAxes(design, member);
  const center = add3(axes.start, scale3(axes.x, holeOffsets(axes.length, member.holeCount, member)[hole]));
  return {
    female: member.id,
    hole,
    center,
    position: add3(center, scale3(axes.normal, (member.layer + 0.5) * design.geometry.thickness)),
    normal: axes.normal,
  };
}
export function holeOccupied(design: Design, female: string, hole: number, ignoreMale?: string) {
  if (design.connections.some((c) => c.female === female && c.hole === hole && c.male !== ignoreMale))
    return true;
  const member = design.members.find((m) => m.id === female);
  if (!member) return true;
  const endpoint = hole === 0 ? member.start : hole === member.holeCount - 1 ? member.end : "";
  return (
    !!endpoint &&
    design.members.some(
      (m) => m.kind === "male" && m.id !== ignoreMale && (m.start === endpoint || m.end === endpoint),
    )
  );
}
/** Whether `p` lies in the box around the segment from `a` to `b` grown by `reach` (a cheap superset). */
function nearSegment(p: Vec3, a: Vec3, b: Vec3, reach: number) {
  for (let i = 0; i < 3; i++)
    if (p[i] < Math.min(a[i], b[i]) - reach || p[i] > Math.max(a[i], b[i]) + reach) return false;
  return true;
}
export function matchingShaftHoles(design: Design, start: Vec3, end: Vec3, ignoreMale?: string) {
  const direction = unit3(sub3(end, start));
  const length = Math.hypot(...sub3(end, start));
  const t = design.geometry.thickness;
  const result: { female: string; hole: number; end: "start" | "end"; seat: number }[] = [];
  const positions = new Map(design.nodes.map((n) => [n.id, n.position]));
  const g = design.geometry;
  for (const member of design.members.filter((m) => m.kind === "female")) {
    // A tenon reaches a board only near one of the shaft's ends; skip boards farther away than the tenon
    // plus the board's half width, end margin and seat offset before working out its holes.
    const a = positions.get(member.start);
    const b = positions.get(member.end);
    const reach = g.tenonLength + g.boardWidth + 5 * t + femaleMargin(g, member) + 1e-6;
    if (a && b && !nearSegment(start, a, b, reach) && !nearSegment(end, a, b, reach)) continue;
    const axes = boardAxes(design, member);
    const denominator = dot3(axes.normal, direction);
    if (Math.abs(denominator) < 1e-8) continue;
    // Hole sites as `holeSite` gives them, from the axes already at hand.
    const offsets = holeOffsets(axes.length, member.holeCount, member);
    const seated = scale3(axes.normal, (member.layer + 0.5) * t);
    const siteAt = (hole: number) => add3(add3(axes.start, scale3(axes.x, offsets[hole])), seated);
    const plane = siteAt(0);
    const distance = dot3(axes.normal, sub3(plane, start)) / denominator;
    if (
      !(
        (distance < -1e-7 && distance >= -design.geometry.tenonLength - t / 2) ||
        (distance > length + 1e-7 && distance <= length + design.geometry.tenonLength + t / 2)
      )
    )
      continue;
    const point = add3(start, scale3(direction, distance));
    const local = sub3(point, plane);
    const along = dot3(local, axes.x);
    const across = Math.hypot(...sub3(local, scale3(axes.x, along)));
    if (
      along < -femaleMargin(design.geometry, member) ||
      along > axes.length + femaleMargin(design.geometry, member) ||
      across > design.geometry.boardWidth / 2
    )
      continue;
    if (Math.abs(denominator) < 1 - 1e-6) throw new Error("雄材は雌材の面に垂直に差し込んでください");
    const hole = offsets.reduce(
      (best, value, i) => (Math.abs(value - along) < Math.abs(offsets[best] - along) ? i : best),
      0,
    );
    if (hole < 0 || hole >= member.holeCount) throw new Error("シャフトが雌材の穴のない部分に当たります");
    const site = { position: siteAt(hole) };
    const clearance =
      design.version === 6
        ? design.geometry.holeSize / 2 - tenonOuterRadius(design.geometry)
        : (design.geometry.holeSize - design.geometry.tenonSize) / 2;
    if (clearance < 0)
      throw new Error("凸部の角丸Rが小さく、丸穴に入りません。図面の凸部断面を確認してください");
    if (Math.hypot(...sub3(point, site.position)) > Math.max(1e-7, clearance))
      throw new Error("シャフトが雌材の穴のない部分に当たります");
    if (holeOccupied(design, member.id, hole, ignoreMale))
      throw new Error("この穴は既に別の雄材に接続されています");
    const endSide = distance < 0 ? "start" : "end";
    const offset = distance < 0 ? -distance : distance - length;
    // `+ 0` turns a rounded -0 into 0 so recorded seats compare equal after a save round trip.
    const seat = Math.round(offset / t - 0.5) + 0;
    if (seat < 0 || seat >= 4 || Math.abs(offset / t - (seat + 0.5)) > 1e-5)
      throw new Error("差し込み位置が板厚の4枚分を超えるか、先端のロープ用領域にかかります");
    result.push({ female: member.id, hole, end: endSide, seat });
  }
  return result;
}
export function insertionPreview(design: Design, female: string, hole: number, length: number, side: 1 | -1) {
  if (!Number.isFinite(length) || length < (design.version === 6 ? 0.001 : 0.2) || length > 4)
    throw new Error("雄材の長さ比は0.2〜4です");
  if (holeOccupied(design, female, hole))
    throw new Error("この穴は既に雄材に接続されています。空いている穴を選んでください");
  const site = holeSite(design, female, hole);
  const direction = scale3(site.normal, side);
  const t = design.geometry.thickness;
  if (dot3(direction, site.normal) < 0) {
    // The body runs against the board's facing side, so the board sits on the tenon at its own layer:
    // the tenon starts in the plane of the board's tenon node. Boards stacked with empty layers between
    // them (e.g. two boards turned so their end holes meet) then land on their own seats.
    const start = site.center;
    const end = add3(start, scale3(direction, length));
    const connections = matchingShaftHoles(design, start, end);
    if (!connections.some((c) => c.female === female && c.hole === hole))
      throw new Error("選択した穴に接続できません");
    return { start, end, direction, connections };
  }
  let outer = 0;
  for (const member of design.members.filter((m) => m.kind === "female"))
    for (let h = 0; h < member.holeCount; h++) {
      const other = holeSite(design, member.id, h);
      if (Math.abs(dot3(other.normal, direction)) < 1 - 1e-6) continue;
      const delta = sub3(other.position, site.position);
      const projection = dot3(delta, direction);
      if (
        Math.hypot(...sub3(delta, scale3(direction, projection))) < 1e-7 &&
        Math.abs(projection) <= 3 * t + 1e-7
      )
        outer = Math.max(outer, projection);
    }
  const start = add3(site.position, scale3(direction, outer + t / 2));
  const end = add3(start, scale3(direction, length));
  const connections = matchingShaftHoles(design, start, end);
  if (!connections.some((c) => c.female === female && c.hole === hole))
    throw new Error("選択した穴に接続できません");
  return { start, end, direction, connections };
}

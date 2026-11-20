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
export function boardAxes(design: Design, member: Member) {
  const start = design.nodes.find((n) => n.id === member.start);
  const end = design.nodes.find((n) => n.id === member.end);
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
    const other = design.nodes.find((n) => n.id === (host.start === member.start ? host.end : host.start));
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
export function matchingShaftHoles(design: Design, start: Vec3, end: Vec3, ignoreMale?: string) {
  const direction = unit3(sub3(end, start));
  const length = Math.hypot(...sub3(end, start));
  const t = design.geometry.thickness;
  const result: { female: string; hole: number; end: "start" | "end"; seat: number }[] = [];
  for (const member of design.members.filter((m) => m.kind === "female")) {
    const axes = boardAxes(design, member);
    const denominator = dot3(axes.normal, direction);
    if (Math.abs(denominator) < 1e-8) continue;
    const plane = holeSite(design, member.id, 0).position;
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
    const offsets = holeOffsets(axes.length, member.holeCount, member);
    const hole = offsets.reduce(
      (best, value, i) => (Math.abs(value - along) < Math.abs(offsets[best] - along) ? i : best),
      0,
    );
    if (hole < 0 || hole >= member.holeCount) throw new Error("シャフトが雌材の穴のない部分に当たります");
    const site = holeSite(design, member.id, hole);
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

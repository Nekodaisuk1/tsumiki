import * as THREE from "three";
import { femaleMargin, holeOffsets, memberPart } from "./catalog";
import type { Design, GeometryProfile, Member } from "./design";
import { ASSEMBLY_SLOTS } from "./seats";

function squareHole(size: number, x = 0) {
  const half = size / 2;
  return new THREE.Path()
    .moveTo(x - half, -half)
    .lineTo(x - half, half)
    .lineTo(x + half, half)
    .lineTo(x + half, -half)
    .closePath();
}
export function roundedRectangle(left: number, bottom: number, right: number, top: number, radius: number) {
  const shape = new THREE.Shape();
  const r = Math.min(radius, (right - left) / 2, (top - bottom) / 2);
  shape.moveTo(left + r, bottom).lineTo(right - r, bottom);
  if (r) shape.absarc(right - r, bottom + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(right, top - r);
  if (r) shape.absarc(right - r, top - r, r, 0, Math.PI / 2, false);
  shape.lineTo(left + r, top);
  if (r) shape.absarc(left + r, top - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(left, bottom + r);
  if (r) shape.absarc(left + r, bottom + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}
export function femaleShape(length: number, profile: GeometryProfile, holeCount: number, member?: Member) {
  const margin = femaleMargin(profile, member);
  const width = profile.boardWidth;
  const shape = roundedRectangle(
    -margin,
    -width / 2,
    length + margin,
    width / 2,
    memberPart(member)?.end === "round" ? width / 2 : 0,
  );
  for (const x of holeOffsets(length, holeCount, member)) {
    if (profile.specification === "hitoto-v1") {
      const hole = new THREE.Path();
      hole.absarc(x, 0, profile.holeSize / 2, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    } else shape.holes.push(squareHole(profile.holeSize, x));
  }
  return shape;
}
export const CURVE_SEGMENTS = 24;
function extrude(shape: THREE.Shape, depth: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: CURVE_SEGMENTS,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}
export function femaleGeometry(length: number, profile: GeometryProfile, holeCount: number, member?: Member) {
  return extrude(femaleShape(length, profile, holeCount, member), profile.thickness);
}
export function ringGeometry(profile: GeometryProfile) {
  const shape = new THREE.Shape();
  shape.absarc(
    0,
    0,
    profile.specification === "hitoto-v1" ? 0.05 : profile.boardWidth / 2,
    0,
    Math.PI * 2,
    false,
  );
  if (profile.specification === "hitoto-v1") {
    const hole = new THREE.Path();
    hole.absarc(0, 0, profile.holeSize / 2, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  } else shape.holes.push(squareHole(profile.holeSize));
  const geometry = extrude(shape, profile.thickness);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}
export function tenonShape(profile: GeometryProfile) {
  const half = profile.tenonSize / 2;
  return roundedRectangle(-half, -half, half, half, profile.tenonCornerRadius ?? 0);
}
export function maleGeometry(length: number, profile: GeometryProfile) {
  const body = new THREE.BoxGeometry(length, profile.boardWidth, profile.thickness);
  body.translate(length / 2, 0, 0);
  const peg = (x: number) => {
    const g = extrude(tenonShape(profile), profile.tenonLength);
    g.rotateY(Math.PI / 2);
    g.translate(x, 0, 0);
    return g;
  };
  return [body, peg(-profile.tenonLength / 2), peg(length + profile.tenonLength / 2)];
}
export function memberFrame(start: THREE.Vector3, end: THREE.Vector3, roll: number) {
  const x = end.clone().sub(start).normalize();
  const ref = Math.abs(x.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const y = new THREE.Vector3().crossVectors(ref, x).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const angle = (roll * Math.PI) / 180;
  const yr = y.clone().multiplyScalar(Math.cos(angle)).addScaledVector(z, Math.sin(angle));
  const zr = z.clone().multiplyScalar(Math.cos(angle)).addScaledVector(y, -Math.sin(angle));
  const basis = new THREE.Matrix4().makeBasis(x, yr, zr);
  return { x, y: yr, z: zr, quaternion: new THREE.Quaternion().setFromRotationMatrix(basis) };
}
export function femaleLayerSign(design: Design, member: Member, normal: THREE.Vector3) {
  const host = design.members.find(
    (m) => m.kind === "male" && (m.start === member.start || m.end === member.start),
  );
  if (!host) return 1;
  const endpoint = design.nodes.find((n) => n.id === member.start);
  const inner = design.nodes.find((n) => n.id === (host.start === member.start ? host.end : host.start));
  if (!endpoint || !inner) return 1;
  const outward = new THREE.Vector3(...endpoint.position).sub(new THREE.Vector3(...inner.position));
  return normal.dot(outward) >= 0 ? 1 : -1;
}
export function freeRingSlot(design: Design, member: string, end: "start" | "end"): number {
  const host = design.members.find((m) => m.id === member && m.kind === "male");
  if (!host) throw new Error("丸材の取付先に雄材を選んでください");
  const node = host[end];
  for (let slot = 0; slot < ASSEMBLY_SLOTS; slot++) {
    if (
      !design.members.some(
        (m) => m.kind === "female" && (m.start === node || m.end === node) && m.layer === slot,
      ) &&
      !design.connections.some((c) => c.male === member && c.end === end && c.seat === slot) &&
      !design.rings.some((r) => r.member === member && r.end === end && r.slot === slot)
    )
      return slot;
  }
  throw new Error("この差し込み部に丸材を置ける空き段がありません。先端の1枚分はロープ用です");
}

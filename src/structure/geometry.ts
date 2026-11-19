import * as THREE from "three";
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
export function femaleGeometry(length: number, profile: GeometryProfile, holeCount: number) {
  const margin = profile.boardWidth * 0.7;
  const width = profile.boardWidth;
  const shape = new THREE.Shape()
    .moveTo(-margin, -width / 2)
    .lineTo(length + margin, -width / 2)
    .lineTo(length + margin, width / 2)
    .lineTo(-margin, width / 2)
    .closePath();
  for (let i = 0; i < holeCount; i++)
    shape.holes.push(squareHole(profile.holeSize, (length * i) / (holeCount - 1)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: profile.thickness, bevelEnabled: false });
  geometry.translate(0, 0, -profile.thickness / 2);
  return geometry;
}
export function ringGeometry(profile: GeometryProfile) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, profile.boardWidth / 2, 0, Math.PI * 2, false);
  shape.holes.push(squareHole(profile.holeSize));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: profile.thickness,
    bevelEnabled: false,
    curveSegments: 32,
  });
  geometry.translate(0, 0, -profile.thickness / 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}
export function maleGeometry(length: number, profile: GeometryProfile) {
  const body = new THREE.BoxGeometry(length, profile.boardWidth, profile.thickness);
  body.translate(length / 2, 0, 0);
  const peg = (x: number) => {
    const g = new THREE.BoxGeometry(profile.tenonLength, profile.tenonSize, profile.tenonSize);
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

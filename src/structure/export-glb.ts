import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { type Design, validateDesign } from "./design";
import { femaleGeometry, femaleLayerSign, maleGeometry, memberFrame, ringGeometry } from "./geometry";
import { ropeAttachments } from "./rope";
import { applyWoodTexture, createWoodTexture, type WoodTextures } from "./wood-texture";

/** Export the committed, undeformed model without viewport decorations or previews. */
export function createExportScene(design: Design) {
  validateDesign(design);
  if (design.version !== 6) throw new Error("GLBの実寸出力には図面規格の設計（v6）を使用してください");
  const scene = new THREE.Scene();
  scene.name = design.name;
  scene.userData = {
    format: "tsumiki-model",
    units: "metres",
    deformation: "none",
    designVersion: design.version,
  };
  const wood = new THREE.MeshStandardMaterial({ color: 0xd9bb85, roughness: 0.8 });
  const maleWood = new THREE.MeshStandardMaterial({ color: 0xa47546, roughness: 0.8 });
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: 0xc95732, roughness: 0.9 });
  const point = (id: string) => {
    const node = design.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Missing node: ${id}`);
    return new THREE.Vector3(...node.position);
  };
  for (const member of design.members) {
    const a = point(member.start),
      b = point(member.end);
    const frame = memberFrame(a, b, member.roll);
    const group = new THREE.Group();
    group.name = `${member.id}_${member.catalogId ?? member.kind}`;
    group.userData = { memberId: member.id, catalogId: member.catalogId, kind: member.kind };
    group.position.copy(a);
    group.quaternion.copy(frame.quaternion);
    if (member.kind === "female")
      group.position.addScaledVector(
        frame.z,
        femaleLayerSign(design, member, frame.z) * (member.layer + 0.5) * design.geometry.thickness,
      );
    const geometries =
      member.kind === "male"
        ? maleGeometry(a.distanceTo(b), design.geometry)
        : [femaleGeometry(a.distanceTo(b), design.geometry, member.holeCount, member)];
    geometries.forEach((geometry, i) => {
      const mesh = new THREE.Mesh(geometry, member.kind === "male" ? maleWood : wood);
      mesh.name = member.kind === "male" ? ["body", "tenon_start", "tenon_end"][i] : "board";
      group.add(mesh);
    });
    scene.add(group);
  }
  for (const ring of design.rings) {
    const host = design.members.find((m) => m.id === ring.member);
    if (!host) throw new Error(`Missing ring host: ${ring.member}`);
    const a = point(host.start),
      b = point(host.end),
      frame = memberFrame(a, b, host.roll);
    const mesh = new THREE.Mesh(ringGeometry(design.geometry), wood);
    mesh.name = `${ring.id}_ring`;
    mesh.userData = { ringId: ring.id };
    mesh.position
      .copy(ring.end === "start" ? a : b)
      .addScaledVector(
        frame.x,
        (ring.end === "start" ? -1 : 1) * (ring.slot + 0.5) * design.geometry.thickness,
      );
    mesh.quaternion.copy(frame.quaternion);
    scene.add(mesh);
  }
  for (const rope of design.ropes) {
    const group = new THREE.Group();
    group.name = `${rope.id}_rope`;
    group.userData = { ropeId: rope.id, radiusMetres: 0.006, radiusIsVisualizationOnly: true };
    const points = ropeAttachments(design, rope).map((p) => new THREE.Vector3(...p.position));
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        delta = b.clone().sub(a);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, delta.length(), 8), ropeMaterial);
      mesh.name = `segment_${i + 1}`;
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      group.add(mesh);
    }
    scene.add(group);
  }
  scene.updateMatrixWorld(true);
  return scene;
}
export async function exportDesignGlb(design: Design, textured = false): Promise<ArrayBuffer> {
  const scene = createExportScene(design);
  let texture: WoodTextures | null = null;
  try {
    if (textured) {
      texture = createWoodTexture();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && !object.parent?.userData.ropeId) {
          applyWoodTexture(
            object.geometry,
            object.material,
            texture as WoodTextures,
            object.parent?.userData.memberId ?? object.userData.ringId ?? object.name,
          );
        }
      });
    }
    const data = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(data instanceof ArrayBuffer)) throw new Error("GLB出力を生成できませんでした");
    return data;
  } finally {
    texture?.dispose();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      }
    });
    for (const material of materials) material.dispose();
  }
}

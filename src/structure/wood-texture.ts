import * as THREE from "three";

export type WoodTextures = {
  color: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  dispose: () => void;
};

/** Shared PBR atlases, allocated only in wood mode. No network or per-frame generation. */
export function createWoodTexture(): WoodTextures {
  const size = 1024;
  const heights = new Float32Array(size * size);
  const make = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("木目テクスチャを生成できませんでした");
    return { canvas, context, image: context.createImageData(size, size) };
  };
  const color = make(),
    normal = make(),
    roughness = make();
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = (y % (size / 2)) / (size / 2);
      const wave = Math.sin(tau * u);
      const knotX = Math.sin(tau * (u - 0.32)) / tau;
      const knotY = v - 0.62;
      const knot = Math.exp(-((knotX / 0.036) ** 2 + (knotY / 0.085) ** 2));
      const drift =
        0.065 * wave + 0.022 * Math.sin(tau * (u * 2 + v)) + 0.015 * Math.sin(tau * (u * 5 - v * 2));
      const field = v + drift + 0.09 * Math.exp(-((knotX / 0.1) ** 2)) * Math.tanh(knotY * 12);
      const radius = Math.hypot((u - 0.5) * 1.4, (v - 0.52) * 0.9);
      const phase = y >= size / 2 ? field * 12 : radius * 18 + 0.15 * Math.sin(u * 29 + v * 11);
      const rings = (Math.sin(tau * phase) * 0.5 + 0.5) ** 9;
      const broad = Math.sin(tau * field * 2.3) * 0.5 + 0.5;
      const fiber = (Math.sin(tau * (field * 155 + 0.08 * Math.sin(u * tau * 7))) * 0.5 + 0.5) ** 14;
      const noise = Math.sin(x * 127.1 + y * 311.7) * Math.sin(x * 13.3 - y * 17.1);
      const dark = 0.42 * rings + 0.13 * broad + 0.08 * fiber + (y >= size / 2 ? 0.56 * knot : 0);
      const i = (y * size + x) * 4;
      color.image.data[i] = 218 - dark * 98 + noise * 3;
      color.image.data[i + 1] = 181 - dark * 108 + noise * 3;
      color.image.data[i + 2] = 126 - dark * 91 + noise * 2;
      color.image.data[i + 3] = 255;
      heights[y * size + x] = rings * 0.4 + fiber * 0.12 + noise * 0.025;
      const rough = 178 + rings * 38 + fiber * 12;
      roughness.image.data.set([rough, rough, rough, 255], i);
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = heights[y * size + ((x + 1) % size)] - heights[y * size + ((x + size - 1) % size)];
      const dy = heights[Math.min(size - 1, y + 1) * size + x] - heights[Math.max(0, y - 1) * size + x];
      const n = new THREE.Vector3(-dx * 2, dy * 2, 1).normalize();
      normal.image.data.set(
        [(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255],
        (y * size + x) * 4,
      );
    }
  const textures = [color, normal, roughness].map((entry, i) => {
    entry.context.putImageData(entry.image, 0, 0);
    const texture = new THREE.CanvasTexture(entry.canvas);
    texture.name = ["wood-color", "wood-normal", "wood-roughness"][i];
    if (i === 0) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  });
  return {
    color: textures[0],
    normal: textures[1],
    roughness: textures[2],
    dispose: () => {
      for (const texture of textures) texture.dispose();
    },
  };
}

/** Local X follows the board length, independent of its world rotation. */
export function applyWoodTexture(
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
  texture: WoodTextures,
  id: string,
) {
  const position = geometry.getAttribute("position"),
    normal = geometry.getAttribute("normal");
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error("木材形状の範囲を取得できませんでした");
  const size = bounds.getSize(new THREE.Vector3());
  const hash = Array.from(id).reduce((value, c) => (value * 31 + c.charCodeAt(0)) >>> 0, 0);
  const offset = (hash % 1000) / 1000;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const y = (position.getY(i) - bounds.min.y) / Math.max(size.y, 1e-8);
    const z = (position.getZ(i) - bounds.min.z) / Math.max(size.z, 1e-8);
    if (Math.abs(normal.getX(i)) > 0.8) {
      uv[i * 2] = 0.05 + 0.9 * y;
      uv[i * 2 + 1] = 0.54 + 0.42 * z;
    } else {
      uv[i * 2] = position.getX(i) / 1.8 + offset;
      uv[i * 2 + 1] = 0.04 + 0.42 * (Math.abs(normal.getZ(i)) > 0.5 ? y : z);
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  material.color.setHSL(0.095 + (hash % 7) * 0.002, 0.06 + (hash % 5) * 0.008, 0.94 + (hash % 4) * 0.015);
  material.map = texture.color;
  material.normalMap = texture.normal;
  material.normalScale.set(0.3, 0.3);
  material.roughnessMap = texture.roughness;
  material.roughness = 1;
  material.needsUpdate = true;
}

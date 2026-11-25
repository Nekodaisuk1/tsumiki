import type { Material } from "./design";
import type { EngineeringResult } from "./engineering";
export type SectionLoad = EngineeringResult["elements"][number]["samples"][number];
/** Signed longitudinal stress; y spans width, z spans thickness in the beam frame. */
export function sectionStress(
  s: Pick<SectionLoad, "axial" | "my" | "mz" | "shearY" | "shearZ">,
  material: Material,
  width: number,
  thickness: number,
  y: number,
  z: number,
) {
  return {
    normalMPa: (s.axial / material.A + (s.my * z) / material.Iy - (s.mz * y) / material.Iz) / 1e6,
    shearYMPa: (((1.5 * s.shearY) / material.A) * (1 - ((2 * y) / width) ** 2)) / 1e6,
    shearZMPa: (((1.5 * s.shearZ) / material.A) * (1 - ((2 * z) / thickness) ** 2)) / 1e6,
  };
}
export function stressEnvelope(s: SectionLoad, material: Material, width: number, thickness: number) {
  return (
    (Math.abs(s.axial) / material.A +
      (Math.abs(s.my) * thickness) / 2 / material.Iy +
      (Math.abs(s.mz) * width) / 2 / material.Iz) /
    1e6
  );
}
export function memberStations(result: EngineeringResult, id: string) {
  const elements = result.elements.filter((e) => e.id === id);
  const stations: { x: number; sample: SectionLoad }[] = [];
  let offset = 0;
  for (const e of elements) {
    e.samples.forEach((sample, i) => {
      stations.push({ x: offset + (e.length * i) / (e.samples.length - 1), sample });
    });
    offset += e.length;
  }
  return stations;
}
export function stressColor(value: number, maximum: number, signed = false) {
  const t = Math.min(1, Math.abs(value) / Math.max(maximum, 1e-12));
  return signed
    ? value >= 0
      ? `rgb(240,${Math.round(235 - 170 * t)},${Math.round(235 - 170 * t)})`
      : `rgb(${Math.round(235 - 170 * t)},${Math.round(235 - 100 * t)},240)`
    : `hsl(${(1 - t) * 235} 85% 55%)`;
}

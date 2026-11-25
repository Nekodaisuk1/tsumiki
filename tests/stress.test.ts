import { expect, it } from "vitest";
import { createDrawingDesign } from "../src/structure/editor";
import { analyzeTimber } from "../src/structure/engineering";
import { memberStations, sectionStress, stressEnvelope } from "../src/structure/stress";

it("recovers tension/compression and rectangular shear with section-resultant equilibrium", () => {
  const d = createDrawingDesign("male-1200");
  d.nodes[0].fixed = true;
  d.nodes[1].fixed = false;
  const r = analyzeTimber(d, {
    preset: "C24",
    node: d.nodes[1].id,
    direction: "y",
    forceN: -100,
    selfWeight: false,
  });
  const points = memberStations(r, d.members[0].id),
    root = points[0].sample,
    b = d.geometry.boardWidth,
    h = d.geometry.thickness;
  expect(points).toHaveLength(41);
  expect(points.at(-1)?.x).toBeCloseTo(r.elements[0].length, 9);
  const top = sectionStress(root, r.material, b, h, b / 2, 0),
    bottom = sectionStress(root, r.material, b, h, -b / 2, 0);
  expect(top.normalMPa).toBeCloseTo(-bottom.normalMPa, 9);
  expect(Math.abs(top.normalMPa)).toBeCloseTo(r.members[0].normalMPa, 9);
  expect(top.shearYMPa).toBeCloseTo(0, 10);
  expect(stressEnvelope(points[points.length - 1].sample, r.material, b, h)).toBeCloseTo(0, 9);
  let axial = 0,
    my = 0,
    mz = 0,
    vy = 0,
    vz = 0;
  const s = { axial: 150, my: 12, mz: -20, shearY: 25, shearZ: -30 };
  for (let i = 0; i < 100; i++)
    for (let j = 0; j < 100; j++) {
      const y = ((i + 0.5) / 100 - 0.5) * b,
        z = ((j + 0.5) / 100 - 0.5) * h,
        a = (b * h) / 10000,
        t = sectionStress(s, r.material, b, h, y, z);
      axial += t.normalMPa * 1e6 * a;
      my += t.normalMPa * 1e6 * z * a;
      mz -= t.normalMPa * 1e6 * y * a;
      vy += t.shearYMPa * 1e6 * a;
      vz += t.shearZMPa * 1e6 * a;
    }
  expect(axial).toBeCloseTo(s.axial, 5);
  expect(my).toBeCloseTo(s.my, 2);
  expect(mz).toBeCloseTo(s.mz, 2);
  expect(vy).toBeCloseTo(s.shearY, 2);
  expect(vz).toBeCloseTo(s.shearZ, 2);
});

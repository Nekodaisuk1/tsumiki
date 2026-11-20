import { describe, expect, it } from "vitest";
import { createDesign } from "../src/structure/design";
import { createDrawingDesign } from "../src/structure/editor";
import { analyzeTimber, type EngineeringSettings, TIMBER_PRESETS } from "../src/structure/engineering";

function cantilever() {
  const d = createDrawingDesign("male-1200");
  d.nodes[0].fixed = true;
  d.nodes[1].fixed = false;
  return d;
}
function settings(d: ReturnType<typeof cantilever>): EngineeringSettings {
  return { preset: "C24", node: d.nodes[1].id, direction: "y", forceN: -100, selfWeight: false };
}
describe("SI timber static reference analysis", () => {
  it("matches cantilever tip load deflection, root stress and support equilibrium", () => {
    const d = cantilever(),
      s = settings(d),
      before = JSON.stringify(d);
    const r = analyzeTimber(d, s),
      l = r.elements[0].length;
    expect(r.maxDisplacementMm).toBeCloseTo(((100 * l ** 3) / (3 * r.material.E * r.material.Iz)) * 1000, 7);
    expect(r.members[0].normalMPa).toBeCloseTo((100 * l * 0.105) / (2 * r.material.Iz) / 1e6, 7);
    expect(r.reactions[1]).toBeCloseTo(100, 7);
    expect(r.reactions[5]).toBeCloseTo(100 * l, 7);
    expect(r.elements[0].samples[0].displacement).toEqual([0, 0, 0]);
    expect(JSON.stringify(d)).toBe(before);
  });
  it("scales linearly with force and inversely with stiffness", () => {
    const d = cantilever(),
      s = settings(d),
      a = analyzeTimber(d, s);
    const b = analyzeTimber(d, { ...s, forceN: -200 });
    expect(b.maxDisplacementMm / a.maxDisplacementMm).toBeCloseTo(2, 9);
    expect(b.members[0].normalMPa / a.members[0].normalMPa).toBeCloseTo(2, 9);
    const c = analyzeTimber(d, { ...s, preset: "C16" });
    expect(c.maxDisplacementMm / a.maxDisplacementMm).toBeCloseTo(
      TIMBER_PRESETS.C24.E / TIMBER_PRESETS.C16.E,
      9,
    );
  });
  it("uses the weak axis after a 90 degree roll", () => {
    const d = cantilever(),
      s = settings(d),
      a = analyzeTimber(d, s);
    d.members[0].roll = 90;
    const b = analyzeTimber(d, s);
    expect(b.maxDisplacementMm / a.maxDisplacementMm).toBeCloseTo((0.105 / 0.03) ** 2, 7);
    expect(b.members[0].normalMPa / a.members[0].normalMPa).toBeCloseTo(0.105 / 0.03, 7);
  });
  it("matches distributed self-weight at the tip and at midspan", () => {
    const d = cantilever(),
      r = analyzeTimber(d, { ...settings(d), forceN: 0, selfWeight: true });
    const m = r.material,
      l = r.elements[0].length,
      q = m.density * m.A * 9.80665;
    expect(r.maxDisplacementMm).toBeCloseTo(((q * l ** 4) / (8 * m.E * m.Iz)) * 1000, 7);
    const x = l / 2;
    expect(r.elements[0].samples[20].displacement[1]).toBeCloseTo(
      (-q * x * x * (6 * l * l - 4 * l * x + x * x)) / (24 * m.E * m.Iz),
      10,
    );
    expect(r.reactions[1]).toBeCloseTo(q * l, 7);
    expect(r.members[0].normalMPa).toBeCloseTo((((q * l * l) / 2) * 0.105) / (2 * m.Iz) / 1e6, 7);
  });
  it("handles axial load and rejects legacy, nonfinite and fixed-node inputs", () => {
    const d = cantilever(),
      s = settings(d);
    const r = analyzeTimber(d, { ...s, direction: "x", forceN: 100 });
    expect(r.members[0].normalMPa).toBeCloseTo(100 / r.material.A / 1e6, 9);
    expect(r.maxDisplacementMm).toBeCloseTo(
      ((100 * r.elements[0].length) / (r.material.E * r.material.A)) * 1000,
      9,
    );
    expect(() => analyzeTimber(createDesign(), s)).toThrow("v6");
    expect(() => analyzeTimber(d, { ...s, forceN: Number.NaN })).toThrow();
    expect(() => analyzeTimber(d, { ...s, node: d.nodes[0].id })).toThrow("固定");
  });
});

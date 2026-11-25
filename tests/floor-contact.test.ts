import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";
import { analyzeTimber, type EngineeringSettings } from "../src/structure/engineering";

const settings = (node: string): EngineeringSettings => ({
  preset: "C24",
  node,
  direction: "x",
  forceN: 0,
  selfWeight: true,
  support: "floor",
  friction: 0.5,
});

describe("unclamped floor contact", () => {
  it("supports self-weight with compression only and ignores saved fixed flags", () => {
    const d = createDrawingDesign();
    const s = settings(d.nodes[0].id);
    const r = analyzeTimber(d, s);
    expect(r.ground).not.toBeNull();
    const n = r.ground?.contacts.reduce((sum, c) => sum + c.force[1], 0) ?? 0;
    const weight = r.elements.reduce(
      (sum, e) => sum + e.length * r.material.density * r.material.A * 9.80665,
      0,
    );
    expect(n).toBeCloseTo(weight, 4);
    for (const c of r.ground?.contacts ?? []) {
      expect(c.force[1]).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(c.force[0], c.force[2])).toBeLessThanOrEqual(0.5 * c.force[1] + 1e-7);
    }
    d.nodes.forEach((n) => {
      n.fixed = false;
    });
    const free = analyzeTimber(d, s);
    expect(free.maxDisplacementMm).toBeCloseTo(r.maxDisplacementMm, 7);
  });
  it("holds a small horizontal load but does not invent support above the friction limit", () => {
    const d = createDrawingDesign();
    const r = analyzeTimber(d, { ...settings(d.nodes[0].id), forceN: 1 });
    expect(r.ground?.contacts.reduce((sum, c) => sum + c.force[0], 0)).toBeCloseTo(-1, 4);
    expect(() => analyzeTimber(d, { ...settings(d.nodes[0].id), forceN: 100 })).toThrow(/滑り|摩擦/);
  });
  it("supports weight with zero friction and rejects a horizontal force", () => {
    const d = createDrawingDesign();
    expect(analyzeTimber(d, { ...settings(d.nodes[0].id), friction: 0 }).ground).not.toBeNull();
    expect(() => analyzeTimber(d, { ...settings(d.nodes[0].id), friction: 0, forceN: 1 })).toThrow();
  });
  it("does not let the floor pull down an uplifted structure", () => {
    const d = createDrawingDesign();
    expect(() => analyzeTimber(d, { ...settings(d.nodes[0].id), direction: "y", forceN: 100 })).toThrow();
  });
  it("does not clamp an upright member against overturning and is independent of endpoint order", () => {
    const d = createDrawingDesign("male-1200");
    const length = Math.abs(d.nodes[1].position[0] - d.nodes[0].position[0]);
    d.nodes[0].position = [0, 0, 0];
    d.nodes[1].position = [0, length, 0];
    const baseline = analyzeTimber(d, settings(d.nodes[1].id));
    expect(baseline.ground?.contacts.every((c) => c.point[1] < 0)).toBe(true);
    expect(() => analyzeTimber(d, { ...settings(d.nodes[1].id), forceN: 10 })).toThrow();
    const reversed = structuredClone(d);
    [reversed.members[0].start, reversed.members[0].end] = [d.members[0].end, d.members[0].start];
    const other = analyzeTimber(reversed, settings(d.nodes[1].id));
    expect(other.maxDisplacementMm).toBeCloseTo(baseline.maxDisplacementMm, 5);
  });
  it("balances an assembly joined through an interior hole", () => {
    const d = createDrawingDesign();
    insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, 1);
    d.members[1].roll = 90;
    const r = analyzeTimber(d, settings(d.nodes[0].id));
    const weight = r.elements.reduce(
      (sum, e) => sum + e.length * r.material.density * r.material.A * 9.80665,
      0,
    );
    expect(r.ground?.contacts.reduce((sum, c) => sum + c.force[1], 0)).toBeCloseTo(weight, 3);
    expect(r.ground?.residual).toBeLessThan(1e-3);
  });
});

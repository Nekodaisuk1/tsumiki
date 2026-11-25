import { describe, expect, it } from "vitest";
import { analyze, corners, distance, relax, ropeLength } from "../src/model";

const base = { angle: 65, ratio: 1.45, restLength: 3, stiffness: 8 };
describe("point rope model", () => {
  it("preserves rigid side lengths while the frame shears", () => {
    for (const angle of [25, 65, 90, 135, 155]) {
      const p = corners(angle, 1.45);
      expect(distance(p.A, p.B)).toBeCloseTo(1.45);
      expect(distance(p.D, p.C)).toBeCloseTo(1.45);
      expect(distance(p.A, p.D)).toBeCloseTo(1);
      expect(distance(p.B, p.C)).toBeCloseTo(1);
    }
  });
  it("uses both diagonals and the male side BC in the rope route", () => {
    expect(ropeLength(90, 1.45)).toBeCloseTo(2 * Math.hypot(1.45, 1) + 1);
  });
  it("has maximum path length at a rectangle, not a minimum", () => {
    for (const ratio of [0.6, 1, 1.45, 2]) {
      for (const angle of [25, 65, 85, 95, 135, 155]) {
        expect(ropeLength(angle, ratio)).toBeLessThan(ropeLength(90, ratio));
      }
    }
  });
  it("does not generate compression when slack", () => {
    const result = analyze({ ...base, restLength: 10 });
    expect(result.tension).toBe(0);
    expect(result.energy).toBe(0);
    expect(result.forces.A).toEqual({ x: 0, y: 0 });
  });
  it("conserves the net rope force and moment", () => {
    const result = analyze(base);
    const sum = Object.values(result.forces).reduce((a, f) => ({ x: a.x + f.x, y: a.y + f.y }), {
      x: 0,
      y: 0,
    });
    expect(sum.x).toBeCloseTo(0);
    expect(sum.y).toBeCloseTo(0);
    let moment = 0;
    for (const key of ["A", "B", "C", "D"] as const) {
      const p = result.points[key];
      const f = result.forces[key];
      moment += p.x * f.y - p.y * f.x;
    }
    expect(moment).toBeCloseTo(0);
  });
  it("matches the analytical torque to the energy gradient", () => {
    const epsilon = 0.00001;
    const plus = analyze({ ...base, angle: base.angle + (epsilon * 180) / Math.PI });
    const minus = analyze({ ...base, angle: base.angle - (epsilon * 180) / Math.PI });
    expect(analyze(base).torque).toBeCloseTo(-(plus.energy - minus.energy) / (2 * epsilon), 6);
  });
  it("relaxes away from a rectangle under tension and reduces energy", () => {
    const next = relax(base, 1 / 30);
    expect(next).toBeLessThan(base.angle);
    expect(analyze({ ...base, angle: next }).energy).toBeLessThan(analyze(base).energy);
    expect(relax({ ...base, angle: 115 }, 1 / 30)).toBeGreaterThan(115);
  });
  it("keeps an exactly rectangular symmetric state stationary", () => {
    expect(relax({ ...base, angle: 90 }, 1 / 30)).toBeCloseTo(90);
    expect(analyze({ ...base, angle: 89.9 }).torque).toBeLessThan(0);
    expect(analyze({ ...base, angle: 90.1 }).torque).toBeGreaterThan(0);
  });
  it("rejects invalid parameters and bounds the experimental domain", () => {
    expect(() => corners(Number.NaN, 1)).toThrow(RangeError);
    expect(() => analyze({ ...base, restLength: -1 })).toThrow(RangeError);
    expect(() => relax(base, 1)).toThrow(RangeError);
    expect(relax({ ...base, angle: 25 }, 1 / 30)).toBe(25);
    expect(relax({ ...base, angle: 155 }, 1 / 30)).toBe(155);
  });
});

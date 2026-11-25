import { describe, expect, it } from "vitest";
import { type LocalSettings, solveLocal } from "../src/structure/local-fem";

const settings: LocalSettings = {
  kind: "plain",
  mode: "traction",
  width: 0.105,
  thickness: 0.03,
  holeDiameter: 0.039,
  tenonWidth: 0.03,
  tenonLength: 0.165,
  E: 11e9,
  transverseE: 11e9 / 30,
  G: 690e6,
  poisson: 0.3,
  axialN: 1000,
  shearN: 0,
  momentNm: 0,
  refinement: 1,
  pinTravel: 0.0006,
  clearance: 0.0005,
};
describe("local orthotropic FEM", () => {
  it("passes a uniform uniaxial patch test with transverse contraction", () => {
    const r = solveLocal(settings),
      expected = settings.axialN / settings.width / settings.thickness / 1e6;
    for (const stress of r.stresses) {
      expect(stress.sx).toBeCloseTo(expected, 5);
      expect(stress.sy).toBeCloseTo(0, 5);
      expect(stress.shear).toBeCloseTo(0, 5);
    }
    expect(r.applied[0]).toBeCloseTo(1000, 7);
    expect(r.reaction[0]).toBeCloseTo(-1000, 4);
    expect(r.freeResidual).toBeLessThan(1e-4);
  });
  it("resolves a hole concentration and reports mesh sensitivity", () => {
    const coarse = solveLocal({ ...settings, kind: "hole" });
    const fine = solveLocal({ ...settings, kind: "hole", refinement: 2 });
    expect(fine.mesh.triangles.length).toBeGreaterThan(coarse.mesh.triangles.length);
    expect(fine.peakMPa).toBeGreaterThan((1000 / 0.105 / 0.03 / 1e6) * 2);
    expect(fine.reaction[0]).toBeCloseTo(-1000, 3);
    const doubled = solveLocal({ ...settings, kind: "hole", axialN: 2000 });
    expect(doubled.peakMPa).toBeCloseTo(coarse.peakMPa * 2, 5);
  });
  it("handles an open gap and compression-only pin bearing", () => {
    const open = solveLocal({ ...settings, kind: "hole", mode: "pin", pinTravel: 0.0004 });
    expect(open.peakMPa).toBe(0);
    const contact = solveLocal({ ...settings, kind: "hole", mode: "pin" });
    expect(contact.applied[1]).toBeGreaterThan(0);
    expect(contact.reaction[1]).toBeCloseTo(-contact.applied[1], 3);
    expect(Math.abs(contact.applied[0])).toBeLessThan(1e-3);
    expect(contact.freeResidual).toBeLessThan(1e-3);
  });
  it("loads a tenon tip and balances reactions", () => {
    const r = solveLocal({ ...settings, kind: "tenon", axialN: 0, shearN: 100 });
    expect(r.reaction[1]).toBeCloseTo(-100, 3);
    expect(r.peakMPa).toBeGreaterThan(0);
    expect(r.appliedMoment).toBeCloseTo(settings.tenonLength * 100, 6);
    expect(r.reactionMoment).toBeCloseTo(-r.appliedMoment, 4);
  });
});

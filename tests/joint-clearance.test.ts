import { describe, expect, it } from "vitest";
import { createDesign, type Design, parseDesign, serializeDesign } from "../src/structure/design";
import { insertMaleAtHole } from "../src/structure/editor";
import { simulate, solveStatic, squareTorsionGap } from "../src/structure/solver";

/** A female board hanging from the tenon of a fixed male, free at the far end. */
function boardOnTenon(): Design {
  const d = createDesign();
  d.nodes = [
    { id: "a", position: [0, 0, 0], fixed: true },
    { id: "b", position: [1, 0, 0], fixed: true },
    { id: "c", position: [1, 1, 0], fixed: false },
  ];
  d.members = [
    { id: "male", kind: "male", start: "a", end: "b", material: "wood", roll: 0, layer: 0, holeCount: 7 },
    { id: "board", kind: "female", start: "b", end: "c", material: "wood", roll: 90, layer: 0, holeCount: 7 },
  ];
  d.ropes = [];
  d.rings = [];
  d.analysis = { ...d.analysis, loadNode: "c", direction: "x", force: 0, torque: 0, gravity: 0 };
  return d;
}
const rotationAboutShaft = (design: Design, torque: number) => {
  design.analysis.torque = torque;
  const c = design.nodes.findIndex((n) => n.id === "c");
  return solveStatic(design, "none").displacement[c * 6 + 3];
};
const lateral = (model: Design["jointModel"], force: number) => {
  const d = createDesign();
  d.jointModel = model;
  d.analysis.gravity = 0;
  d.analysis.force = force;
  return solveStatic(d, "none").maxDisplacement;
};

describe("clearance contact joint", () => {
  it("follows the bilinear torsion law of a square tenon in a square hole", () => {
    const rigid = boardOnTenon();
    rigid.jointModel = "rigid-approximation";
    const contact = boardOnTenon();
    const { tenonSize, holeSize } = contact.geometry;
    const open = (contact.joint.openStiffness * tenonSize ** 2) / 2;
    const closed = (contact.joint.contactStiffness * tenonSize ** 2) / 2;
    const gap = squareTorsionGap(tenonSize, holeSize);
    expect(gap).toBeGreaterThan(0);
    const inside = 0.5 * open * gap;
    expect(rotationAboutShaft(contact, inside) - rotationAboutShaft(rigid, inside)).toBeCloseTo(
      inside / open,
      8,
    );
    const seated = 0.01;
    expect(rotationAboutShaft(contact, seated) - rotationAboutShaft(rigid, seated)).toBeCloseTo(
      (seated + closed * gap) / (open + closed),
      8,
    );
  });
  it("adds only the contact compliance along the shaft, where no clearance is modeled", () => {
    const shaftLoad = (model: Design["jointModel"]) => {
      const d = createDesign();
      d.nodes = [
        { id: "a", position: [0, 0, 0], fixed: true },
        { id: "b", position: [0, 1.2, 0], fixed: true },
      ];
      d.members = [
        {
          id: "board",
          kind: "female",
          start: "a",
          end: "b",
          material: "wood",
          roll: 90,
          layer: 0,
          holeCount: 7,
        },
      ];
      d.ropes = [];
      d.rings = [];
      d.jointModel = model;
      const male = insertMaleAtHole(d, "board", 3, 1, 1);
      d.analysis = {
        ...d.analysis,
        loadNode: male.nodeId,
        direction: "x",
        force: 0.01,
        torque: 0,
        gravity: 0,
      };
      const index = d.nodes.findIndex((n) => n.id === male.nodeId) * 6;
      return { u: solveStatic(d, "none").displacement[index], kc: d.joint.contactStiffness };
    };
    const contact = shaftLoad("clearance-contact");
    expect(contact.u - shaftLoad("rigid-approximation").u).toBeCloseTo(0.01 / contact.kc, 10);
  });
  it("shows slop first and then a constant seated stiffness under increasing load", () => {
    const slop = lateral("clearance-contact", 0.08) - lateral("rigid-approximation", 0.08);
    expect(slop).toBeGreaterThan(10 * lateral("rigid-approximation", 0.08));
    const first = lateral("clearance-contact", 0.16) - lateral("clearance-contact", 0.08);
    const second = lateral("clearance-contact", 0.24) - lateral("clearance-contact", 0.16);
    expect(second / first).toBeCloseTo(1, 2);
    // The seated joint is semi-rigid: board-face bearing gives a finite rocking stiffness.
    const elastic = lateral("rigid-approximation", 0.16) - lateral("rigid-approximation", 0.08);
    expect(first).toBeGreaterThan(elastic);
  });
  it("keeps equilibrium, tension-only ropes and nonnegative contact forces in every case", () => {
    for (const ropeWrap of ["sliding", "locked"] as const)
      for (const mode of ["none", "slack", "taut"] as const) {
        const d = createDesign();
        d.ropeWrap = ropeWrap;
        const result = solveStatic(d, mode);
        expect(result.residual).toBeLessThan(1e-8);
        expect(result.ropeSegmentTensions.every((s) => s.tension >= 0)).toBe(true);
        expect(result.joints.every((j) => j.contactForce >= 0 && Number.isFinite(j.utilization))).toBe(true);
        expect(result.notes).toEqual([]);
      }
  });
});

describe("rope tightening with clearance joints", () => {
  const response = (ropeWrap: Design["ropeWrap"], mode: "none" | "taut", prestrain = 0.002, force = 0.08) => {
    const d = createDesign();
    d.ropeWrap = ropeWrap;
    d.analysis.force = force;
    d.ropes.forEach((r) => {
      r.prestrain = prestrain;
    });
    return solveStatic(d, mode);
  };
  it("cannot resist racking when the continuous rope slides freely around the tenons", () => {
    const none = response("sliding", "none").maxDisplacement;
    expect(Math.abs(response("sliding", "taut").maxDisplacement - none) / none).toBeLessThan(0.05);
  });
  it("seats the joints when the rope cannot slip at the wraps", () => {
    const none = response("locked", "none").maxDisplacement;
    expect(response("locked", "taut").maxDisplacement).toBeLessThan(none / 20);
    expect(response("locked", "taut").initialJoints.some((j) => j.closed)).toBe(true);
    expect(response("locked", "none").initialJoints.some((j) => j.closed)).toBe(false);
  });
  it("reaches the wound tension and keeps joints seated under larger loads when wound harder", () => {
    const wound = response("locked", "taut", 0.002);
    const d = createDesign();
    for (const t of wound.initialRopeTensions) expect(t).toBeCloseTo(d.ropes[0].stiffness * 0.002, 8);
    const at = (prestrain: number, force: number) =>
      response("locked", "taut", prestrain, force).maxDisplacement;
    expect(at(0.0005, 0.3)).toBeLessThan(at(0, 0.3));
    expect(at(0.002, 0.3)).toBeLessThan(at(0, 0.3) / 4);
    expect(at(0.008, 1)).toBeLessThan(at(0.002, 1) * 0.6);
  });
  it("flags dynamic responses that would open or close joint contacts", () => {
    const result = simulate(createDesign(), "none", "force");
    expect(Number.isFinite(result.peak)).toBe(true);
    expect(result.contactSwitch).toBe(true);
  });
});

describe("design format v5", () => {
  it("keeps v4 files on rigid joints so earlier results stay reproducible", () => {
    const { joint, ropeWrap, ...rest } = createDesign();
    void joint;
    void ropeWrap;
    const v4 = { ...rest, version: 4, solver: "frame3d-linear-v4", jointModel: "rigid-approximation" };
    const restored = parseDesign(JSON.stringify(v4));
    expect(restored.version).toBe(5);
    expect(restored.jointModel).toBe("rigid-approximation");
    expect(restored.ropeWrap).toBe("sliding");
    expect(() => parseDesign(JSON.stringify({ ...v4, jointModel: "clearance-contact" }))).toThrow();
  });
  it("round trips joint parameters and rejects inconsistent ones", () => {
    const d = createDesign();
    d.ropeWrap = "locked";
    d.joint.contactStiffness = 500;
    expect(parseDesign(serializeDesign(d))).toEqual(d);
    d.joint.openStiffness = 600;
    expect(() => serializeDesign(d)).toThrow(/隙間/);
    const unknown = createDesign() as unknown as Record<string, unknown>;
    unknown.ropeWrap = "glued";
    expect(() => parseDesign(JSON.stringify(unknown))).toThrow();
  });
});

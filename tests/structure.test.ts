import { describe, expect, it } from "vitest";
import { createDesign, parseDesign, serializeDesign } from "../src/structure/design";
import { createNewmarkStepper, simulate, solveStatic } from "../src/structure/solver";

describe("reproducible structural design", () => {
  it("round trips the complete design and produces identical analysis", () => {
    const design = createDesign();
    const restored = parseDesign(serializeDesign(design));
    expect(restored).toEqual(design);
    expect(solveStatic(restored, "taut").displacement).toEqual(solveStatic(design, "taut").displacement);
  });
  it("rejects unknown versions, missing references and nonfinite values", () => {
    const design = createDesign();
    expect(() => parseDesign(JSON.stringify({ ...design, version: 99 }))).toThrow();
    design.members[0].start = "missing";
    expect(() => parseDesign(JSON.stringify(design))).toThrow();
    const invalid = createDesign();
    invalid.nodes[0].position[0] = Number.NaN;
    expect(() => serializeDesign(invalid)).toThrow();
  });
});

describe("three-dimensional frame solver", () => {
  it("matches cantilever bending and torsion theory", () => {
    const design = createDesign();
    design.nodes = [
      { id: "base", position: [0, 0, 0], fixed: true },
      { id: "tip", position: [0, 1, 0], fixed: false },
    ];
    design.members = [
      {
        id: "beam",
        kind: "male",
        start: "base",
        end: "tip",
        material: "wood",
        roll: 0,
        layer: 0,
        holeCount: 7,
      },
    ];
    design.ropes = [];
    design.rings = [];
    design.analysis.loadNode = "tip";
    design.analysis.direction = "x";
    design.analysis.force = 0.01;
    design.analysis.gravity = 0;
    const material = design.materials[0];
    const result = solveStatic(design, "none");
    expect(result.displacement[6]).toBeCloseTo(0.01 / (3 * material.E * material.Iz), 8);
    expect(result.reactions[0]).toBeCloseTo(-0.01, 8);
    design.analysis.force = 0;
    design.analysis.torque = 0.01;
    design.analysis.direction = "y";
    const twisted = solveStatic(design, "none");
    expect(twisted.displacement[10]).toBeCloseTo(0.01 / (material.G * material.J), 8);
  });
  it("detects unsupported rigid body motion", () => {
    const design = createDesign();
    for (const node of design.nodes) node.fixed = false;
    expect(() => solveStatic(design, "none")).toThrow(/拘束|支持/);
  });
  it("preserves force equilibrium and computes out-of-plane response", () => {
    const design = createDesign();
    design.analysis.gravity = 0;
    design.analysis.direction = "z";
    const result = solveStatic(design, "none");
    expect(result.displacement.some((u, i) => i % 6 === 2 && Math.abs(u) > 0)).toBe(true);
    const supportForce = result.reactions.filter((_, i) => i % 6 === 2).reduce((a, b) => a + b, 0);
    expect(supportForce).toBeCloseTo(-design.analysis.force, 7);
    expect(result.residual).toBeLessThan(1e-8);
  });
  it("uses tension-only ropes and identical excitation across reinforcement cases", () => {
    const design = createDesign();
    const slack = solveStatic(design, "slack");
    expect(slack.ropeTensions).toHaveLength(design.ropes.length);
    expect(slack.ropeTensions.every((t) => t >= 0)).toBe(true);
    const a = simulate(design, "none", "force");
    const b = simulate(design, "taut", "force");
    expect(a.times).toEqual(b.times);
    expect(a.input).toEqual(b.input);
    expect(a.values.every(Number.isFinite)).toBe(true);
    expect(b.values.every(Number.isFinite)).toBe(true);
  });
  it("treats base acceleration separately from applied force", () => {
    const design = createDesign();
    const force = simulate(design, "none", "force");
    const base = simulate(design, "none", "base");
    expect(force.input).not.toEqual(base.input);
    expect(force.values).not.toEqual(base.values);
  });
});

it("matches the exact undamped harmonic oscillator response and converges with time step", () => {
  const omega0 = 4;
  const omega = 2;
  function error(dt: number) {
    const step = createNewmarkStepper([[omega0 ** 2]], [1], [0], dt);
    let displacement = 0;
    for (let i = 1; i <= Math.round(2 / dt); i++) displacement = step([Math.sin(omega * i * dt)])[0];
    const exact =
      (Math.sin(omega * 2) - (omega / omega0) * Math.sin(omega0 * 2)) / (omega0 ** 2 - omega ** 2);
    return Math.abs(displacement - exact);
  }
  expect(error(0.005)).toBeLessThan(1e-5);
  expect(error(0.005)).toBeLessThan(error(0.01) / 3);
});

it("matches an oblique 3D cantilever with axial and bending compliance", () => {
  const d = createDesign();
  d.nodes = [
    { id: "base", position: [0, 0, 0], fixed: true },
    { id: "tip", position: [1, 1, 1], fixed: false },
  ];
  d.members = [
    {
      id: "beam",
      kind: "male",
      start: "base",
      end: "tip",
      material: "wood",
      roll: 0,
      layer: 0,
      holeCount: 7,
    },
  ];
  d.ropes = [];
  d.rings = [];
  d.analysis.loadNode = "tip";
  d.analysis.direction = "x";
  d.analysis.force = 0.01;
  d.analysis.gravity = 0;
  const length = Math.sqrt(3);
  const m = d.materials[0];
  const expected = d.analysis.force * (length / (3 * m.E * m.A) + (2 * length ** 3) / (9 * m.E * m.Iz));
  expect(solveStatic(d, "none").displacement[6]).toBeCloseTo(expected, 8);
});
it("has no spontaneous vibration without excitation", () => {
  const d = createDesign();
  d.analysis.force = 0;
  d.analysis.torque = 0;
  const result = simulate(d, "taut", "force");
  expect(result.peak).toBe(0);
  expect(result.values.every((v) => v === 0)).toBe(true);
});
it("rejects duplicate IDs, zero length, unknown fields and inconsistent time windows", () => {
  const a = createDesign();
  a.nodes[1].id = a.nodes[0].id;
  expect(() => serializeDesign(a)).toThrow(/重複/);
  const b = createDesign();
  b.nodes[4].position = [...b.nodes[0].position];
  expect(() => serializeDesign(b)).toThrow(/ゼロ/);
  const c = createDesign();
  c.analysis.excitationStop = 9;
  expect(() => serializeDesign(c)).toThrow();
  expect(() => parseDesign(JSON.stringify({ ...createDesign(), extra: true }))).toThrow(/未対応/);
});

it("rotates anisotropic beam section axes consistently with the displayed board", () => {
  const d = createDesign();
  d.nodes = [
    { id: "base", position: [0, 0, 0], fixed: true },
    { id: "tip", position: [0, 1, 0], fixed: false },
  ];
  d.members = [
    {
      id: "beam",
      kind: "male",
      start: "base",
      end: "tip",
      material: "wood",
      roll: 0,
      layer: 0,
      holeCount: 7,
    },
  ];
  d.ropes = [];
  d.rings = [];
  d.analysis.loadNode = "tip";
  d.analysis.force = 0.01;
  d.analysis.gravity = 0;
  d.materials[0].Iy = 0.0002;
  d.materials[0].Iz = 0.001;
  const flat = solveStatic(d, "none").displacement[6];
  d.members[0].roll = 90;
  const rotated = solveStatic(d, "none").displacement[6];
  expect(rotated / flat).toBeCloseTo(5, 7);
});

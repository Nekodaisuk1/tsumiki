import { expect, it } from "vitest";
import { createDesign, type Design, parseDesign, serializeDesign, type Vec3 } from "../src/structure/design";
import { insertMaleAtHole } from "../src/structure/editor";

function pair(kindA: "male" | "female", kindB: "male" | "female", start: Vec3, end: Vec3): Design {
  const d = createDesign();
  d.ropes = [];
  d.nodes = [
    { id: "a", position: [0, 0, 0], fixed: true },
    { id: "b", position: [1, 0, 0], fixed: false },
    { id: "c", position: start, fixed: false },
    { id: "d", position: end, fixed: false },
  ];
  d.members = [
    { id: "first", kind: kindA, start: "a", end: "b", material: "wood", roll: 0, layer: 0, holeCount: 2 },
    { id: "second", kind: kindB, start: "c", end: "d", material: "wood", roll: 0, layer: 0, holeCount: 2 },
  ];
  d.analysis.loadNode = "b";
  return d;
}

it.each([
  ["male", "male"],
  ["female", "female"],
  ["male", "female"],
] as const)("rejects crossing %s and %s solids even with different node IDs", (a, b) => {
  const d = pair(a, b, [0.3, -0.5, 0], [0.7, 0.5, 0]);
  expect(() => serializeDesign(d)).toThrow(/first.*second.*干渉/);
  expect(() => parseDesign(JSON.stringify(d))).toThrow(/干渉/);
});
it("allows touching faces but rejects a small penetration", () => {
  const d = pair("male", "male", [0, 0.18, 0], [1, 0.18, 0]);
  expect(() => serializeDesign(d)).not.toThrow();
  d.nodes[2].position[1] -= 1e-6;
  d.nodes[3].position[1] -= 1e-6;
  expect(() => serializeDesign(d)).toThrow(/干渉/);
});
it("does not confuse overlapping world bounds with rotated solid overlap", () => {
  const d = pair("male", "male", [0, 0.3, 0], [1, 0.3, 0]);
  for (const n of d.nodes) {
    const [x, y, z] = n.position;
    n.position = [(x - y) / Math.SQRT2, (x + y) / Math.SQRT2, z];
  }
  expect(() => serializeDesign(d)).not.toThrow();
});
it("rejects overlapping tenons beyond the bodies", () => {
  const d = pair("male", "male", [1.3, 0, 0], [2.3, 0, 0]);
  expect(() => serializeDesign(d)).toThrow(/干渉/);
});
it("allows true hole insertion but rejects a rotated square tenon cutting the hole walls", () => {
  const d = createDesign();
  const added = insertMaleAtHole(d, "m4", 3, 1, 1);
  expect(() => serializeDesign(d)).not.toThrow();
  const male = d.members.find((m) => m.id === added.memberId);
  if (!male) throw new Error("Missing inserted member");
  male.roll = 45;
  expect(() => serializeDesign(d)).toThrow(/干渉/);
});
it("rejects female boards crossing on the same occupied layer", () => {
  const d = createDesign();
  d.members[8].layer = 0;
  expect(() => serializeDesign(d)).toThrow(/干渉/);
});

it("rejects complete containment without relying on surface crossings", () => {
  const d = pair("male", "male", [0.3, 0, 0], [0.6, 0, 0]);
  expect(() => serializeDesign(d)).toThrow(/干渉/);
});

it("preserves collision decisions under a rigid three-dimensional rotation", () => {
  const d = pair("female", "female", [0.3, -0.5, 0], [0.7, 0.5, 0]);
  // Rotate around world X: the member roll rotates the cross-section with the endpoints.
  const angle = Math.PI / 6;
  for (const n of d.nodes) {
    const [x, y, z] = n.position;
    n.position = [x, y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)];
  }
  // Keep both boards in the same transformed plane through their explicit normals.
  // The first board lies along X and its roll directly specifies the plane rotation.
  d.members[0].roll = 30;
  // The second member's reference frame is different after the spatial rotation.
  const [dx, dy, dz] = d.nodes[3].position.map((v, i) => v - d.nodes[2].position[i]);
  const length = Math.hypot(dx, dy, dz);
  const horizontal = Math.hypot(dx, dy);
  const normalZ = Math.cos(angle);
  const normalY = -Math.sin(angle);
  const referenceY = [-dy / horizontal, dx / horizontal, 0];
  const referenceZ = [
    (-dz * dx) / (length * horizontal),
    (-dz * dy) / (length * horizontal),
    horizontal / length,
  ];
  d.members[1].roll =
    (Math.atan2(-normalY * referenceY[1], normalY * referenceZ[1] + normalZ * referenceZ[2]) * 180) / Math.PI;
  expect(() => serializeDesign(d)).toThrow(/干渉/);
});

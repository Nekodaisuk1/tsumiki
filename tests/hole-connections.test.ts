import { expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { createDesign, parseDesign, serializeDesign } from "../src/structure/design";
import {
  connectThreadedMales,
  createDrawingDesign,
  insertMaleAtHole,
  shareTenonEnds,
} from "../src/structure/editor";
import { dot3, holeSite, insertionPreview, sub3, unit3 } from "../src/structure/holes";
import { solveStatic } from "../src/structure/solver";
import { addTemplate } from "../src/structure/templates";

it("starts with packed female boards without an unexplained thickness gap", () => {
  const d = createDesign();
  expect(
    d.members
      .filter((m) => m.kind === "female" && [m.start, m.end].includes("n0"))
      .map((m) => m.layer)
      .sort(),
  ).toEqual([0, 1]);
});
it("snaps a male perpendicular to an internal hole and round trips the structural connection", () => {
  const d = createDesign();
  const site = holeSite(d, "m4", 3);
  const result = insertMaleAtHole(d, "m4", 3, 1, 1);
  const male = d.members.find((m) => m.id === result.memberId);
  if (!male) throw new Error("Missing male");
  const a = d.nodes.find((n) => n.id === male.start);
  const b = d.nodes.find((n) => n.id === male.end);
  if (!a || !b) throw new Error("Missing nodes");
  expect(Math.abs(dot3(unit3(sub3(b.position, a.position)), site.normal))).toBeCloseTo(1);
  expect(d.connections.some((c) => c.female === "m4" && c.hole === 3 && c.male === male.id)).toBe(true);
  expect(parseDesign(serializeDesign(d))).toEqual(d);
  expect(() => insertMaleAtHole(d, "m4", 3, 1, 1)).toThrow(/既に/);
  a.position[2] += 0.02;
  expect(() => serializeDesign(d)).toThrow(/穴|シャフト|接続|垂直/);
});
it("transfers force from a snapped male into a continuous female board", () => {
  const d = createDesign();
  d.nodes = [
    { id: "a", position: [0, 0, 0], fixed: true },
    { id: "b", position: [0, 1.2, 0], fixed: true },
  ];
  d.members = [
    {
      id: "female",
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
  const result = insertMaleAtHole(d, "female", 3, 1, 1);
  d.analysis.loadNode = result.nodeId;
  d.analysis.direction = "x";
  d.analysis.force = 0.01;
  d.analysis.gravity = 0;
  d.jointModel = "rigid-approximation";
  const response = solveStatic(d, "none");
  const m = d.materials[0];
  const expected = (0.01 * 1.2 ** 3) / (192 * m.E * m.Iy) + 0.01 / (m.E * m.A);
  const index = d.nodes.findIndex((n) => n.id === result.nodeId) * 6;
  expect(response.displacement[index]).toBeCloseTo(expected, 8);
  expect(response.residual).toBeLessThan(1e-8);
  expect(d.members.filter((m) => m.id === "female")).toHaveLength(1);
});
it("connects every pierced parallel board automatically", () => {
  const d = createDesign();
  const first = d.members.find((m) => m.id === "m4");
  if (!first) throw new Error("Missing female");
  d.members.push({ ...first, id: "stack", layer: 2 });
  const preview = insertionPreview(d, "m4", 3, 1, 1);
  expect(preview.connections.filter((c) => c.female === "m4" || c.female === "stack")).toHaveLength(2);
  const result = insertMaleAtHole(d, "m4", 3, 1, 1);
  expect(result.connected).toBe(2);
  expect(() => serializeDesign(d)).not.toThrow();
});

it("puts a board joined at its end hole onto the male's tip node it was left beside", () => {
  const d = createDrawingDesign();
  const { memberId } = insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
  addTemplate(d, {
    shape: "square",
    males: [memberId],
    direction: "x",
    size: catalogPart("female-1200-square").span,
  });
  connectThreadedMales(d);
  const board = d.members.find((m) => m.id === "m4");
  const male = d.members.find((m) => m.id === "m2");
  if (!board || !male) throw new Error("Missing bay parts");
  expect(d.connections).toContainEqual(
    expect.objectContaining({ male: "m2", female: "m4", hole: board.holeCount - 1 }),
  );
  // As a mirror can leave it: the joint is recorded, but the board ends on a node of its own 1 µm away.
  const tip = d.nodes.find((n) => n.id === board.end);
  if (!tip) throw new Error("Missing tip");
  d.nodes.push({
    id: "loose",
    position: [tip.position[0] + 1e-6, tip.position[1], tip.position[2]],
    fixed: false,
  });
  board.end = "loose";
  const before = parseDesign(serializeDesign(d));
  expect(before.nodes.some((n) => n.id === "loose")).toBe(true);
  expect(shareTenonEnds(d)).toEqual(["m4"]);
  expect(board.end).toBe(male.end);
  expect(d.nodes.some((n) => n.id === "loose")).toBe(false);
  expect(parseDesign(serializeDesign(d)).members.find((m) => m.id === "m4")?.end).toBe(male.end);
  expect(shareTenonEnds(d)).toEqual([]);
});

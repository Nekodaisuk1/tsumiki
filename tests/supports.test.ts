import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { createDesign, parseDesign, serializeDesign } from "../src/structure/design";
import { connectThreadedMales, createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";
import { solveStatic, supportProblem } from "../src/structure/solver";
import { autoSupports } from "../src/structure/supports";
import { addTemplate } from "../src/structure/templates";
import { moveParts } from "../src/structure/transform";

const male600 = catalogPart("male-600").span;

describe("automatic supports", () => {
  it("holds the board standing on the floor and moves the load to a free node", () => {
    const d = createDrawingDesign();
    const { nodeId: tip } = insertMaleAtHole(d, "m0", 2, male600, 1);
    for (const n of d.nodes) n.fixed = false;
    const { fixed, loadNode } = autoSupports(d);
    // The upright board touches the floor along its whole bottom edge; the flat male above it does not.
    expect(fixed.sort()).toEqual(["n0", "n1"]);
    expect(loadNode).toBe(tip);
    expect(supportProblem(d)).toBeNull();
    expect(() => solveStatic(parseDesign(serializeDesign(d)), "taut")).not.toThrow();
  });

  it("follows the floor after the structure is turned over", () => {
    const d = createDrawingDesign("female-1200-square");
    const { memberId } = insertMaleAtHole(d, "m0", 0, male600, 1);
    addTemplate(d, {
      shape: "square",
      males: [memberId],
      direction: "y",
      size: catalogPart("female-1200-square").span,
    });
    autoSupports(d);
    const before = d.nodes.filter((n) => n.fixed).map((n) => n.id);
    // Turn everything upside down: the former top boards now stand on the floor.
    moveParts(d, "all", "", { translate: [0, 0, 0], axis: [1, 0, 0], angle: 180, pivot: [0, 0.561, 0.2] });
    const after = autoSupports(d).fixed;
    expect(after.length).toBeGreaterThan(0);
    expect(after.sort()).not.toEqual(before.sort());
    const low = Math.min(...d.nodes.map((n) => n.position[1]));
    for (const id of after) expect(d.nodes.find((n) => n.id === id)?.position[1]).toBeCloseTo(low, 6);
  });

  it("leaves legacy designs as saved", () => {
    const d = createDesign();
    const saved = d.nodes.map((n) => n.fixed);
    autoSupports(d);
    expect(d.nodes.map((n) => n.fixed)).toEqual(saved);
  });
});

describe("males through holes", () => {
  it("reconnects a male standing in a hole whose recorded connection was lost", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, male600, 1);
    const recorded = structuredClone(d.connections);
    d.connections = [];
    expect(supportProblem(d)).toContain(`部材 ${memberId} が支持された部分とつながっていません`);
    expect(connectThreadedMales(d)).toEqual([memberId]);
    expect(d.connections.map(({ id: _, ...c }) => c)).toEqual(recorded.map(({ id: _, ...c }) => c));
    expect(supportProblem(d)).toBeNull();
    parseDesign(serializeDesign(d));
  });

  it("connects a template male that stands in a hole of the base board, and leaves other males alone", () => {
    const d = createDrawingDesign("female-1200-square");
    const { memberId } = insertMaleAtHole(d, "m0", 0, male600, 1);
    const span = catalogPart("female-1200-square").span;
    const over = addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: span }).created;
    const above = addTemplate(d, { shape: "square", males: [memberId], direction: "y", size: span }).created;
    const male = (created: string[]) =>
      created.find((id) => d.members.find((m) => m.id === id)?.kind === "male");
    // The +X male lands in the last hole of the base board; the +Y male only holds the template boards.
    expect(connectThreadedMales(d)).toEqual([male(over)]);
    expect(d.connections.some((c) => c.male === male(over) && c.female === "m0")).toBe(true);
    expect(d.connections.some((c) => c.male === male(above))).toBe(false);
    parseDesign(serializeDesign(d));
  });
});

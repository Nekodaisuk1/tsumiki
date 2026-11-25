import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { analyzeAssembly, sweptCellsOverlap } from "../src/structure/assembly";
import { catalogPart } from "../src/structure/catalog";
import { appendMember, createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";

function cube(x: number, half = 0.1) {
  const points = [-1, 1].flatMap((a) =>
    [-1, 1].flatMap((b) => [-1, 1].map((c) => new Vector3(x + a * half, b * half, c * half))),
  );
  const normals = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  return { points, normals, edges: normals, bounds: new Box3().setFromPoints(points) };
}
describe("assembly planning", () => {
  it("detects collision in the middle of a translation and allows face contact", () => {
    expect(sweptCellsOverlap(cube(0), cube(1, 0.001), new Vector3(2, 0, 0))).toBe(true);
    expect(sweptCellsOverlap(cube(0), cube(1), new Vector3(0, 2, 0))).toBe(false);
    expect(sweptCellsOverlap(cube(0), cube(0.2), new Vector3(-1, 0, 0))).toBe(false);
  });
  it("numbers a floor seed, a male insertion and an outside female addition", () => {
    const d = createDrawingDesign();
    const inserted = insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, 1);
    appendMember(
      d,
      inserted.nodeId,
      "female",
      [1, 0, 0],
      catalogPart("female-1200-round").span,
      "female-1200-round",
    );
    const before = JSON.stringify(d),
      p = analyzeAssembly(d);
    expect(p.complete).toBe(true);
    expect(p.steps).toHaveLength(3);
    expect(p.steps.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(p.steps[0].instruction).toContain("地面");
    expect(p.steps[1].kind).toBe("male");
    expect(p.steps[2].instruction).toContain("外側");
    expect(JSON.stringify(d)).toBe(before);
  });
  it("supports both ends before adding another one-sided male", () => {
    const d = createDrawingDesign();
    const first = insertMaleAtHole(d, "m0", 0, catalogPart("male-1200").span, 1);
    const second = insertMaleAtHole(d, "m0", 8, catalogPart("male-1200").span, 1);
    const part = catalogPart("female-1200-round");
    appendMember(d, first.nodeId, "female", [1, 0, 0], part.span, part.id);
    appendMember(d, second.nodeId, "female", [1, 0, 0], part.span, part.id);
    const plan = analyzeAssembly(d);
    expect(plan.complete).toBe(true);
    const installed = new Set<string>();
    let maleCount = 0;
    for (const step of plan.steps) {
      if (step.kind === "male" && maleCount++ > 0) {
        for (const male of d.members.filter((m) => m.kind === "male" && installed.has(m.id))) {
          expect(
            new Set(
              d.connections.filter((c) => c.male === male.id && installed.has(c.female)).map((c) => c.end),
            ).size,
          ).toBe(2);
        }
      }
      installed.add(step.id);
    }
    expect(maleCount).toBe(2);
  });
  it("validates a manual order without reordering blocked insertions", () => {
    const d = createDrawingDesign();
    const male = insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, 1);
    const part = catalogPart("female-1200-round");
    appendMember(d, male.nodeId, "female", [1, 0, 0], part.span, part.id);
    const automatic = analyzeAssembly(d);
    const valid = automatic.steps.map((s) => s.id);
    expect(analyzeAssembly(d, undefined, undefined, valid).complete).toBe(true);
    const invalid = [valid[0], valid[2], valid[1]];
    const plan = analyzeAssembly(d, undefined, undefined, invalid);
    expect(plan.complete).toBe(false);
    expect(plan.steps.map((s) => s.id)).toEqual(invalid.slice(0, 2));
    expect(plan.blocked[0].reason).toContain("両端");
    expect(analyzeAssembly(d, undefined, undefined, []).complete).toBe(false);
    expect(() => analyzeAssembly(d, undefined, undefined, ["m0", "m0"])).toThrow("重複");
    expect(() => analyzeAssembly(d, undefined, undefined, ["missing"])).toThrow("不明");
  });
  it("reports disconnected parts instead of adding a floating start", () => {
    const d = createDrawingDesign();
    const b = structuredClone(d.members[0]);
    b.id = "isolated";
    b.start = "far0";
    b.end = "far1";
    d.nodes.push(
      { id: b.start, position: [5, 1, 0], fixed: false },
      { id: b.end, position: [7.244, 1, 0], fixed: false },
    );
    d.members.push(b);
    const p = analyzeAssembly(d);
    expect(p.complete).toBe(false);
    expect(p.steps.map((s) => s.id)).toEqual(["m0"]);
    expect(p.blocked[0].reason).toContain("つながっていない");
  });
  it("allows a separate ground-supported starting board but not an airborne one", () => {
    const d = createDrawingDesign();
    const source = d.members[0];
    const board = { ...source, id: "second-ground", start: "ground0", end: "ground1" };
    for (const [id, original] of [
      [board.start, source.start],
      [board.end, source.end],
    ]) {
      const node = d.nodes.find((n) => n.id === original);
      if (!node) throw new Error("Missing fixture node");
      d.nodes.push({ ...node, id, position: [node.position[0] + 5, node.position[1], node.position[2]] });
    }
    d.members.push(board);
    const plan = analyzeAssembly(d);
    expect(plan.complete).toBe(true);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.every((step) => step.instruction.includes("地面"))).toBe(true);
  });
  it("marks a search budget stop separately from a completed plan", () => {
    const p = analyzeAssembly(createDrawingDesign(), 0);
    expect(p.complete).toBe(false);
    expect(p.limited).toBe(true);
  });
  it("installs the inner board before an outer board on the same tenon", () => {
    const d = createDrawingDesign();
    const male = insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, 1);
    const part = catalogPart("female-1200-round");
    appendMember(d, male.nodeId, "female", [1, 0, 0], part.span, part.id);
    appendMember(d, male.nodeId, "female", [1, 0, 0], part.span, part.id);
    const p = analyzeAssembly(d);
    expect(p.complete).toBe(true);
    const boards = d.members
      .filter((m) => m.kind === "female" && m.id !== "m0")
      .sort((a, b) => a.layer - b.layer);
    expect(p.steps.findIndex((s) => s.id === boards[0].id)).toBeLessThan(
      p.steps.findIndex((s) => s.id === boards[1].id),
    );
    const installed = new Set<string>();
    for (const step of p.steps) {
      if (step.kind === "male")
        expect(
          new Set(
            d.connections.filter((c) => c.male === step.id && installed.has(c.female)).map((c) => c.end),
          ).size,
        ).toBeLessThanOrEqual(1);
      installed.add(step.id);
    }
  });
});

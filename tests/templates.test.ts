import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { createDesign, parseDesign, serializeDesign } from "../src/structure/design";
import { createDrawingDesign, createSeedDesign, insertMaleAtHole } from "../src/structure/editor";
import { boardAxes, dot3 } from "../src/structure/holes";
import { ASSEMBLY_SLOTS } from "../src/structure/seats";
import { simulate, solveStatic } from "../src/structure/solver";
import { addTemplate, type TemplateRequest, templateDirections } from "../src/structure/templates";

const shaftOf = (d: ReturnType<typeof createDesign>, id: string) => {
  const m = d.members.find((v) => v.id === id);
  if (!m) throw new Error("Missing member");
  const a = d.nodes.find((n) => n.id === m.start)?.position;
  const b = d.nodes.find((n) => n.id === m.end)?.position;
  if (!a || !b) throw new Error("Missing member endpoints");
  const v = b.map((x, i) => x - a[i]);
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
};

describe("structure templates", () => {
  it("offers only directions perpendicular to the male", () => {
    expect(templateDirections(createDesign(), "m0").sort()).toEqual(["-y", "-z", "y", "z"]);
  });

  it("builds a square from one male and keeps the design valid and solvable", () => {
    const d = createSeedDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, 1.2, 1);
    const before = d.members.length;
    const { created } = addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: 1 });
    expect(created).toHaveLength(3);
    expect(d.members.length).toBe(before + 3);
    const valid = parseDesign(serializeDesign(d));
    const axis = shaftOf(valid, memberId);
    for (const id of created.slice(1)) {
      const female = valid.members.find((m) => m.id === id);
      if (!female) throw new Error("Missing female member");
      expect(Math.abs(dot3(boardAxes(valid, female).normal, axis))).toBeCloseTo(1, 6);
    }
  });

  it("closes a square between two parallel males", () => {
    const d = createDesign();
    // m0 (n0→n1) and m2 (n4→n5) are parallel and already joined by layers 0 and 1; the new pair goes outside.
    const { created } = addTemplate(d, { shape: "square", males: ["m0", "m2"] });
    expect(created).toHaveLength(2);
    const valid = parseDesign(serializeDesign(d));
    expect(valid.members.filter((m) => created.includes(m.id)).every((m) => m.layer === 2)).toBe(true);
  });

  it("builds a triangular section around the shafts and analyses it", () => {
    const d = createSeedDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, 1.2, 1);
    const { created } = addTemplate(d, {
      shape: "triangle",
      males: [memberId],
      direction: "x",
      size: 1,
      side: 1,
    });
    // two new males and three females at each end
    expect(created).toHaveLength(8);
    const valid = parseDesign(serializeDesign(d));
    const axis = shaftOf(valid, memberId);
    const females = valid.members.filter((m) => created.includes(m.id) && m.kind === "female");
    expect(females).toHaveLength(6);
    for (const f of females) expect(Math.abs(dot3(boardAxes(valid, f).normal, axis))).toBeCloseTo(1, 6);
    // every corner tenon carries two boards, each on its own layer
    for (const node of valid.nodes) {
      const layers = females.filter((f) => f.start === node.id || f.end === node.id).map((f) => f.layer);
      if (layers.length) expect(new Set(layers).size).toBe(layers.length);
    }
    const load = valid.nodes.find((n) => !n.fixed);
    if (!load) throw new Error("Missing free node");
    valid.analysis.loadNode = load.id;
    expect(solveStatic(valid, "none").maxDisplacement).toBeGreaterThan(0);
    expect(simulate(valid, "none", "force").peak).toBeGreaterThan(0);
  });

  it("rejects males that are not parallel or not aligned", () => {
    expect(() => addTemplate(createDesign(), { shape: "square", males: ["m0", "m4"] })).toThrow();
    expect(() => addTemplate(createDesign(), { shape: "square", males: ["m0"], direction: "x" })).toThrow(
      "垂直",
    );
  });
});

describe("chaining templates", () => {
  const span = catalogPart("female-1200-square").span;
  const start = () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, 1);
    return { d, male: memberId };
  };
  const newMale = (d: ReturnType<typeof createDesign>, created: string[]) => {
    const id = created.find((c) => d.members.find((m) => m.id === c)?.kind === "male");
    if (!id) throw new Error("No new male");
    return id;
  };
  const valid = (d: ReturnType<typeof createDesign>) => parseDesign(serializeDesign(d));

  it("closes a ring of four squares on shared males without running out of layers", () => {
    const { d, male } = start();
    let last = male;
    for (const direction of ["x", "y", "-x"] as const) {
      last = newMale(d, addTemplate(d, { shape: "square", males: [last], direction, size: span }).created);
      valid(d);
    }
    const { created } = addTemplate(d, { shape: "square", males: [last, male] });
    expect(created).toHaveLength(2);
    const after = valid(d);
    expect(after.members.filter((m) => m.kind === "male")).toHaveLength(4);
    for (const m of after.members) expect(m.layer).toBeLessThan(ASSEMBLY_SLOTS);
  });

  it("chains triangles and squares from any male in every perpendicular direction", () => {
    for (const shape of ["square", "triangle"] as const)
      for (const direction of ["x", "-x", "y", "-y"] as const)
        for (const from of ["first", "new"] as const) {
          const { d, male } = start();
          const first = addTemplate(d, { shape, males: [male], direction: "x", size: span });
          const root = from === "first" ? male : newMale(d, first.created);
          const request: TemplateRequest = { shape: "square", males: [root], direction, size: span };
          try {
            addTemplate(d, request);
          } catch (error) {
            // Only an exact repeat of what is already there may be refused.
            expect((error as Error).message).toContain("既に同じ形");
            continue;
          }
          expect(() => valid(d)).not.toThrow();
        }
  });

  it("uses round-ended boards when asked", () => {
    const { d, male } = start();
    const { created } = addTemplate(d, {
      shape: "square",
      males: [male],
      direction: "x",
      size: span,
      femaleEnd: "round",
    });
    const boards = d.members.filter((m) => created.includes(m.id) && m.kind === "female");
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards) expect(b.catalogId).toMatch(/-round$/);
    expect(() => valid(d)).not.toThrow();
  });

  it("reuses a male that already stands where the template puts its second male", () => {
    const { d, male } = start();
    const second = newMale(
      d,
      addTemplate(d, { shape: "square", males: [male], direction: "x", size: span }).created,
    );
    const { created } = addTemplate(d, { shape: "triangle", males: [second], direction: "-x", size: span });
    // The square's boards are shared, so the triangle adds only its apex male and two boards per end.
    expect(created.filter((id) => d.members.find((m) => m.id === id)?.kind === "male")).toHaveLength(1);
    expect(created).toHaveLength(5);
    expect(() => valid(d)).not.toThrow();
    expect(() => addTemplate(d, { shape: "square", males: [male], direction: "x", size: span })).toThrow(
      "既に同じ形",
    );
  });
});

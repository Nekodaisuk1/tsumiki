import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { createDesign, type Design, parseDesign, serializeDesign, type Vec3 } from "../src/structure/design";
import { createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";
import { boardAxes, holeSite, sub3 } from "../src/structure/holes";
import { connectedMembers, moveParts, pivotOf, rotate3, targetParts } from "../src/structure/transform";

const valid = (d: Design) => parseDesign(serializeDesign(d));
const still: Pick<Parameters<typeof moveParts>[3], "axis" | "angle"> = { axis: [0, 1, 0], angle: 0 };
const length = (d: Design, id: string) => {
  const m = d.members.find((v) => v.id === id);
  const a = d.nodes.find((n) => n.id === m?.start)?.position;
  const b = d.nodes.find((n) => n.id === m?.end)?.position;
  if (!a || !b) throw new Error("Missing member");
  return Math.hypot(...sub3(b, a));
};

describe("rigid moves", () => {
  it("rotates and moves the whole structure while keeping lengths and board orientation", () => {
    const d = createDesign();
    const before = structuredClone(d);
    const pivot = pivotOf(
      d,
      d.nodes.map((n) => n.id),
    );
    moveParts(d, "all", "", { translate: [0.5, 0, -0.25], axis: [1, 0, 0], angle: 30, pivot });
    const after = valid(d);
    for (const m of before.members) {
      expect(length(after, m.id)).toBeCloseTo(length(before, m.id), 9);
      if (m.kind !== "female") continue;
      const expected = rotate3(boardAxes(before, m).normal, [1, 0, 0], 30);
      const actual = boardAxes(after, after.members.find((v) => v.id === m.id) as Design["members"][number]);
      for (const [i, v] of actual.normal.entries()) expect(v).toBeCloseTo(expected[i], 9);
    }
  });

  it("slides an inserted male to the next hole and re-records the hole connections", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-300").span, 1);
    const pitch = sub3(holeSite(d, "m0", 4).position, holeSite(d, "m0", 3).position) as Vec3;
    moveParts(d, "member", memberId, { translate: pitch, ...still, pivot: [0, 0, 0] });
    const after = valid(d);
    const holes = after.connections.filter((c) => c.male === memberId).map((c) => c.hole);
    expect(holes).toEqual([4]);
  });

  it("lifts a male out of its hole when moved off the board", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-300").span, 1);
    moveParts(d, "member", memberId, { translate: [0, 0, 1], ...still, pivot: [0, 0, 0] });
    expect(valid(d).connections.filter((c) => c.male === memberId)).toHaveLength(0);
  });

  it("moves a connected group together without breaking its joints", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-300").span, 1);
    expect(connectedMembers(d, memberId).sort()).toEqual(["m0", memberId].sort());
    const joints = structuredClone(d.connections);
    const parts = targetParts(d, "group", memberId);
    moveParts(d, "group", memberId, {
      translate: [0.2, 0.1, 0],
      axis: [0, 1, 0],
      angle: 45,
      pivot: pivotOf(d, parts.nodes),
    });
    const after = valid(d);
    expect(after.connections.map(({ id: _, ...c }) => c)).toEqual(joints.map(({ id: _, ...c }) => c));
  });

  it("splits shared nodes when one member is moved alone and joins them again when moved back", () => {
    const d = createDesign();
    const female = d.members.find((m) => m.kind === "female");
    if (!female) throw new Error("No female");
    const nodes = d.nodes.length;
    const original = [female.start, female.end];
    moveParts(d, "member", female.id, { translate: [0, 0, 5], ...still, pivot: [0, 0, 0] });
    valid(d);
    expect(d.nodes.length).toBe(nodes + 2);
    expect([female.start, female.end]).not.toEqual(original);
    moveParts(d, "member", female.id, { translate: [0, 0, -5], ...still, pivot: [0, 0, 0] });
    valid(d);
    expect(d.nodes.length).toBe(nodes);
    expect([female.start, female.end]).toEqual(original);
  });

  it("moves every member of the default frame on its own or with its connected part", () => {
    for (const m of createDesign().members)
      for (const target of ["member", "group"] as const) {
        const d = createDesign();
        moveParts(d, target, m.id, { translate: [0, 0, 6], ...still, pivot: [0, 0, 0] });
        expect(() => valid(d)).not.toThrow();
      }
  });

  it("takes ropes off a male moved on its own", () => {
    const d = createDesign();
    const winder = d.ropes[0].windingMember;
    const { droppedRopes } = moveParts(d, "member", winder, {
      translate: [0, 0, 6],
      ...still,
      pivot: [0, 0, 0],
    });
    expect(droppedRopes.length).toBeGreaterThan(0);
    expect(d.ropes.some((r) => r.windingMember === winder)).toBe(false);
  });

  it("does not rotate a single node", () => {
    const d = createDesign();
    expect(() =>
      moveParts(d, "node", "n0", { translate: [0, 0, 0], axis: [0, 1, 0], angle: 10, pivot: [0, 0, 0] }),
    ).toThrow();
  });
});

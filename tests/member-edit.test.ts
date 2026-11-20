import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { createDesign, type Design, parseDesign, serializeDesign } from "../src/structure/design";
import {
  appendMember,
  createDrawingDesign,
  insertMaleAtHole,
  removeMember,
  shiftLayer,
} from "../src/structure/editor";

const valid = (d: Design) => parseDesign(serializeDesign(d));

describe("removing members", () => {
  it("removes the initial board even when a male is inserted through it", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-300").span, 1);
    removeMember(d, "m0");
    const after = valid(d);
    expect(after.members.map((m) => m.id)).toEqual([memberId]);
    expect(after.connections).toHaveLength(0);
    expect(after.nodes.map((n) => n.id).sort()).toEqual(
      [after.members[0].start, after.members[0].end].sort(),
    );
  });

  it("removes an inserted male and its joints", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-300").span, 1);
    removeMember(d, memberId);
    const after = valid(d);
    expect(after.members.map((m) => m.id)).toEqual(["m0"]);
    expect(after.connections).toHaveLength(0);
  });

  it("removes any member of the default frame; boards keep their side when their male goes", () => {
    for (const m of createDesign().members) {
      const d = createDesign();
      removeMember(d, m.id);
      expect(() => valid(d)).not.toThrow();
    }
  });

  it("keeps the last member", () => {
    expect(() => removeMember(createDrawingDesign(), "m0")).toThrow(/最後の1本/);
  });
});

describe("stacking order", () => {
  it("swaps a board with its neighbour on the same tenon", () => {
    const d = createDesign();
    const inner = d.members.find(
      (m) =>
        m.kind === "female" &&
        m.layer === 0 &&
        d.members.some(
          (o) =>
            o.kind === "female" &&
            o.layer === 1 &&
            [o.start, o.end].some((n) => n === m.start || n === m.end),
        ),
    );
    if (!inner) throw new Error("No stacked boards in the default frame");
    const outer = d.members.filter(
      (o) =>
        o.kind === "female" &&
        o.layer === 1 &&
        [o.start, o.end].some((n) => n === inner.start || n === inner.end),
    );
    shiftLayer(d, inner.id, 1);
    const after = valid(d);
    expect(after.members.find((m) => m.id === inner.id)?.layer).toBe(1);
    for (const o of outer) expect(after.members.find((m) => m.id === o.id)?.layer).toBe(0);
  });

  it("refuses to move into the rope seat or below the first seat", () => {
    const d = createDesign();
    const board = d.members.find((m) => m.kind === "female" && m.layer === 0);
    if (!board) throw new Error("No board");
    expect(() => shiftLayer(d, board.id, -1)).toThrow();
    board.layer = 3;
    expect(() => shiftLayer(d, board.id, 1)).toThrow(/ロープ/);
  });
});

describe("adding boards by hand", () => {
  it("puts a new board back on the inner layer a removed board left free", () => {
    const d = createDesign();
    const inner = d.members.find(
      (m) =>
        m.kind === "female" &&
        m.layer === 0 &&
        d.members.some((o) => o.kind === "female" && o.layer === 1 && [o.start, o.end].includes(m.start)),
    );
    if (!inner) throw new Error("No stacked board");
    const [a, b] = [inner.start, inner.end].map((id) => d.nodes.find((n) => n.id === id)?.position);
    if (!a || !b) throw new Error("Missing nodes");
    const length = Math.hypot(...b.map((v, i) => v - a[i]));
    const direction = b.map((v, i) => (v - a[i]) / length) as [number, number, number];
    removeMember(d, inner.id);
    const { memberId } = appendMember(d, inner.start, "female", direction, length);
    const after = valid(d);
    expect(after.members.find((m) => m.id === memberId)?.layer).toBe(0);
  });
});

describe("moving a board to another seat", () => {
  it("swaps along a board threaded on the same tenon through a hole, not only boards sharing a node", async () => {
    const { createDrawingDesign, insertMaleAtHole, appendMember, shiftLayer } = await import(
      "../src/structure/editor"
    );
    const { validateMemberCollisions } = await import("../src/structure/collision");
    const d = createDrawingDesign();
    // Inserted against the base board's facing side: the base board sits on seat 0 of the start tenon,
    // and a second board hangs on that tenon's node on seat 1.
    const { memberId: male } = insertMaleAtHole(d, "m0", 3, catalogPart("male-600").span, -1);
    const tenon = d.members.find((m) => m.id === male)?.start ?? "";
    const { memberId: board } = appendMember(
      d,
      tenon,
      "female",
      [0, 1, 0],
      catalogPart("female-600-square").span,
      "female-600-square",
    );
    expect(d.members.find((m) => m.id === board)?.layer).toBe(1);
    // The two boards share no node, only the tenon; both move.
    const moved = shiftLayer(d, board, -1);
    expect(moved.sort()).toEqual(["m0", board].sort());
    expect(d.members.find((m) => m.id === "m0")?.layer).toBe(1);
    expect(d.members.find((m) => m.id === board)?.layer).toBe(0);
    expect(() => validateMemberCollisions(d)).not.toThrow();
  });
});

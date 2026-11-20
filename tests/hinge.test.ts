import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { type Design, parseDesign, serializeDesign } from "../src/structure/design";
import { appendMember, createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";
import { addTemplate } from "../src/structure/templates";
import { HingeSweep, jointConstraint, moveParts } from "../src/structure/transform";

const valid = (d: Design) => parseDesign(serializeDesign(d));
const male600 = catalogPart("male-600").span;

/** A 2400 base board with a male in hole 2 and a 1200 board on that male's tip, pointing along +Y. */
function boardOnTip() {
  const d = createDrawingDesign();
  const { memberId: male, nodeId: tip } = insertMaleAtHole(d, "m0", 2, male600, 1);
  const { memberId: board } = appendMember(
    d,
    tip,
    "female",
    [0, 1, 0],
    catalogPart("female-1200-square").span,
    "female-1200-square",
  );
  return { d, male, tip, board };
}

describe("turning on a joint", () => {
  it("turns a board with one end on a tenon about that tenon and keeps it there", () => {
    const { d, tip, board } = boardOnTip();
    valid(d);
    const constraint = jointConstraint(d, "member", board);
    if (constraint.kind !== "hinge") throw new Error(`expected a hinge, got ${constraint.kind}`);
    expect(constraint.hinge.pivot).toEqual(d.nodes.find((n) => n.id === tip)?.position);
    expect(Math.abs(constraint.hinge.axis[2])).toBeCloseTo(1, 9);
    const sweep = new HingeSweep(d, "member", board, constraint.hinge);
    const angle = sweep.limit(45);
    expect(angle).toBe(45);
    moveParts(d, "member", board, { translate: [0, 0, 0], ...constraint.hinge, angle });
    const after = valid(d);
    const moved = after.members.find((m) => m.id === board);
    expect([moved?.start, moved?.end]).toContain(tip);
  });

  it("stops before the board would hit another male's tenon", () => {
    const { d, board } = boardOnTip();
    // A second male three holes further along +X stands in the way of a turn toward +X.
    insertMaleAtHole(d, "m0", 5, male600, 1);
    valid(d);
    const constraint = jointConstraint(d, "member", board);
    if (constraint.kind !== "hinge") throw new Error("expected a hinge");
    const sweep = new HingeSweep(d, "member", board, constraint.hinge);
    const reached = [sweep.limit(-90), sweep.limit(90)];
    const blocked = reached.filter((a) => Math.abs(a) < 90);
    expect(blocked).toHaveLength(1);
    const edge = blocked[0];
    expect(sweep.clear(edge)).toBe(true);
    expect(sweep.clear(edge + Math.sign(edge) * 3)).toBe(false);
  });

  it("holds a board between two males in place and leaves loose parts free", () => {
    const d = createDrawingDesign("female-1200-square");
    const { memberId } = insertMaleAtHole(d, "m0", 0, male600, 1);
    const { created } = addTemplate(d, {
      shape: "square",
      males: [memberId],
      direction: "x",
      size: catalogPart("female-1200-square").span,
    });
    const board = created.find((id) => d.members.find((m) => m.id === id)?.kind === "female") ?? "";
    expect(jointConstraint(d, "member", board).kind).toBe("locked");
    expect(jointConstraint(d, "group", board).kind).toBe("free");
    expect(jointConstraint(d, "all", "").kind).toBe("free");
  });
});

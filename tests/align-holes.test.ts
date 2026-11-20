import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { type Design, parseDesign, serializeDesign } from "../src/structure/design";
import {
  appendMember,
  createDrawingDesign,
  insertMaleAtHole,
  rematchInsertedMales,
} from "../src/structure/editor";
import { holeSite } from "../src/structure/holes";
import { alignHole, alignHoles } from "../src/structure/transform";

const valid = (d: Design) => parseDesign(serializeDesign(d));
const male600 = catalogPart("male-600").span;
const board1200 = catalogPart("female-1200-square").span;

/**
 * Two males four 140.25 mm pitches apart (holes 2 and 4 of the 2400 base board), each with a 1200 board
 * going up from its tip. Hole 5 of the first board and hole 3 of the second are both five pitches from
 * the first male (3 : 4 : 5), so turning the first board lays one over the other.
 */
function twoBoards() {
  const d = createDrawingDesign();
  const first = insertMaleAtHole(d, "m0", 2, male600, 1);
  const second = insertMaleAtHole(d, "m0", 4, male600, 1);
  const a = appendMember(d, first.nodeId, "female", [0, 1, 0], board1200, "female-1200-square").memberId;
  const b = appendMember(d, second.nodeId, "female", [0, 1, 0], board1200, "female-1200-square").memberId;
  // Stacked one layer apart, so the turned board passes over the other instead of into it.
  const turned = d.members.find((m) => m.id === a);
  if (turned) turned.layer = 1;
  rematchInsertedMales(d);
  return { d: valid(d), a, b };
}

describe("turning a board to lay one hole over another", () => {
  it("turns the board about its tenon until the holes coincide", () => {
    const { d, a, b } = twoBoards();
    const angle = alignHole(d, { female: b, hole: 3 }, { female: a, hole: 5 });
    expect(Math.abs(angle)).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 6);
    const after = valid(d);
    const [p, q] = [holeSite(after, a, 5).center, holeSite(after, b, 3).center];
    expect(p[0]).toBeCloseTo(q[0], 6);
    expect(p[1]).toBeCloseTo(q[1], 6);
  });

  it("explains when the holes are at different distances from the tenon", () => {
    const { d, a, b } = twoBoards();
    expect(() => alignHole(d, { female: b, hole: 3 }, { female: a, hole: 4 })).toThrow("距離が違う");
    expect(() => alignHole(d, { female: a, hole: 3 }, { female: a, hole: 4 })).toThrow("別の雌材");
  });

  it("refuses a board with nothing to turn about", () => {
    const { d, b } = twoBoards();
    expect(() => alignHole(d, { female: b, hole: 3 }, { female: "m0", hole: 0 })).toThrow("回せません");
  });
});

describe("laying holes of boards of different lengths over each other", () => {
  /** Like `twoBoards`, but the second board is a 900 (seven holes). */
  function mixed() {
    const d = createDrawingDesign();
    const first = insertMaleAtHole(d, "m0", 2, male600, 1);
    const second = insertMaleAtHole(d, "m0", 4, male600, 1);
    const a = appendMember(d, first.nodeId, "female", [0, 1, 0], board1200, "female-1200-square").memberId;
    const span900 = catalogPart("female-900-square").span;
    const b = appendMember(d, second.nodeId, "female", [0, 1, 0], span900, "female-900-square").memberId;
    const turned = d.members.find((m) => m.id === a);
    if (turned) turned.layer = 1;
    rematchInsertedMales(d);
    return { d: valid(d), a, b };
  }

  it("turns both boards to where the holes meet when their distances from the tenons differ", () => {
    const { d, a, b } = mixed();
    // Hole 7 of the 1200 is six pitches from its male, hole 4 of the 900 three pitches from its own,
    // and the males are four pitches apart: the two circles meet.
    const turns = alignHoles(d, [
      { female: b, hole: 3 },
      { female: a, hole: 6 },
    ]);
    expect(turns.map((t) => t.female).sort()).toEqual([a, b].sort());
    const after = valid(d);
    const [p, q] = [holeSite(after, a, 6).center, holeSite(after, b, 3).center];
    expect(p[0]).toBeCloseTo(q[0], 6);
    expect(p[1]).toBeCloseTo(q[1], 6);
  });

  it("explains when the holes cannot reach each other", () => {
    const { d, a, b } = mixed();
    expect(() =>
      alignHoles(d, [
        { female: b, hole: 1 },
        { female: a, hole: 8 },
      ]),
    ).toThrow("届きません");
  });

  it("still needs equal distances when the base board cannot turn", () => {
    const { d, a } = mixed();
    expect(() =>
      alignHoles(d, [
        { female: "m0", hole: 6 },
        { female: a, hole: 3 },
      ]),
    ).toThrow(/距離が違う|回せません/);
  });
});

describe("tenons pointing opposite ways", () => {
  it("turns both boards toward each other when the two males point in opposite directions", () => {
    const d = createDrawingDesign();
    const first = insertMaleAtHole(d, "m0", 2, male600, 1);
    const second = insertMaleAtHole(d, "m0", 4, male600, 1);
    const a = appendMember(d, first.nodeId, "female", [0, 1, 0], board1200, "female-1200-square").memberId;
    const span900 = catalogPart("female-900-square").span;
    const b = appendMember(d, second.nodeId, "female", [0, 1, 0], span900, "female-900-square").memberId;
    const turned = d.members.find((m) => m.id === a);
    if (turned) turned.layer = 1;
    // The second male runs the other way along the same line, as males built from either side do.
    const reversed = d.members.find((m) => m.id === second.memberId);
    if (!reversed) throw new Error("No male");
    [reversed.start, reversed.end] = [reversed.end, reversed.start];
    rematchInsertedMales(d);
    const design = valid(d);
    alignHoles(design, [
      { female: b, hole: 3 },
      { female: a, hole: 6 },
    ]);
    const after = valid(design);
    const [p, q] = [holeSite(after, a, 6).center, holeSite(after, b, 3).center];
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9);
  });
});

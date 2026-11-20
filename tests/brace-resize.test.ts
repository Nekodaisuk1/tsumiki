import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { type Design, parseDesign, serializeDesign } from "../src/structure/design";
import {
  appendMember,
  braceTargets,
  connectBoard,
  createDrawingDesign,
  insertMaleAtHole,
  resizeBoard,
  resizeEnds,
  toggleBoardEnd,
  toggleBoardPitch,
} from "../src/structure/editor";
import { addTemplate } from "../src/structure/templates";
import { rotate3 } from "../src/structure/transform";

const valid = (d: Design) => parseDesign(serializeDesign(d));
const span = (id: string) => catalogPart(id).span;

/**
 * Four males standing along Z on the corners of an `a` × `b` rectangle in the XY plane, with boards
 * between them at both ends: each end face is a rectangle of tenon nodes that a brace can cross.
 */
function ring(a: string, b: string) {
  const d = createDrawingDesign(a);
  const { memberId } = insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
  const male = (created: string[]) => {
    const id = created.find((c) => d.members.find((m) => m.id === c)?.kind === "male");
    if (!id) throw new Error("No male");
    return id;
  };
  const second = male(
    addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: span(a) }).created,
  );
  const third = male(
    addTemplate(d, { shape: "square", males: [second], direction: "y", size: span(b) }).created,
  );
  const fourth = male(
    addTemplate(d, { shape: "square", males: [third], direction: "-x", size: span(a) }).created,
  );
  addTemplate(d, { shape: "square", males: [fourth, memberId] });
  valid(d);
  // The far ends: their tenons carry only two boards, so a crossing pair of braces still fits.
  const corner = d.members.find((m) => m.id === memberId)?.end ?? "";
  return { d, corner };
}

describe("diagonal braces", () => {
  it("offers and adds a catalog-length diagonal, the second one crossing on another layer", () => {
    // 450 × 600 is 3 × 4 hole pitches, so its diagonal is exactly the 750 board (5 pitches).
    const { d, corner: node } = ring("female-450-square", "female-600-square");
    const targets = braceTargets(d, node);
    const diagonal = targets.find((t) => t.diagonal);
    expect(diagonal?.label).toBe("750♀角");
    const first = connectBoard(d, node, diagonal?.node ?? "");
    valid(d);
    // The crossing diagonal of the same face.
    const z = d.nodes.find((v) => v.id === node)?.position[2] ?? 0;
    const others = d.nodes.filter((n) => Math.abs(n.position[2] - z) < 1e-6);
    const cross = others
      .flatMap((n) =>
        braceTargets(d, n.id)
          .filter((t) => t.diagonal)
          .map((t) => [n.id, t.node] as const),
      )
      .at(0);
    expect(cross).toBeDefined();
    const second = connectBoard(d, cross?.[0] ?? "", cross?.[1] ?? "");
    const after = valid(d);
    const layer = (id: string) => after.members.find((m) => m.id === id)?.layer;
    expect(layer(second)).not.toBe(layer(first));
  });

  it("explains which sizes are near when no drawing board fits", () => {
    // The diagonal of a 1200 square (1586.7 mm) is no drawing size.
    const { d, corner } = ring("female-1200-square", "female-1200-square");
    expect(braceTargets(d, corner).some((t) => t.diagonal)).toBe(false);
    const at = d.nodes.find((n) => n.id === corner)?.position ?? [0, 0, 0];
    const s = span("female-1200-square");
    const far = d.nodes.find(
      (n) => Math.hypot(n.position[0] - at[0] - s, n.position[1] - at[1] - s, n.position[2] - at[2]) < 1e-6,
    );
    expect(() => connectBoard(d, corner, far?.id ?? "")).toThrow(/1586\.7mm に合う雌材の規格がありません/);
  });
});

describe("tilted boards", () => {
  it("adds a board tilted about the tenon with a free end, at catalog length", () => {
    const d = createDrawingDesign("female-1200-square");
    const { nodeId } = insertMaleAtHole(d, "m0", 2, catalogPart("male-600").span, 1);
    for (const tilt of [15, 45, -30]) {
      const draft = structuredClone(d);
      const direction = rotate3([1, 0, 0], [0, 0, 1], tilt);
      const { memberId } = appendMember(
        draft,
        nodeId,
        "female",
        direction,
        span("female-750-round"),
        "female-750-round",
      );
      const after = valid(draft);
      expect(after.members.find((m) => m.id === memberId)?.catalogId).toBe("female-750-round");
    }
  });
});

describe("resizing boards by catalog steps", () => {
  it("extends and shortens the free end of a board by one size and keeps hole joints valid", () => {
    const d = createDrawingDesign("female-1200-square");
    insertMaleAtHole(d, "m0", 2, catalogPart("male-600").span, 1);
    expect(resizeBoard(d, "m0", 1).id).toBe("female-1500-square");
    valid(d);
    expect(d.connections.some((c) => c.female === "m0" && c.hole === 2)).toBe(true);
    expect(resizeBoard(d, "m0", -1).id).toBe("female-1200-square");
    expect(resizeBoard(d, "m0", -1).id).toBe("female-1050-square");
    valid(d);
  });

  it("keeps the end on a male and detaches the other end when it is moved", () => {
    const d = createDrawingDesign("female-1200-square");
    insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
    const { created } = addTemplate(d, {
      shape: "square",
      males: ["m1"],
      direction: "x",
      size: span("female-1200-square"),
    });
    const board = d.members.find((m) => created.includes(m.id) && m.kind === "female");
    if (!board) throw new Error("No board");
    const start = board.start;
    resizeBoard(d, board.id, 1);
    valid(d);
    expect(board.start).toBe(start);
    expect(d.members.find((m) => m.id === board.id)?.catalogId).toBe("female-1500-square");
  });

  it("stops at the shortest and longest sizes", () => {
    const d = createDrawingDesign("female-150-round");
    expect(() => resizeBoard(d, "m0", -1)).toThrow("短い規格");
    const long = createDrawingDesign("female-3600-round");
    expect(() => resizeBoard(long, "m0", 1)).toThrow("長い規格");
  });
});

describe("switching the end of an existing board", () => {
  it("switches square and round ends and keeps span, holes and joints", () => {
    const d = createDrawingDesign("female-1200-square");
    insertMaleAtHole(d, "m0", 2, catalogPart("male-600").span, 1);
    const joints = structuredClone(d.connections);
    expect(toggleBoardEnd(d, "m0").id).toBe("female-1200-round");
    const after = valid(d);
    expect(after.connections).toEqual(joints);
    expect(toggleBoardEnd(d, "m0").id).toBe("female-1200-square");
    valid(d);
  });
});

describe("which end resizing moves", () => {
  it("moves the free end, keeps the end on a male, and flips on request", () => {
    const d = createDrawingDesign("female-1200-square");
    const { nodeId: tip } = insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
    const board = connectBoardFromTip(d, tip);
    const ends = resizeEnds(d, board);
    expect(ends.fixed).toBe(tip);
    const flipped = resizeEnds(d, board, true);
    expect(flipped.node).toBe(tip);
    resizeBoard(d, board, 1);
    const after = d.members.find((m) => m.id === board);
    expect([after?.start, after?.end]).toContain(tip);
  });
});

function connectBoardFromTip(d: Design, tip: string) {
  const { memberId } = appendMember(
    d,
    tip,
    "female",
    [1, 0, 0],
    span("female-1200-square"),
    "female-1200-square",
  );
  return memberId;
}

describe("hole pitch across sizes", () => {
  it("names the male whose hole would vanish when the pitch changes from 140.25 to 280.5 mm", () => {
    const d = createDrawingDesign("female-1800-square");
    const { memberId } = insertMaleAtHole(d, "m0", 1, catalogPart("male-600").span, 1);
    expect(() => resizeBoard(d, "m0", 1)).toThrow(
      `穴の間隔が 140.25 → 280.5mm に変わるため、雄材 ${memberId}`,
    );
    // Every other 140.25 mm hole is also a 280.5 mm hole, so a male in hole 3 (280.5 mm) is kept.
    const e = createDrawingDesign("female-1800-square");
    const { memberId: kept } = insertMaleAtHole(e, "m0", 2, catalogPart("male-600").span, 1);
    expect(resizeBoard(e, "m0", 1).id).toBe("female-2100-square");
    expect(valid(e).connections.some((c) => c.male === kept && c.female === "m0")).toBe(true);
  });

  it("lets a shortened board come off a male beyond its new end", () => {
    const d = createDrawingDesign("female-450-square");
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-600").span, 1);
    expect(resizeBoard(d, "m0", -1).id).toBe("female-300-square");
    expect(valid(d).connections.some((c) => c.male === memberId && c.female === "m0")).toBe(false);
  });

  it("switches a 2400 between the regular and the 140.25 mm pitch version", () => {
    const d = createDrawingDesign("female-2400-square");
    insertMaleAtHole(d, "m0", 2, catalogPart("male-600").span, 1);
    expect(toggleBoardPitch(d, "m0").id).toBe("female-2400-square-dense");
    expect(valid(d).members[0].holeCount).toBe(17);
    expect(toggleBoardPitch(d, "m0").id).toBe("female-2400-square");
    const short = createDrawingDesign("female-1200-square");
    expect(() => toggleBoardPitch(short, "m0")).toThrow("2400 の雌材だけ");
  });

  it("refuses the regular version when a male stands in a 140.25 mm only hole", () => {
    const d = createDrawingDesign("female-2400-square-dense");
    const { memberId } = insertMaleAtHole(d, "m0", 3, catalogPart("male-600").span, 1);
    expect(() => toggleBoardPitch(d, "m0")).toThrow(`雄材 ${memberId}`);
  });
});

import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { type Design, parseDesign, serializeDesign } from "../src/structure/design";
import {
  appendMember,
  connectBoard,
  connectThreadedMales,
  createDrawingDesign,
  insertMaleAtHole,
  removeMember,
  resizeBoard,
} from "../src/structure/editor";
import { addTemplate } from "../src/structure/templates";
import { mirrorCounterpart, mirrorEdit, mirrorParts, mirrorPlane } from "../src/structure/transform";

const valid = (d: Design) => parseDesign(serializeDesign(d));
const span = (id: string) => catalogPart(id).span;
const position = (d: Design, id: string | undefined) =>
  d.nodes.find((n) => n.id === id)?.position ?? [0, 0, 0];

/** A lone 1200 male along +X (n0 → n1) with a 1200 board going up from its start tenon. */
function boardOnStart() {
  const d = createDrawingDesign("male-1200");
  const male = d.members[0].id;
  const { memberId } = appendMember(
    d,
    "n0",
    "female",
    [0, 1, 0],
    span("female-1200-square"),
    "female-1200-square",
  );
  return { d, male, board: memberId };
}

describe("mirror plane across the middle of the centre male", () => {
  it("lies halfway between the two tenons, perpendicular to the shaft", () => {
    const { d, male } = boardOnStart();
    const plane = mirrorPlane(d, male);
    const [a, b] = [position(d, "n0"), position(d, "n1")];
    expect(plane.normal).toEqual([1, 0, 0]);
    expect(plane.point[0]).toBeCloseTo((a[0] + b[0]) / 2, 6);
    expect(() => mirrorPlane(d, d.members.find((m) => m.kind === "female")?.id ?? "")).toThrow(
      "中心にする雄材",
    );
  });

  it("copies a board on one tenon to the other tenon, on the same layer", () => {
    const { d, male, board } = boardOnStart();
    const [copy] = mirrorParts(d, [board], mirrorPlane(d, male));
    const after = valid(d);
    const original = after.members.find((m) => m.id === board);
    const image = after.members.find((m) => m.id === copy);
    expect(image?.catalogId).toBe("female-1200-square");
    expect([image?.start, image?.end]).toContain("n1");
    expect(image?.layer).toBe(original?.layer);
    const far = image?.start === "n1" ? image?.end : image?.start;
    expect(position(after, far)[1]).toBeCloseTo(span("female-1200-square"), 6);
    expect(position(after, far)[0]).toBeCloseTo(position(after, "n1")[0], 6);
    expect(() => mirrorParts(d, [board], mirrorPlane(d, male))).toThrow("既に同じ部材");
  });

  it("finds square templates already symmetric", () => {
    const d = createDrawingDesign();
    const { memberId } = insertMaleAtHole(d, "m0", 4, catalogPart("male-600").span, 1);
    addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: span("female-1200-square") });
    const square = d.members.filter((m) => m.id !== "m0").map((m) => m.id);
    expect(() => mirrorParts(d, square, mirrorPlane(d, memberId))).toThrow("左右対称");
  });

  it("copies a brace on one face of a frame to the other face", () => {
    const d = createDrawingDesign("female-450-square");
    const { memberId } = insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
    const male = (created: string[]) =>
      created.find((c) => d.members.find((m) => m.id === c)?.kind === "male") ?? "";
    const a = span("female-450-square");
    const b = span("female-600-square");
    const second = male(
      addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: a }).created,
    );
    const third = male(addTemplate(d, { shape: "square", males: [second], direction: "y", size: b }).created);
    const fourth = male(
      addTemplate(d, { shape: "square", males: [third], direction: "-x", size: a }).created,
    );
    addTemplate(d, { shape: "square", males: [fourth, memberId] });
    const corner = d.members.find((m) => m.id === memberId);
    const opposite = d.members.find((m) => m.id === third);
    const brace = connectBoard(d, corner?.end ?? "", opposite?.end ?? "");
    const [copy] = mirrorParts(d, [brace], mirrorPlane(d, memberId));
    const after = valid(d);
    const image = after.members.find((m) => m.id === copy);
    expect(image?.catalogId).toBe("female-750-square");
    expect([image?.start, image?.end].sort()).toEqual([corner?.start, opposite?.start].sort());
  });
});

describe("mirror mode", () => {
  /** Applies an edit the way the editor does in mirror mode. */
  const edit = (d: Design, centre: string, action: (draft: Design) => void) => {
    const draft = structuredClone(d);
    action(draft);
    mirrorEdit(d, draft, mirrorPlane(draft, centre));
    return valid(draft);
  };

  it("repeats additions, resizing and deletions on the other tenon", () => {
    const d = createDrawingDesign("male-1200");
    const male = d.members[0].id;
    let board = "";
    const added = edit(d, male, (draft) => {
      board = appendMember(
        draft,
        "n0",
        "female",
        [0, 1, 0],
        span("female-1200-square"),
        "female-1200-square",
      ).memberId;
    });
    const plane = mirrorPlane(added, male);
    const member = (design: Design) => design.members.find((m) => m.id === board) ?? design.members[0];
    const image = mirrorCounterpart(added, member(added), plane);
    expect(image).toBeDefined();
    expect(image).not.toBe(board);

    const longer = edit(added, male, (draft) => {
      resizeBoard(draft, board, 1);
    });
    expect(member(longer).catalogId).toBe("female-1500-square");
    const newImage = mirrorCounterpart(longer, member(longer), plane);
    expect(longer.members.find((m) => m.id === newImage)?.catalogId).toBe("female-1500-square");
    expect(longer.members.filter((m) => m.kind === "female")).toHaveLength(2);

    const gone = edit(longer, male, (draft) => {
      removeMember(draft, board);
    });
    expect(gone.members.map((m) => m.id)).toEqual([male]);
  });

  it("leaves edits that change no member alone", () => {
    const { d, male } = boardOnStart();
    const after = edit(d, male, (draft) => {
      draft.name = "renamed";
    });
    expect(after.members).toEqual(d.members);
  });
});

describe("mirror mode on a frame of inserted males", () => {
  it("keeps the hole joints in step when a board between two males is lengthened", () => {
    // A triangle prism: three males standing in holes, boards on both tenon sides of each pair.
    let d = createDrawingDesign("female-600-square");
    const { memberId } = insertMaleAtHole(d, "m0", 0, catalogPart("male-1200").span, 1);
    addTemplate(d, { shape: "triangle", males: [memberId], direction: "x", size: span("female-600-square") });
    connectThreadedMales(d);
    d = valid(d);
    const board = d.members.find(
      (m) =>
        m.kind === "female" &&
        m.id !== "m0" &&
        [m.start, m.end].includes(d.members.find((v) => v.id === memberId)?.start ?? ""),
    );
    if (!board) throw new Error("No board on the male");
    for (let step = 0; step < 2; step++) {
      const draft = structuredClone(d);
      resizeBoard(draft, board.id, 1);
      mirrorEdit(d, draft, mirrorPlane(draft, memberId));
      connectThreadedMales(draft);
      d = valid(draft);
    }
    expect(d.members.find((m) => m.id === board.id)?.catalogId).toBe("female-900-square");
  });
});

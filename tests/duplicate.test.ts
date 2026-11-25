import { describe, expect, it } from "vitest";
import { catalogPart } from "../src/structure/catalog";
import { type Design, parseDesign, serializeDesign, type Vec3 } from "../src/structure/design";
import { connectThreadedMales, createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";
import { addTemplate } from "../src/structure/templates";
import { duplicateParts, endPlane, mirrorAtEnd, moveParts, sideToward } from "../src/structure/transform";

const valid = (d: Design) => parseDesign(serializeDesign(d));
const span = catalogPart("female-1200-square").span;

/** A square bay on the 2400 base board: a male in hole 0 and one 1200 further along +X. */
function bay() {
  const d = createDrawingDesign();
  const { memberId } = insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
  const { created } = addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: span });
  connectThreadedMales(d);
  return { d: valid(d), parts: [memberId, ...created] };
}

describe("duplicating parts", () => {
  it("copies a bay sideways, sharing the male between the bays", () => {
    const { d, parts } = bay();
    const before = d.members.length;
    const created = duplicateParts(d, parts, [span, 0, 0]);
    const after = valid(d);
    const kinds = created.map((id) => after.members.find((m) => m.id === id)?.kind);
    // The copy of the first male would stand on the second one, so only the far male and the boards are new.
    expect(kinds.filter((k) => k === "male")).toHaveLength(1);
    expect(kinds.filter((k) => k === "female")).toHaveLength(2);
    expect(after.members).toHaveLength(before + 3);
    // The new male stands in the last hole of the base board.
    const male = created.find((id) => after.members.find((m) => m.id === id)?.kind === "male");
    expect(after.connections.some((c) => c.male === male && c.female === "m0")).toBe(true);
  });

  it("has no upper limit on nodes", () => {
    const { d, parts } = bay();
    // Bays stacked one behind another, each with nodes of its own, until well past the old limit of 32.
    for (let i = 1; i <= 12; i++) duplicateParts(d, parts, [0, 0, i]);
    expect(d.nodes.length).toBeGreaterThan(32);
    expect(valid(d).nodes).toHaveLength(d.nodes.length);
  });

  it("has no upper limit on members or hole joints", () => {
    const { d, parts } = bay();
    // Bays stacked one behind another until the joints are past the old limit of 100 entries per list.
    for (let i = 1; d.connections.length <= 100; i++) duplicateParts(d, parts, [0, 0, i * 0.8]);
    expect(d.members.length).toBeGreaterThan(100);
    expect(valid(d).connections).toHaveLength(d.connections.length);
  }, 30_000);

  it("keeps the drawing span of a slanted board whose ends are rounded by the copy", () => {
    const d = createDrawingDesign("female-3600-round");
    const span = catalogPart("female-3600-round").span;
    // A slant and start off the 1 µm grid, so rounding both ends shortens the copy by just over 1 µm.
    const [a, b] = [0.1 + 24 * 0.0137, 0.3 + 24 * 0.0071];
    const dir = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)];
    d.nodes[0].position = [0.3333333 + 24 * 1.3e-7, 0.1777777, -0.2111111];
    d.nodes[1].position = d.nodes[0].position.map((v, i) => v + dir[i] * span) as Vec3;
    const [copy] = duplicateParts(d, ["m0"], [0.1234567 + 24 * 3.1e-7, 0, 0]);
    const member = d.members.find((m) => m.id === copy);
    const at = (id?: string) => d.nodes.find((n) => n.id === id)?.position ?? [0, 0, 0];
    const length = Math.hypot(...at(member?.start).map((v, i) => v - at(member?.end)[i]));
    expect(Math.abs(length - span)).toBeGreaterThan(1e-6);
    expect(valid(d).members).toHaveLength(2);
  });

  it("names tenons meeting in one hole when a board and its male are copied onto the male's tip", () => {
    const d = createDrawingDesign();
    const { memberId: male, nodeId: tip } = insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, -1);
    const z = d.nodes.find((n) => n.id === tip)?.position[2] ?? 0;
    // The copied board would sit on the male's far tenon, but the copied male pushes its own tenon into the
    // same hole from the other face.
    expect(() => duplicateParts(structuredClone(d), ["m0", male], [0, 0, z])).toThrow(
      /m1 と m\d+ の凸の先同士/,
    );
    // Two tenon lengths further on the tenons no longer meet.
    expect(duplicateParts(d, ["m0", male], [0, 0, z - 0.34])).toHaveLength(2);
  });

  it("refuses a copy that would lie exactly on what is there, and draws one unchecked", () => {
    const { d, parts } = bay();
    expect(() => duplicateParts(d, parts, [0, 0, 0])).toThrow("同じ部材");
    const draft = structuredClone(d);
    expect(duplicateParts(draft, parts, [0.05, 0, 0], { check: false }).length).toBe(parts.length);
  });
});

describe("mirroring parts at their end", () => {
  it("turns a bay over about its outermost male and joins the image there", () => {
    const { d, parts } = bay();
    const plane = endPlane(d, parts, [1, 0, 0]);
    const ends = new Set(d.members.filter((m) => parts.includes(m.id)).flatMap((m) => [m.start, m.end]));
    const xs = d.nodes.filter((n) => ends.has(n.id)).map((n) => n.position[0]);
    expect(plane.point[0]).toBeCloseTo(Math.max(...xs), 6);
    const { created, image } = mirrorAtEnd(d, parts, [1, 0, 0]);
    // The image is the new members and the shared end male, ready to be mirrored again further on.
    expect(image).toHaveLength(parts.length);
    expect(mirrorAtEnd(d, image, [1, 0, 0]).created).toHaveLength(3);
    const after = valid(d);
    const kinds = created.map((id) => after.members.find((m) => m.id === id)?.kind);
    // The end male lies on the plane and is shared; its far image and the two boards are new.
    expect(kinds.filter((k) => k === "male")).toHaveLength(1);
    expect(kinds.filter((k) => k === "female")).toHaveLength(2);
    const sources = new Set(
      after.members.filter((m) => parts.includes(m.id)).flatMap((m) => [m.start, m.end]),
    );
    const at = (id: string) => after.nodes.find((n) => n.id === id)?.position ?? [0, 0, 0];
    const images = [...sources].map((id) => [2 * plane.point[0] - at(id)[0], at(id)[1], at(id)[2]]);
    for (const m of after.members.filter((v) => created.includes(v.id)))
      for (const p of [at(m.start), at(m.end)])
        expect(images.some((q) => q.every((v, i) => Math.abs(v - p[i]) < 1e-6))).toBe(true);
    // Every new board hangs on a male: the image is joined to the structure, not floating.
    for (const m of after.members.filter((v) => created.includes(v.id) && v.kind === "female"))
      expect(after.members.some((v) => v.kind === "male" && [v.start, v.end].includes(m.start))).toBe(true);
  });

  it("joins the image at a chosen male instead of the outermost end", () => {
    const { d, parts } = bay();
    const males = parts.filter((id) => d.members.find((m) => m.id === id)?.kind === "male");
    const x = (id: string) => {
      const m = d.members.find((v) => v.id === id);
      return d.nodes.find((n) => n.id === m?.start)?.position[0] ?? 0;
    };
    const [near] = [...males].sort((a, b) => x(a) - x(b));
    // The first male is the left end, so the image goes toward -X there.
    expect(sideToward(d, parts, near)).toEqual([-1, 0, 0]);
    const draft = structuredClone(d);
    const { created } = mirrorAtEnd(draft, parts, [-1, 0, 0], { check: false, through: near });
    const after = valid(draft);
    for (const m of after.members.filter((v) => created.includes(v.id)))
      for (const id of [m.start, m.end])
        expect(after.nodes.find((n) => n.id === id)?.position[0] ?? 9).toBeLessThanOrEqual(x(near) + 1e-6);
    // A male cannot be the end along its own shaft.
    const shaft = d.members.find((m) => m.id === near);
    const [a, b] = [shaft?.start, shaft?.end].map(
      (id) => d.nodes.find((n) => n.id === id)?.position ?? [0, 0, 0],
    );
    const along = a.map((v, i) => Math.round(Math.sign(b[i] - v))) as [number, number, number];
    expect(() => mirrorAtEnd(structuredClone(d), parts, along, { through: near })).toThrow("直角に交わる面");
  });

  it("shares an end male that stands off the 1e-6 grid instead of doubling it", () => {
    const { d, parts } = bay();
    // Laying holes over each other leaves males at unrounded coordinates.
    const ends = new Set(d.members.filter((m) => parts.includes(m.id)).flatMap((m) => [m.start, m.end]));
    const reach = Math.max(...d.nodes.filter((n) => ends.has(n.id)).map((n) => n.position[0]));
    for (const n of d.nodes)
      if (ends.has(n.id) && Math.abs(n.position[0] - reach) < 1e-9) n.position[0] += 4e-7;
    const { created } = mirrorAtEnd(d, parts, [1, 0, 0]);
    const after = valid(d);
    expect(created.filter((id) => after.members.find((m) => m.id === id)?.kind === "male")).toHaveLength(1);
  });

  it("refuses an image that is already there", () => {
    const { d, parts } = bay();
    const { created } = mirrorAtEnd(d, parts, [1, 0, 0]);
    expect(() => mirrorAtEnd(d, [...parts, ...created], [-1, 0, 0])).not.toThrow();
    const again = valid(d);
    expect(() => mirrorAtEnd(again, created, [-1, 0, 0])).toThrow("既に同じ部材");
  });
});

describe("moving picked members together", () => {
  it("moves a set of boards off the rest, splitting the nodes they shared", () => {
    const { d, parts } = bay();
    const boards = parts.filter((id) => d.members.find((m) => m.id === id)?.kind === "female");
    moveParts(d, "set", boards.join(","), {
      translate: [0, 0, 2],
      axis: [0, 1, 0],
      angle: 0,
      pivot: [0, 0, 0],
    });
    const after = valid(d);
    for (const id of boards) {
      const m = after.members.find((v) => v.id === id);
      const z = after.nodes.find((n) => n.id === m?.start)?.position[2] ?? 0;
      expect(z).toBeGreaterThan(1.9);
    }
    // The males stay where they were.
    const males = parts.filter((id) => after.members.find((m) => m.id === id)?.kind === "male");
    for (const id of males) {
      const m = after.members.find((v) => v.id === id);
      expect(after.nodes.find((n) => n.id === m?.start)?.position[2] ?? 9).toBeLessThan(1);
    }
  });
});

describe("duplicating a board onto the far tenon of a male", () => {
  it("turns the copy to face out along the tenon and joins it in the middle hole", () => {
    // The (12) layout: a 1200 male in the middle hole of a 2400 board; copy the board onto its far end.
    const d = createDrawingDesign();
    const { memberId: maleId } = insertMaleAtHole(d, "m0", 4, catalogPart("male-1200").span, -1);
    const male = d.members.find((m) => m.id === maleId);
    const at = (id = "") => d.nodes.find((n) => n.id === id)?.position ?? [0, 0, 0];
    const [base, tip] = [at(male?.start), at(male?.end)];
    const offset = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]] as [number, number, number];
    const created = duplicateParts(d, ["m0"], offset);
    const copy = d.members.find((m) => m.id === created[0]);
    expect(copy?.roll).toBe(180);
    expect(copy?.layer).toBe(0);
    expect(d.connections.some((c) => c.male === maleId && c.female === copy?.id && c.hole === 4)).toBe(true);
    valid(d);
  });
});

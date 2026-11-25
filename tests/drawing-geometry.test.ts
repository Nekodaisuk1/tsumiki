import * as THREE from "three";
import { describe, expect, it } from "vitest";
import drawingExample from "../public/examples/hitoto-2400.tsumiki.json?raw";
import { catalogPart, HITOTO_GEOMETRY, HITOTO_PARTS } from "../src/structure/catalog";
import { createDesign, parseDesign, serializeDesign, validateDesign } from "../src/structure/design";
import { appendMember, createDrawingDesign, insertMaleAtHole } from "../src/structure/editor";
import { femaleGeometry, maleGeometry, ringGeometry } from "../src/structure/geometry";
import { holeSite } from "../src/structure/holes";
import { solveStatic } from "../src/structure/solver";
import { addTemplate } from "../src/structure/templates";

function hit(geometry: THREE.BufferGeometry, x: number, y: number) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  return new THREE.Raycaster(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)).intersectObject(mesh)
    .length;
}
describe("hitoto drawing dimensions", () => {
  it("reproduces the dimensioned 2400 male including both 165 mm tenons", () => {
    const part = catalogPart("male-2400");
    expect(part.span).toBeCloseTo(2.07, 10);
    const geometry = maleGeometry(part.span, HITOTO_GEOMETRY);
    const bounds = geometry.map((g) => {
      g.computeBoundingBox();
      if (!g.boundingBox) throw new Error("Missing geometry bounds");
      return g.boundingBox;
    });
    expect(bounds[0].max.y - bounds[0].min.y).toBeCloseTo(0.105, 7);
    expect(bounds[0].max.z - bounds[0].min.z).toBeCloseTo(0.03, 7);
    expect(bounds[2].max.x - bounds[1].min.x).toBeCloseTo(2.4, 6);
    expect(bounds[1].max.x - bounds[1].min.x).toBeCloseTo(0.165, 7);
  });
  it("reproduces all nine dimensioned round holes and a real circular opening", () => {
    const design = createDrawingDesign();
    const member = design.members[0];
    const part = catalogPart(member.catalogId ?? "");
    const geometry = femaleGeometry(part.span, design.geometry, member.holeCount, member);
    geometry.computeBoundingBox();
    if (!geometry.boundingBox) throw new Error("Missing geometry bounds");
    expect(geometry.boundingBox.min.x).toBeCloseTo(-0.078, 7);
    expect(geometry.boundingBox.max.x).toBeCloseTo(2.322, 7);
    expect(part.holes.map((x) => Math.round((x + 0.078) * 10000) / 10)).toEqual([
      78, 358.5, 639, 919.5, 1200, 1480.5, 1761, 2041.5, 2322,
    ]);
    for (let i = 0; i < 9; i++) {
      expect(hit(geometry, part.holes[i], 0)).toBe(0);
      expect(holeSite(design, member.id, i).center[0]).toBeCloseTo(part.holes[i], 10);
    }
    // The corners of a 39 mm square are solid in a 39 mm circular opening.
    expect(hit(geometry, 0.017, 0.017)).toBeGreaterThan(0);
    expect(hit(geometry, 0.018, 0)).toBe(0);
  });
  it("has semicircular female ends and a 100 mm ring with a round hole", () => {
    const design = createDrawingDesign("female-2400-round");
    const member = design.members[0];
    const geometry = femaleGeometry(
      catalogPart(member.catalogId ?? "").span,
      design.geometry,
      member.holeCount,
      member,
    );
    geometry.computeBoundingBox();
    if (!geometry.boundingBox) throw new Error("Missing geometry bounds");
    expect(geometry.boundingBox.max.x - geometry.boundingBox.min.x).toBeCloseTo(2.349, 7);
    expect(hit(geometry, -0.05, 0.05)).toBe(0);
    expect(hit(geometry, -0.04, 0)).toBeGreaterThan(0);
    const ring = ringGeometry(design.geometry);
    ring.computeBoundingBox();
    if (!ring.boundingBox) throw new Error("Missing ring bounds");
    expect(ring.boundingBox.max.y - ring.boundingBox.min.y).toBeCloseTo(0.1, 7);
    expect(ring.boundingBox.max.x - ring.boundingBox.min.x).toBeCloseTo(0.03, 7);
  });
  it("keeps half-pitch drawings separate from the dimensioned 2400 nine-hole version", () => {
    expect(catalogPart("female-750-square").holes).toHaveLength(6);
    expect(catalogPart("female-2400-square-dense").holes).toHaveLength(17);
    expect(catalogPart("female-2400-square").holes).toHaveLength(9);
  });
  it("can create and save every catalog part without resizing it", () => {
    for (const part of HITOTO_PARTS)
      expect(parseDesign(serializeDesign(createDrawingDesign(part.id))).members[0].catalogId).toBe(part.id);
  });
  it("fits rounded tenons in round holes and rejects unrounded ones", () => {
    const design = createDrawingDesign();
    const part = catalogPart("male-300");
    const added = insertMaleAtHole(design, "m0", 4, part.span, 1);
    expect(() => validateDesign(design)).not.toThrow();
    const valid = parseDesign(serializeDesign(design));
    expect(valid.members[1].catalogId).toBe(part.id);
    const rotated = structuredClone(valid);
    rotated.members[1].roll = 45;
    expect(() => validateDesign(rotated)).not.toThrow();
    const female = catalogPart("female-300-round");
    appendMember(design, added.nodeId, "female", [1, 0, 0], female.span, female.id);
    expect(() => validateDesign(design)).not.toThrow();
    design.geometry.tenonCornerRadius = 0;
    expect(() => validateDesign(design)).toThrow(/丸穴|干渉/);
  });
  it("rejects collisions between rounded female boards and refuses arbitrary stretching", () => {
    const d = createDrawingDesign("female-2400-round");
    d.nodes.push(
      { id: "a", position: [1, -1, 0], fixed: false },
      { id: "b", position: [1, 1.244, 0], fixed: false },
    );
    d.members.push({ ...d.members[0], id: "cross", start: "a", end: "b", roll: 0 });
    expect(() => validateDesign(d)).toThrow(/干渉/);
    const stretched = createDrawingDesign();
    stretched.nodes[1].position[0] += 0.01;
    expect(() => validateDesign(stretched)).toThrow(/規格/);
  });
  it("preserves legacy geometry and does not apply a square-hole contact law to round holes", () => {
    const old = createDesign();
    expect(parseDesign(serializeDesign(old))).toEqual(old);
    const drawing = createDrawingDesign();
    drawing.jointModel = "clearance-contact";
    expect(() => solveStatic(drawing, "none")).toThrow(/丸穴/);
  });
});

it("reads the distributed drawing example and rejects a string version", () => {
  const text = drawingExample;
  expect(parseDesign(text).members[0].catalogId).toBe("female-2400-square");
  const malformed = JSON.parse(text);
  malformed.version = "6";
  expect(() => parseDesign(JSON.stringify(malformed))).toThrow(/形式/);
});

it("builds a triangular section from catalog members without bypassing round-hole collisions", () => {
  const d = createDrawingDesign();
  const male = catalogPart("male-1200");
  const added = insertMaleAtHole(d, "m0", 4, male.span, 1);
  addTemplate(d, {
    shape: "triangle",
    males: [added.memberId],
    direction: "x",
    size: catalogPart("female-1200-square").span,
  });
  expect(() => validateDesign(d)).not.toThrow();
  expect(d.members.every((m) => m.catalogId)).toBe(true);
});

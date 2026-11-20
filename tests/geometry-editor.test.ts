import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createDesign, DEFAULT_GEOMETRY, parseDesign, serializeDesign } from "../src/structure/design";
import { appendMember, DesignHistory, extendBay } from "../src/structure/editor";
import { femaleGeometry, freeRingSlot, maleGeometry, ringGeometry } from "../src/structure/geometry";

function hit(geometry: THREE.BufferGeometry, origin: THREE.Vector3, direction: THREE.Vector3) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  return new THREE.Raycaster(origin, direction).intersectObject(mesh).length;
}
describe("actual patterned geometry", () => {
  it("has evenly spaced through holes rather than painted marks", () => {
    const geometry = femaleGeometry(1.2, DEFAULT_GEOMETRY, 7);
    for (let i = 0; i < 7; i++)
      expect(hit(geometry, new THREE.Vector3(i * 0.2, 0, 1), new THREE.Vector3(0, 0, -1))).toBe(0);
    expect(hit(geometry, new THREE.Vector3(0.1, 0, 1), new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0);
    expect(hit(geometry, new THREE.Vector3(0, 0.07, 1), new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0);
  });
  it("extends square tenons from both short ends of the male board", () => {
    const [body, left, right] = maleGeometry(1.4, DEFAULT_GEOMETRY);
    body.computeBoundingBox();
    left.computeBoundingBox();
    right.computeBoundingBox();
    expect(body.boundingBox?.min.x).toBeCloseTo(0);
    expect(body.boundingBox?.max.x).toBeCloseTo(1.4);
    expect(left.boundingBox?.min.x).toBeCloseTo(-DEFAULT_GEOMETRY.tenonLength);
    expect(right.boundingBox?.max.x).toBeCloseTo(1.4 + DEFAULT_GEOMETRY.tenonLength);
  });
  it("gives the ring a matching square through hole along the tenon axis", () => {
    const geometry = ringGeometry(DEFAULT_GEOMETRY);
    expect(hit(geometry, new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0))).toBe(0);
    expect(hit(geometry, new THREE.Vector3(1, 0.07, 0), new THREE.Vector3(-1, 0, 0))).toBeGreaterThan(0);
  });
});
it("fits rings onto the male tenon and fills a gap between female layers", () => {
  const d = createDesign();
  d.members
    .filter((m) => m.kind === "female" && (m.start === "n0" || m.end === "n0") && m.layer === 1)
    .forEach((m) => {
      m.layer = 2;
    });
  expect(freeRingSlot(d, "m0", "start")).toBe(1);
  d.rings.push({ id: "ring0", member: "m0", end: "start", slot: 1, role: "spacer-unmodeled" });
  expect(parseDesign(serializeDesign(d)).rings).toEqual(d.rings);
  expect(freeRingSlot(d, "m0", "start")).toBe(3);
  d.rings[0].slot = 0;
  expect(() => serializeDesign(d)).toThrow(/雌材/);
  d.rings[0].slot = 8;
  expect(() => serializeDesign(d)).toThrow(/長さ/);
  d.rings[0].member = "m4";
  expect(() => serializeDesign(d)).toThrow(/雄材/);
});
it("uses horizontal male boards and connects a continuous bay without duplicate nodes", () => {
  const d = createDesign();
  for (const m of d.members.filter((m) => m.kind === "male")) {
    const a = d.nodes.find((n) => n.id === m.start);
    const b = d.nodes.find((n) => n.id === m.end);
    expect(a?.position[1]).toBe(b?.position[1]);
    expect(a?.position[2]).toBe(b?.position[2]);
  }
  extendBay(d, 1);
  expect(d.nodes).toHaveLength(12);
  expect(d.members).toHaveLength(20);
  expect(new Set(d.nodes.map((n) => n.position.join(","))).size).toBe(12);
  expect(() => serializeDesign(d)).not.toThrow();
});
it("reuses endpoints when adding a member and undoes complete design edits", () => {
  const before = createDesign();
  const d = structuredClone(before);
  const result = appendMember(d, "n6", "female", [0, 1, 0], 1);
  expect(d.nodes).toHaveLength(9);
  expect(result.memberId).toBeTruthy();
  const history = new DesignHistory();
  history.push(before, d);
  expect(history.canUndo).toBe(true);
  const restored = history.undo(d);
  expect(restored).toEqual(before);
  expect(history.redo(restored)).toEqual(d);
  const reuse = structuredClone(before);
  reuse.members = reuse.members.filter((m) => m.id !== "m3");
  appendMember(reuse, "n7", "male", [1, 0, 0], 1.4);
  expect(reuse.nodes).toHaveLength(8);
});
it("migrates version 1 with explicit geometry and attached ring semantics", () => {
  const d = createDesign();
  const { geometry, connections, joint, ropeWrap, ...base } = d;
  void connections;
  void geometry;
  void joint;
  void ropeWrap;
  const legacy = {
    ...base,
    jointModel: "rigid-approximation",
    version: 1,
    solver: "frame3d-linear-v1",
    members: d.members.map(({ roll, layer, holeCount, ...m }) => {
      void roll;
      void layer;
      void holeCount;
      return m;
    }),
    rings: [{ id: "ring0", node: "n0", role: "spacer-unmodeled" }],
  };
  expect(() => parseDesign(JSON.stringify(legacy))).toThrow(/干渉/);
  legacy.members = legacy.members.filter((m) => m.kind === "male");
  legacy.ropes = [];
  const restored = parseDesign(JSON.stringify(legacy));
  expect(restored.version).toBe(5);
  expect(restored.jointModel).toBe("rigid-approximation");
  expect(restored.rings[0].member).toBe("m0");
  expect(restored.rings[0].end).toBe("start");
});

it("places an added female outside existing boards and spacers rather than filling gaps", () => {
  const d = createDesign();
  d.members
    .filter((m) => m.kind === "female" && (m.start === "n6" || m.end === "n6") && m.layer === 1)
    .forEach((m) => {
      m.layer = 2;
    });
  d.rings.push({ id: "ring0", member: "m3", end: "end", slot: 1, role: "spacer-unmodeled" });
  const added = appendMember(d, "n6", "female", [0, 1, 0], 1);
  expect(d.members.find((m) => m.id === added.memberId)?.layer).toBe(3);
});
it("reserves the fifth thickness for rope and rejects another outer board", () => {
  const d = createDesign();
  expect(d.geometry.tenonLength / d.geometry.thickness).toBeCloseTo(5);
  const added = appendMember(d, "n6", "female", [0, 1, 0], 1);
  expect(d.members.find((m) => m.id === added.memberId)?.layer).toBe(2);
  appendMember(d, "n6", "female", [0, 0, 1], 1);
  expect(() => appendMember(d, "n6", "female", [0, -1, 0], 0.7)).toThrow(/ロープ|4枚/);
  const ring = structuredClone(createDesign());
  ring.rings.push({ id: "ring0", member: "m0", end: "start", slot: 4, role: "spacer-unmodeled" });
  expect(() => serializeDesign(ring)).toThrow(/ロープ/);
});

it("allows a second female between the same endpoints only in an outer layer", () => {
  const d = createDesign();
  const added = appendMember(d, "n1", "female", [0, 1, 0], 1.2);
  expect(d.nodes).toHaveLength(8);
  expect(d.members.find((m) => m.id === added.memberId)?.layer).toBe(2);
  expect(() => serializeDesign(d)).not.toThrow();
  const duplicate = d.members.find((m) => m.id === added.memberId);
  if (!duplicate) throw new Error("Missing member");
  duplicate.layer = 0;
  expect(() => serializeDesign(d)).toThrow(/重複/);
});
it("migrates old lengths but refuses to move a board out of the rope reservation", () => {
  const { joint, ropeWrap, ...d } = createDesign();
  void joint;
  void ropeWrap;
  const old = {
    ...d,
    jointModel: "rigid-approximation",
    version: 2,
    solver: "frame3d-linear-v2",
    geometry: { ...d.geometry, tenonLength: 0.24 },
  };
  expect(parseDesign(JSON.stringify(old)).geometry.tenonLength).toBeCloseTo(d.geometry.thickness * 5);
  const female = old.members.find((m) => m.kind === "female");
  if (!female) throw new Error("Missing female");
  female.layer = 4;
  expect(() => parseDesign(JSON.stringify(old))).toThrow(/ロープ/);
});

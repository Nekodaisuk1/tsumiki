import { Box3, type Shape, ShapeUtils, Vector3 } from "three";
import type { Design, Member } from "./design";
import { CURVE_SEGMENTS, femaleShape, memberFrame, roundedRectangle, tenonShape } from "./geometry";
import { boardAxes } from "./holes";

type Cell = { points: Vector3[]; normals: Vector3[]; edges: Vector3[]; bounds: Box3 };
/**
 * Overlaps up to this depth (1 µm) count as touching. Nodes closer than this are the same node, so the
 * ends of a part placed between two such nodes can tilt by that much and press faces this far together.
 */
const EPSILON = 1e-6;
const cache = new Map<string, Vector3[][]>();

function localCells(design: Design, member: Member, length: number): Vector3[][] {
  const g = design.geometry;
  const key = JSON.stringify([g, member.kind, member.catalogId, member.holeCount, length]);
  const cached = cache.get(key);
  if (cached) return cached;
  const cells: Vector3[][] = [];
  const extrude = (shape: Shape, depth: number, split: boolean, tenonCenter?: number) => {
    const { shape: outline, holes } = shape.extractPoints(CURVE_SEGMENTS);
    // ExtrudeGeometry also triangulates these sampled contours with Three.js ShapeUtils.
    if (outline[0].equals(outline[outline.length - 1])) outline.pop();
    for (const hole of holes) if (hole[0].equals(hole[hole.length - 1])) hole.pop();
    const vertices = [...outline, ...holes.flat()];
    const polygons = split
      ? ShapeUtils.triangulateShape(outline, holes).map((face) => face.map((i) => vertices[i]))
      : [outline];
    for (const polygon of polygons) {
      cells.push(
        [-0.5, 0.5].flatMap((side) =>
          polygon.map((p) =>
            tenonCenter === undefined
              ? new Vector3(p.x, p.y, side * depth)
              : new Vector3(tenonCenter + side * depth, p.y, -p.x),
          ),
        ),
      );
    }
  };
  if (member.kind === "female") extrude(femaleShape(length, g, member.holeCount, member), g.thickness, true);
  else {
    extrude(roundedRectangle(0, -g.boardWidth / 2, length, g.boardWidth / 2, 0), g.thickness, false);
    for (const center of [-g.tenonLength / 2, length + g.tenonLength / 2])
      extrude(tenonShape(g), g.tenonLength, false, center);
  }
  if (cache.size >= 64) cache.clear();
  cache.set(key, cells);
  return cells;
}
/** Where a member's solid lies: its frame, plus a key that is equal exactly when the solid is the same. */
export type DrawingSolid = { key: string; cells: () => Cell[] };
export function drawingSolid(design: Design, member: Member): DrawingSolid {
  const frame = boardAxes(design, member);
  const { kind, catalogId, holeCount, layer, roll } = member;
  const key = JSON.stringify([kind, catalogId, holeCount, layer, roll, frame.start, frame.end, frame.normal]);
  const full = `${geometryKey(design)}${key}`;
  return {
    key: full,
    cells: () => {
      let built = placed.get(full);
      if (!built) {
        built = cells(design, member, frame);
        if (placed.size >= PLACED_CACHE) placed.clear();
        placed.set(full, built);
      }
      return built;
    },
  };
}
/** Placed solids by key, reused by later checks (and floor supports) while the member stays put. */
const placed = new Map<string, Cell[]>();
const PLACED_CACHE = 4000;
const geometryKeys = new WeakMap<object, string>();
function geometryKey(design: Design) {
  let key = geometryKeys.get(design.geometry);
  if (key === undefined) {
    key = JSON.stringify(design.geometry);
    geometryKeys.set(design.geometry, key);
  }
  return key;
}
function cells(design: Design, member: Member, frame: ReturnType<typeof boardAxes>): Cell[] {
  const start = new Vector3(...frame.start);
  const rotation = memberFrame(start, new Vector3(...frame.end), member.roll).quaternion;
  if (member.kind === "female")
    start.addScaledVector(new Vector3(...frame.normal), (member.layer + 0.5) * design.geometry.thickness);
  return localCells(design, member, frame.length).map((local) => {
    const points = local.map((p) => p.clone().applyQuaternion(rotation).add(start));
    const n = points.length / 2;
    const depth = points[n].clone().sub(points[0]).normalize();
    const sides = points.slice(0, n).map((p, i) => points[(i + 1) % n].clone().sub(p).normalize());
    return {
      points,
      edges: [depth, ...sides],
      normals: [depth, ...sides.map((edge) => edge.clone().cross(depth).normalize())],
      bounds: new Box3().setFromPoints(points),
    };
  });
}
function overlap(a: Cell, b: Cell): boolean {
  if (!a.bounds.intersectsBox(b.bounds)) return false;
  const separates = (axis: Vector3) => {
    if (axis.lengthSq() < 1e-20) return false;
    axis.normalize();
    const pa = a.points.map((p) => p.dot(axis));
    const pb = b.points.map((p) => p.dot(axis));
    return Math.min(...pa) >= Math.max(...pb) - EPSILON || Math.min(...pb) >= Math.max(...pa) - EPSILON;
  };
  for (const normal of [...a.normals, ...b.normals]) if (separates(normal.clone())) return false;
  for (const ea of a.edges) for (const eb of b.edges) if (separates(ea.clone().cross(eb))) return false;
  return true;
}
/** Corner points of the drawing solid of a member (the same outline the renderer and collisions use). */
export function memberSolidPoints(design: Design, member: Member): Vector3[] {
  return drawingSolid(design, member)
    .cells()
    .flatMap((cell) => cell.points);
}
/**
 * Results for pairs of solids already compared. Editing re-validates the whole design several times per
 * step while most pairs stay where they were, so only pairs with a moved or changed member are compared.
 */
const pairs = new Map<string, boolean>();
const PAIR_CACHE = 50_000;
/** Narrow phase for the same polygonal circular holes and rounded outlines used by the renderer. */
export function drawingSolidsOverlap(a: DrawingSolid, b: DrawingSolid): boolean {
  const key = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
  const known = pairs.get(key);
  if (known !== undefined) return known;
  const ac = a.cells();
  const bc = b.cells();
  // Only cells reaching into the other solid's box can touch it.
  const around = (list: Cell[]) => list.reduce((box, c) => box.union(c.bounds), new Box3());
  const aBox = around(ac);
  const bBox = around(bc);
  const near = (list: Cell[], box: Box3) => list.filter((c) => c.bounds.intersectsBox(box));
  const bNear = near(bc, aBox);
  const result = bNear.length > 0 && near(ac, bBox).some((x) => bNear.some((y) => overlap(x, y)));
  if (pairs.size >= PAIR_CACHE) pairs.clear();
  pairs.set(key, result);
  return result;
}
export function drawingMembersOverlap(design: Design, a: Member, b: Member): boolean {
  return drawingSolidsOverlap(drawingSolid(design, a), drawingSolid(design, b));
}

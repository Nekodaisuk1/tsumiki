import { Box3, type Shape, ShapeUtils, Vector3 } from "three";
import type { Design, Member } from "./design";
import { CURVE_SEGMENTS, femaleShape, memberFrame, roundedRectangle, tenonShape } from "./geometry";
import { boardAxes } from "./holes";

type Cell = { points: Vector3[]; normals: Vector3[]; edges: Vector3[]; bounds: Box3 };
const EPSILON = 1e-8;
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
function cells(design: Design, member: Member): Cell[] {
  const frame = boardAxes(design, member);
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
/** Narrow phase for the same polygonal circular holes and rounded outlines used by the renderer. */
export function drawingMembersOverlap(design: Design, a: Member, b: Member): boolean {
  const ac = cells(design, a);
  const bc = cells(design, b);
  return ac.some((x) => bc.some((y) => overlap(x, y)));
}

import { Matrix3, Vector3 } from "three";
import { OBB } from "three/addons/math/OBB.js";
import { femaleMargin, holeOffsets } from "./catalog";
import type { Design, Member, Vec3 } from "./design";
import { drawingMembersOverlap } from "./drawing-collision";
import { add3, boardAxes, cross3, dot3, holeSite, scale3, sub3 } from "./holes";

// Positive-volume overlap only: touching faces are valid assembly contacts.
const TOLERANCE = 1e-8;
type Part = "body" | "start" | "end";
type Box = { center: Vec3; axes: [Vec3, Vec3, Vec3]; half: Vec3; obb: OBB; part: Part };

function memberBoxes(design: Design, member: Member): Box[] {
  const frame = boardAxes(design, member);
  const axes: Box["axes"] = [frame.x, cross3(frame.normal, frame.x), frame.normal];
  const { boardWidth: width, thickness, tenonSize, tenonLength, holeSize } = design.geometry;
  const origin =
    member.kind === "female"
      ? add3(frame.start, scale3(frame.normal, (member.layer + 0.5) * thickness))
      : frame.start;
  const boxes: Box[] = [];
  const box = (lo: Vec3, hi: Vec3, part: Part = "body") => {
    const half = hi.map((v, i) => (v - lo[i]) / 2) as Vec3;
    let center = origin;
    for (let i = 0; i < 3; i++) center = add3(center, scale3(axes[i], (hi[i] + lo[i]) / 2));
    const rotation = new Matrix3().set(
      axes[0][0],
      axes[1][0],
      axes[2][0],
      axes[0][1],
      axes[1][1],
      axes[2][1],
      axes[0][2],
      axes[1][2],
      axes[2][2],
    );
    // Inset each solid face by half the tolerance so touching surfaces stay valid.
    const obb = new OBB(new Vector3(...center), new Vector3(...half).addScalar(-TOLERANCE / 2), rotation);
    boxes.push({ center, axes, half, obb, part });
  };
  if (member.kind === "male") {
    box([0, -width / 2, -thickness / 2], [frame.length, width / 2, thickness / 2]);
    for (const [start, part] of [
      [-tenonLength, "start"],
      [frame.length, "end"],
    ] as const)
      box([start, -tenonSize / 2, -tenonSize / 2], [start + tenonLength, tenonSize / 2, tenonSize / 2], part);
  } else {
    if (design.version === 6) {
      const margin = femaleMargin(design.geometry, member);
      box([-margin, -width / 2, -thickness / 2], [frame.length + margin, width / 2, thickness / 2]);
      return boxes;
    }
    // Exact solid decomposition of the legacy board, excluding every square through hole.
    const left = -femaleMargin(design.geometry, member);
    const right = frame.length + femaleMargin(design.geometry, member);
    box([left, -width / 2, -thickness / 2], [right, -holeSize / 2, thickness / 2]);
    box([left, holeSize / 2, -thickness / 2], [right, width / 2, thickness / 2]);
    let cursor = left;
    for (let i = 0; i < member.holeCount; i++) {
      const center = holeOffsets(frame.length, member.holeCount, member)[i];
      box([cursor, -holeSize / 2, -thickness / 2], [center - holeSize / 2, holeSize / 2, thickness / 2]);
      cursor = center + holeSize / 2;
    }
    box([cursor, -holeSize / 2, -thickness / 2], [right, holeSize / 2, thickness / 2]);
  }
  return boxes;
}

/**
 * Tenons of `male` that pass perpendicularly through one of the holes of `female`.
 * Hole and tenon sizes are still unresolved, so a board threaded on a tenon is assumed to have a hole
 * large enough for the angle it was assembled at (e.g. 60° in a triangular section): the tenon and that
 * board are not reported as colliding. The male body and other members are still checked.
 */
function threadedTenons(design: Design, male: Member, female: Member): Set<Part> {
  const threaded = new Set<Part>();
  const shaft = boardAxes(design, male);
  const board = boardAxes(design, female);
  if (Math.abs(Math.abs(dot3(shaft.x, board.normal)) - 1) > 1e-6) return threaded;
  const { tenonLength, thickness, holeSize } = design.geometry;
  for (let hole = 0; hole < female.holeCount; hole++) {
    const site = holeSite(design, female.id, hole).position;
    const along = dot3(sub3(site, shaft.start), shaft.x);
    const offAxis = Math.hypot(...sub3(sub3(site, shaft.start), scale3(shaft.x, along)));
    if (offAxis > holeSize / 2) continue;
    if (along <= 0 && along >= -tenonLength - thickness / 2) threaded.add("start");
    if (along >= shaft.length && along <= shaft.length + tenonLength + thickness / 2) threaded.add("end");
  }
  return threaded;
}

/** Throws on the first pair of members that overlap. With `only`, pairs not involving those members are skipped. */
export function validateMemberCollisions(design: Design, only?: ReadonlySet<string>): void {
  const solids = design.members.map((member) => {
    const boxes = memberBoxes(design, member);
    const bounds = [0, 1, 2].map((axis) => {
      const ranges = boxes.map((box) => {
        const radius = box.axes.reduce((sum, v, i) => sum + Math.abs(v[axis]) * box.half[i], 0);
        return [box.center[axis] - radius, box.center[axis] + radius];
      });
      return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
    });
    return { member, boxes, bounds };
  });
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i];
      const b = solids[j];
      if (only && !only.has(a.member.id) && !only.has(b.member.id)) continue;
      if (
        a.bounds.some(
          (range, axis) =>
            range[1] <= b.bounds[axis][0] + TOLERANCE || b.bounds[axis][1] <= range[0] + TOLERANCE,
        )
      )
        continue;
      if (design.version === 6) {
        if (drawingMembersOverlap(design, a.member, b.member))
          throw new Error(
            `部材 ${a.member.id} と ${b.member.id} が干渉しています。位置・向き・重ね段を変更してください`,
          );
        continue;
      }
      const pair =
        a.member.kind === "male" && b.member.kind === "female"
          ? threadedTenons(design, a.member, b.member)
          : b.member.kind === "male" && a.member.kind === "female"
            ? threadedTenons(design, b.member, a.member)
            : new Set<Part>();
      const solid = (box: Box, member: Member) => member.kind !== "male" || !pair.has(box.part);
      if (
        a.boxes.some(
          (x) => solid(x, a.member) && b.boxes.some((y) => solid(y, b.member) && x.obb.intersectsOBB(y.obb)),
        )
      )
        throw new Error(
          `部材 ${a.member.id} と ${b.member.id} が干渉しています。位置・向き・重ね段を変更してください`,
        );
    }
  }
}

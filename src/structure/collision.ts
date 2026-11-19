import { Matrix3, Vector3 } from "three";
import { OBB } from "three/addons/math/OBB.js";
import type { Design, Member, Vec3 } from "./design";
import { add3, boardAxes, cross3, scale3 } from "./holes";

// Positive-volume overlap only: touching faces are valid assembly contacts.
const TOLERANCE = 1e-8;
type Box = { center: Vec3; axes: [Vec3, Vec3, Vec3]; half: Vec3; obb: OBB };

function memberBoxes(design: Design, member: Member): Box[] {
  const frame = boardAxes(design, member);
  const axes: Box["axes"] = [frame.x, cross3(frame.normal, frame.x), frame.normal];
  const { boardWidth: width, thickness, tenonSize, tenonLength, holeSize } = design.geometry;
  const origin =
    member.kind === "female"
      ? add3(frame.start, scale3(frame.normal, (member.layer + 0.5) * thickness))
      : frame.start;
  const boxes: Box[] = [];
  const box = (lo: Vec3, hi: Vec3) => {
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
    boxes.push({ center, axes, half, obb });
  };
  if (member.kind === "male") {
    box([0, -width / 2, -thickness / 2], [frame.length, width / 2, thickness / 2]);
    for (const start of [-tenonLength, frame.length])
      box([start, -tenonSize / 2, -tenonSize / 2], [start + tenonLength, tenonSize / 2, tenonSize / 2]);
  } else {
    // Exact solid decomposition of the rendered board, excluding every square through hole.
    const left = -width * 0.7;
    const right = frame.length + width * 0.7;
    box([left, -width / 2, -thickness / 2], [right, -holeSize / 2, thickness / 2]);
    box([left, holeSize / 2, -thickness / 2], [right, width / 2, thickness / 2]);
    let cursor = left;
    for (let i = 0; i < member.holeCount; i++) {
      const center = (frame.length * i) / (member.holeCount - 1);
      box([cursor, -holeSize / 2, -thickness / 2], [center - holeSize / 2, holeSize / 2, thickness / 2]);
      cursor = center + holeSize / 2;
    }
    box([cursor, -holeSize / 2, -thickness / 2], [right, holeSize / 2, thickness / 2]);
  }
  return boxes;
}

export function validateMemberCollisions(design: Design): void {
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
      if (
        a.bounds.some(
          (range, axis) =>
            range[1] <= b.bounds[axis][0] + TOLERANCE || b.bounds[axis][1] <= range[0] + TOLERANCE,
        )
      )
        continue;
      if (a.boxes.some((x) => b.boxes.some((y) => x.obb.intersectsOBB(y.obb))))
        throw new Error(
          `部材 ${a.member.id} と ${b.member.id} が干渉しています。位置・向き・重ね段を変更してください`,
        );
    }
  }
}

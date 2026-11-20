import { HITOTO_PARTS } from "./catalog";
import type { Design, Member, Vec3 } from "./design";
import { AXIS_DIRECTIONS, type AxisDirection, nextId, placeBoard } from "./editor";
import { add3, cross3, dot3, scale3, sub3, unit3 } from "./holes";

export type TemplateShape = "square" | "triangle";
export type TemplateRequest = {
  shape: TemplateShape;
  /** One or two parallel male members to build from. */
  males: string[];
  /** Used with one male: where the second male goes, perpendicular to the first. */
  direction?: AxisDirection;
  /** Used with one male: distance to the second male (dimensionless). */
  size?: number;
  /** Drawing catalog only: end shape of the female boards (square 角 or round 丸). Defaults to square. */
  femaleEnd?: "square" | "round";
  /** Triangle only: which side of the first two males the apex male goes. */
  side?: 1 | -1;
};
type Corner = { start: string; end: string };

const position = (design: Design, id: string) => {
  const node = design.nodes.find((n) => n.id === id);
  if (!node) throw new Error("節点がありません");
  return node.position;
};
function male(design: Design, id: string) {
  const member = design.members.find((m) => m.id === id);
  if (member?.kind !== "male") throw new Error("テンプレートの起点には雄材を選んでください");
  return member;
}
function shaft(design: Design, member: Member) {
  return unit3(sub3(position(design, member.end), position(design, member.start)));
}
const nearly = (a: Vec3, b: Vec3) => Math.hypot(...sub3(a, b)) < 1e-6;

/** Unit directions perpendicular to the male shaft, offered for one-male templates. */
export function templateDirections(design: Design, maleId: string): AxisDirection[] {
  const axis = shaft(design, male(design, maleId));
  return (Object.keys(AXIS_DIRECTIONS) as AxisDirection[]).filter(
    (d) => Math.abs(dot3(axis, [...AXIS_DIRECTIONS[d]])) < 1e-6,
  );
}

/** Pairs the ends of two parallel males so that both pairs are offset by the same vector. */
function pairEnds(design: Design, a: Member, b: Member): Corner {
  const axis = shaft(design, a);
  if (Math.abs(Math.abs(dot3(axis, shaft(design, b))) - 1) > 1e-6)
    throw new Error("2本の雄材は平行にしてください");
  for (const [start, end] of [
    [b.start, b.end],
    [b.end, b.start],
  ]) {
    const offset = sub3(position(design, start), position(design, a.start));
    if (!nearly(sub3(position(design, end), position(design, a.end)), offset)) continue;
    if (Math.abs(dot3(offset, axis)) > 1e-6)
      throw new Error("2本の雄材の端がそろっていません。軸方向にずれていない2本を選んでください");
    if (Math.hypot(...offset) < 0.2) throw new Error("2本の雄材が近すぎます");
    return { start, end };
  }
  throw new Error("2本の雄材の長さが違います。同じ長さで平行な2本を選んでください");
}

/** Roll that turns a female board between two tenon nodes so the male shaft passes through its holes. */
export function rollFacing(start: Vec3, end: Vec3, axis: Vec3) {
  const x = unit3(sub3(end, start));
  const y = unit3(cross3(Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], x));
  const z = cross3(x, y);
  // boardAxes(): normal = z cos(r) − y sin(r); choose r so that the normal is parallel to the shaft.
  const degrees = (Math.atan2(-dot3(axis, y), dot3(axis, z)) * 180) / Math.PI;
  return Math.round(degrees * 1e6) / 1e6;
}

function addNode(design: Design, at: Vec3) {
  const existing = design.nodes.find((n) => nearly(n.position, at));
  if (existing) return existing.id;
  const id = nextId(design, "n");
  design.nodes.push({ id, position: at.map((v) => Math.round(v * 1e6) / 1e6) as Vec3, fixed: false });
  return id;
}
const joins = (m: Member, a: string, b: string) =>
  (m.start === a && m.end === b) || (m.start === b && m.end === a);
/** Adds a male along a corner, or returns null when a male already stands there (closing a loop). */
function addMale(design: Design, like: Member, corner: Corner) {
  const existing = design.members.find((m) => joins(m, corner.start, corner.end));
  if (existing) {
    if (existing.kind !== "male") throw new Error("テンプレートの雄材の位置に雌材があります");
    return null;
  }
  const id = nextId(design, "m");
  design.members.push({ ...like, id, start: corner.start, end: corner.end, layer: 0, holeCount: 2 });
  return id;
}
/** Adds a board between two tenons. With `share`, returns null instead when one already joins them. */
function addFemale(
  design: Design,
  a: string,
  b: string,
  axis: Vec3,
  share: boolean,
  shape: "square" | "round" = "square",
) {
  if (share && design.members.some((m) => m.kind === "female" && joins(m, a, b))) return null;
  const start = position(design, a);
  const end = position(design, b);
  const length = Math.hypot(...sub3(end, start));
  const part =
    design.version === 6
      ? HITOTO_PARTS.find((p) => p.kind === "female" && p.end === shape && Math.abs(p.span - length) < 1e-6)
      : undefined;
  if (design.version === 6 && !part)
    throw new Error("テンプレートの大きさを図面の雌材の穴中心間距離に合わせてください");
  const id = nextId(design, "m");
  const board: Member = {
    id,
    kind: "female",
    start: a,
    end: b,
    material: design.materials[0].id,
    roll: rollFacing(start, end, axis),
    layer: 0,
    holeCount:
      part?.holes.length ??
      Math.max(2, Math.min(7, Math.floor(length / (design.geometry.holeSize * 1.5)) + 1)),
    ...(part ? { catalogId: part.id } : {}),
  };
  placeBoard(design, board);
  return id;
}

/**
 * Adds a square (two males, two females per end pair) or triangular prism section (three males,
 * females joining every pair) to the design in place. Males (and, except for a square between two
 * picked males, boards) that already stand where the template puts them are reused, so templates can
 * share males and close loops. Each board takes the innermost free layer it fits in. Returns the
 * members it created.
 */
export function addTemplate(design: Design, request: TemplateRequest) {
  const first = male(design, request.males[0] ?? "");
  const axis = shaft(design, first);
  const base: Corner = { start: first.start, end: first.end };
  const created: string[] = [];
  let second: Corner;
  if (request.males.length >= 2) {
    second = pairEnds(design, first, male(design, request.males[1]));
  } else {
    const direction = request.direction;
    const size = request.size ?? 1;
    if (!direction || !templateDirections(design, first.id).includes(direction))
      throw new Error("雄材に垂直な向きを選んでください");
    if (!Number.isFinite(size) || size < 0.2 || size > 4) throw new Error("大きさの比は0.2〜4です");
    const offset = scale3([...AXIS_DIRECTIONS[direction]], size);
    second = {
      start: addNode(design, add3(position(design, base.start), offset)),
      end: addNode(design, add3(position(design, base.end), offset)),
    };
    const added = addMale(design, first, second);
    if (added) created.push(added);
  }
  const corners = [base, second];
  if (request.shape === "triangle") {
    const width = sub3(position(design, second.start), position(design, base.start));
    const across = scale3(unit3(cross3(axis, width)), request.side ?? 1);
    const apex = add3(scale3(width, 0.5), scale3(across, (Math.sqrt(3) / 2) * Math.hypot(...width)));
    const third = {
      start: addNode(design, add3(position(design, base.start), apex)),
      end: addNode(design, add3(position(design, base.end), apex)),
    };
    const added = addMale(design, first, third);
    if (added) created.push(added);
    corners.push(third);
  }
  const pairs =
    request.shape === "triangle"
      ? [
          [0, 1],
          [1, 2],
          [2, 0],
        ]
      : [[0, 1]];
  // A square between two picked males always adds a pair (it doubles boards that are already there);
  // otherwise boards the template would put where one already stands are shared.
  const share = !(request.shape === "square" && request.males.length >= 2);
  for (const [i, j] of pairs)
    for (const end of ["start", "end"] as const) {
      const added = addFemale(design, corners[i][end], corners[j][end], axis, share, request.femaleEnd);
      if (added) created.push(added);
    }
  if (!created.length) throw new Error("この位置には既に同じ形の部材があります");
  return { created };
}

/** Direction of the triangle apex for side = 1, perpendicular to the shafts and the base width. */
export function apexDirection(design: Design, request: TemplateRequest): Vec3 {
  const first = male(design, request.males[0] ?? "");
  const axis = shaft(design, first);
  let width: Vec3;
  if (request.males.length >= 2) {
    const second = pairEnds(design, first, male(design, request.males[1]));
    width = sub3(position(design, second.start), position(design, first.start));
  } else {
    if (!request.direction) throw new Error("雄材に垂直な向きを選んでください");
    width = [...AXIS_DIRECTIONS[request.direction]];
  }
  return unit3(cross3(axis, width));
}

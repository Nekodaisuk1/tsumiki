import { type CatalogPart, catalogPart, HITOTO_GEOMETRY, HITOTO_PARTS } from "./catalog";
import { validateMemberCollisions } from "./collision";
import { createDesign, type Design, type Member, parseDesign, serializeDesign, type Vec3 } from "./design";
import { boardAxes, dot3, insertionPreview, matchingShaftHoles, scale3, sub3, unit3 } from "./holes";
import { freeLayers, nextOuterLayer } from "./seats";
import { rollFacing } from "./templates";
export function nextId(design: Design, prefix: string) {
  const ids = new Set(
    [
      ...design.nodes,
      ...design.members,
      ...design.ropes,
      ...design.rings,
      ...design.materials,
      ...design.connections,
    ].map((v) => v.id),
  );
  let n = 0;
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
export function appendMember(
  design: Design,
  nodeId: string,
  kind: "male" | "female",
  direction: Vec3,
  length: number,
  catalogId?: string,
) {
  const part =
    design.version === 6
      ? catalogPart(
          catalogId ??
            HITOTO_PARTS.find((p) => p.kind === kind && Math.abs(p.span - length) < 1e-6)?.id ??
            "",
        )
      : undefined;
  if (!Number.isFinite(length) || length < (design.version === 6 ? 0.001 : 0.2) || length > 4)
    throw new Error("追加する長さ比は0.2〜4です");
  const start = design.nodes.find((n) => n.id === nodeId);
  if (!start) throw new Error("始点を選択してください");
  const position = start.position.map((v, i) => Math.round((v + direction[i] * length) * 1e6) / 1e6) as Vec3;
  let end = design.nodes.find((n) => Math.hypot(...n.position.map((v, i) => v - position[i])) < 1e-6);
  if (!end) {
    end = { id: nextId(design, "n"), position, fixed: false };
    design.nodes.push(end);
  }
  const memberId = nextId(design, "m");
  const member: Member = {
    id: memberId,
    kind,
    start: start.id,
    end: end.id,
    material: design.materials[0].id,
    roll: kind === "female" ? boardRoll(design, start.id, end.id) : 0,
    layer: 0,
    holeCount:
      (part ? part.holes.length || 2 : undefined) ??
      Math.max(2, Math.min(7, Math.floor(length / (design.geometry.holeSize * 1.5)) + 1)),
    ...(part ? { catalogId: part.id } : {}),
  };
  if (kind === "female") placeBoard(design, member);
  else design.members.push(member);
  return { memberId, nodeId: end.id };
}
/**
 * Roll for a new female board between two nodes: it faces the shaft of a male standing on either node so
 * the tenon passes through its holes. With no male there yet, the board lies flat (roll 90).
 */
export function boardRoll(design: Design, startId: string, endId: string) {
  const male = design.members.find(
    (m) => m.kind === "male" && [m.start, m.end].some((n) => n === startId || n === endId),
  );
  const at = (id: string | undefined) => design.nodes.find((n) => n.id === id)?.position;
  const [a, b, s, e] = [at(male?.start), at(male?.end), at(startId), at(endId)];
  if (!a || !b || !s || !e) return 90;
  return rollFacing(s, e, sub3(b, a));
}
/**
 * Adds a female board on the innermost layer that is free on both of its tenons and that it actually
 * fits in: a seat free in the bookkeeping can still be blocked by a long neighbouring board lying in the
 * same plane. Records the tenon holes it is stacked on. The board's own `layer` is ignored.
 */
export function placeBoard(design: Design, board: Member) {
  let collision: unknown;
  for (const layer of freeLayers(design, [board.start, board.end])) {
    const joints = design.connections.length;
    design.members.push({ ...board, layer });
    recordTenonHoles(design, board.id, [board.start, board.end]);
    try {
      validateMemberCollisions(design);
      return layer;
    } catch (error) {
      collision = error;
      design.members.pop();
      design.connections.length = joints;
    }
  }
  throw collision;
}
/** Unit shaft directions of the males standing on a node. */
function shaftsAt(design: Design, nodeId: string): Vec3[] {
  const at = (id: string) => design.nodes.find((n) => n.id === id)?.position;
  return design.members
    .filter((m) => m.kind === "male" && (m.start === nodeId || m.end === nodeId))
    .flatMap((m) => {
      const a = at(m.start);
      const b = at(m.end);
      return a && b ? [unit3(sub3(b, a))] : [];
    });
}
/** Regular (not dense) female catalog parts with the given end shape, shortest first. */
function femaleSizes(end: CatalogPart["end"]) {
  return HITOTO_PARTS.filter((p) => p.kind === "female" && p.end === end && !p.id.endsWith("-dense")).sort(
    (a, b) => a.span - b.span,
  );
}
function matchingFemalePart(length: number, preferred?: string) {
  const wanted = preferred ? catalogPart(preferred) : undefined;
  if (wanted && Math.abs(wanted.span - length) < 1e-6) return wanted;
  return femaleSizes(wanted?.end ?? "square").find((p) => Math.abs(p.span - length) < 1e-6);
}
/**
 * Switches an existing drawing female between the square (角) and round (丸) end of the same size. Span
 * and holes stay; only the end outline changes, so the result is checked for collisions. Returns the part.
 */
export function toggleBoardEnd(design: Design, memberId: string): CatalogPart {
  const board = design.members.find((m) => m.id === memberId);
  if (board?.kind !== "female") throw new Error("切り替える雌材を選んでください");
  if (design.version !== 6 || !board.catalogId) throw new Error("角・丸の切り替えは図面規格の雌材で使えます");
  const next = catalogPart(
    board.catalogId.includes("-square")
      ? board.catalogId.replace("-square", "-round")
      : board.catalogId.replace("-round", "-square"),
  );
  board.catalogId = next.id;
  validateMemberCollisions(design, new Set([memberId]));
  return next;
}
/** The female drawing part one size shorter (−1) or longer (+1) with the same end shape. */
export function nextFemaleSize(catalogId: string, step: 1 | -1): CatalogPart {
  const current = catalogPart(catalogId);
  if (current.kind !== "female") throw new Error("雌材の規格を選んでください");
  const sizes = femaleSizes(current.end);
  const index = sizes.findIndex((p) => Math.abs(p.span - current.span) < 1e-6);
  const next = sizes[index + step];
  if (index < 0 || !next)
    throw new Error(step > 0 ? "これより長い規格はありません" : "これより短い規格はありません");
  return next;
}
/**
 * Drawing part for a board spanning `length`. The preferred part wins when its span fits; otherwise the
 * regular part of the same end shape. Throws with the nearest sizes when no drawing part fits.
 */
export function femalePartForSpan(length: number, preferred?: string): CatalogPart {
  const part = matchingFemalePart(length, preferred);
  if (part) return part;
  const sizes = femaleSizes(preferred ? catalogPart(preferred).end : "square");
  const near = [...sizes].sort((a, b) => Math.abs(a.span - length) - Math.abs(b.span - length)).slice(0, 2);
  throw new Error(
    `2点の間隔 ${Math.round(length * 1000 * 10) / 10}mm に合う雌材の規格がありません（近い規格：${near
      .map((p) => `${p.label} ${Math.round(p.span * 10000) / 10}mm`)
      .join("・")}）`,
  );
}
/**
 * Adds a female board straight between two existing nodes, e.g. a diagonal brace. The board must be
 * perpendicular to the males on both nodes; in drawing designs its span must match a catalog part.
 * It goes on the innermost free layer that does not collide (see `placeBoard`).
 */
export function connectBoard(design: Design, startId: string, endId: string, preferred?: string) {
  if (startId === endId) throw new Error("異なる2節点を選んでください");
  const a = design.nodes.find((n) => n.id === startId)?.position;
  const b = design.nodes.find((n) => n.id === endId)?.position;
  if (!a || !b) throw new Error("節点がありません");
  if (design.members.some((m) => m.kind === "male" && joinsNodes(m, startId, endId)))
    throw new Error("この2節点は雄材でつながっています");
  const length = Math.hypot(...sub3(b, a));
  const direction = scale3(sub3(b, a), 1 / length);
  const shafts = [...shaftsAt(design, startId), ...shaftsAt(design, endId)];
  if (shafts.some((s) => Math.abs(dot3(s, direction)) > 1e-6))
    throw new Error("板は雄材の角棒に垂直に付けます。角棒に垂直な面の中にある節点を選んでください");
  if (shafts.some((s) => Math.abs(Math.abs(dot3(s, shafts[0])) - 1) > 1e-6))
    throw new Error("両端の雄材が平行ではありません");
  const part = design.version === 6 ? femalePartForSpan(length, preferred) : undefined;
  if (!part && (length < 0.2 || length > 4)) throw new Error("雌材の長さ比は0.2〜4です");
  const member: Member = {
    id: nextId(design, "m"),
    kind: "female",
    start: startId,
    end: endId,
    material: design.materials[0].id,
    roll: boardRoll(design, startId, endId),
    layer: 0,
    holeCount: part
      ? part.holes.length
      : Math.max(2, Math.min(7, Math.floor(length / (design.geometry.holeSize * 1.5)) + 1)),
    ...(part ? { catalogId: part.id } : {}),
  };
  placeBoard(design, member);
  return member.id;
}
const joinsNodes = (m: Member, a: string, b: string) =>
  (m.start === a && m.end === b) || (m.start === b && m.end === a);
export type BraceTarget = { node: string; length: number; label: string; diagonal: boolean };
/**
 * Nodes a new board from `nodeId` can reach exactly: in the plane perpendicular to the male there, not yet
 * joined by a board, matching a drawing span (any length 0.2–4 in legacy designs) and free of collisions.
 */
export function braceTargets(design: Design, nodeId: string, preferred?: string): BraceTarget[] {
  const anchor = design.nodes.find((n) => n.id === nodeId);
  if (!anchor) return [];
  const result: BraceTarget[] = [];
  for (const node of design.nodes) {
    if (node.id === nodeId) continue;
    if (design.members.some((m) => joinsNodes(m, nodeId, node.id))) continue;
    const offset = sub3(node.position, anchor.position);
    const length = Math.hypot(...offset);
    if (length < 1e-6) continue;
    let label = "";
    if (design.version === 6) {
      const part = matchingFemalePart(length, preferred);
      if (!part) continue;
      label = part.label;
    } else if (length < 0.2 || length > 4) continue;
    const shafts = [...shaftsAt(design, nodeId), ...shaftsAt(design, node.id)];
    if (shafts.some((s) => Math.abs(dot3(s, offset)) > 1e-6 * length)) continue;
    const draft = structuredClone(design);
    try {
      connectBoard(draft, nodeId, node.id, preferred);
    } catch {
      // A board that would collide or cannot sit on the tenons is not offered.
      continue;
    }
    const axes = offset.filter((v) => Math.abs(v) > 1e-6).length;
    result.push({ node: node.id, length: Math.round(length * 1e6) / 1e6, label, diagonal: axes > 1 });
  }
  return result.sort((x, y) => Number(y.diagonal) - Number(x.diagonal) || x.length - y.length);
}
/**
 * Shortens (−1) or extends (+1) a drawing-catalog female by one catalog size of the same end shape. One end
 * stays on its tenon: the end shared with other members, otherwise the start (`moveStart` flips that).
 * The moving end leaves the members it shared and joins a node it lands on exactly. Returns the new part.
 */
export function resizeBoard(design: Design, memberId: string, step: 1 | -1, moveStart = false) {
  const board = design.members.find((m) => m.id === memberId);
  if (board?.kind !== "female") throw new Error("伸縮する雌材を選んでください");
  if (design.version !== 6 || !board.catalogId)
    throw new Error("規格ごとの伸縮は図面規格の雌材で使えます。旧モデルでは節点を動かしてください");
  const next = nextFemaleSize(board.catalogId, step);
  const shared = (id: string) =>
    design.members.some((m) => m.id !== memberId && (m.start === id || m.end === id));
  let moving: "start" | "end" = shared(board.end) && !shared(board.start) ? "start" : "end";
  if (moveStart) moving = moving === "start" ? "end" : "start";
  const fixedId = moving === "start" ? board.end : board.start;
  const movingId = board[moving];
  const fixed = design.nodes.find((n) => n.id === fixedId)?.position;
  const old = design.nodes.find((n) => n.id === movingId);
  if (!fixed || !old) throw new Error("部材の節点がありません");
  const sides = boardSides(design);
  const direction = unit3(sub3(old.position, fixed));
  const position = fixed.map((v, i) => Math.round((v + direction[i] * next.span) * 1e6) / 1e6) as Vec3;
  const landing = design.nodes.find(
    (n) => n.id !== movingId && Math.hypot(...sub3(n.position, position)) < 1e-6,
  );
  if (landing) {
    board[moving] = landing.id;
    if (!shared(movingId)) design.nodes = design.nodes.filter((n) => n.id !== movingId);
  } else if (shared(movingId)) {
    const id = nextId(design, "n");
    design.nodes.push({ id, position, fixed: false });
    board[moving] = id;
  } else old.position = position;
  board.catalogId = next.id;
  board.holeCount = next.holes.length;
  keepBoardSides(design, sides);
  rematchInsertedMales(design);
  validateMemberCollisions(design);
  return next;
}
/**
 * A male that already uses explicit hole connections is validated against every hole its tenons pass
 * through, so a female board stacked on such a tenon must be recorded as a hole connection as well.
 * Males from the node-shared template keep their implicit end connections.
 */
export function recordTenonHoles(design: Design, femaleId: string, nodeIds: string[]) {
  for (const male of design.members) {
    if (male.kind !== "male" || !nodeIds.some((id) => male.start === id || male.end === id)) continue;
    if (!design.connections.some((c) => c.male === male.id)) continue;
    const start = design.nodes.find((n) => n.id === male.start);
    const end = design.nodes.find((n) => n.id === male.end);
    if (!start || !end) continue;
    for (const hole of matchingShaftHoles(design, start.position, end.position, male.id))
      if (hole.female === femaleId)
        design.connections.push({ id: nextId(design, "joint"), male: male.id, ...hole });
  }
}
export function extendBay(design: Design, depth: number) {
  if (design.version === 6)
    throw new Error("図面規格では部材を選んで追加してください。任意寸法の枠生成は旧仮定モデル専用です");
  if (!Number.isFinite(depth) || depth < 0.4 || depth > 4) throw new Error("奥行の比は0.4〜4です");
  const z = Math.max(...design.nodes.map((n) => n.position[2]));
  const face = design.nodes.filter((n) => Math.abs(n.position[2] - z) < 1e-6);
  if (face.length !== 4) throw new Error("奥への区画追加は、最奥面が4節点の枠で使用できます");
  const mapping = new Map<string, string>();
  const memberMapping = new Map<string, string>();
  const faceMembers = design.members.filter(
    (m) => face.some((n) => n.id === m.start) && face.some((n) => n.id === m.end),
  );
  const faceRopes = design.ropes.filter((r) => r.route.every((id) => face.some((n) => n.id === id)));
  for (const node of face) {
    const id = nextId(design, "n");
    mapping.set(node.id, id);
    design.nodes.push({ id, position: [node.position[0], node.position[1], z + depth], fixed: node.fixed });
  }
  for (const member of faceMembers) {
    const id = nextId(design, "m");
    memberMapping.set(member.id, id);
    design.members.push({
      ...member,
      id,
      start: mapping.get(member.start) as string,
      end: mapping.get(member.end) as string,
    });
  }
  for (const node of face) {
    const layer = nextOuterLayer(design, [node.id, mapping.get(node.id) as string]);
    design.members.push({
      id: nextId(design, "m"),
      kind: "female",
      start: node.id,
      end: mapping.get(node.id) as string,
      material: design.materials[0].id,
      roll: 90,
      layer,
      holeCount: Math.max(2, Math.min(7, Math.floor(depth / (design.geometry.holeSize * 1.5)) + 1)),
    });
  }
  for (const rope of faceRopes)
    design.ropes.push({
      ...rope,
      id: nextId(design, "r"),
      route: rope.route.map((id) => mapping.get(id) as string) as [string, string, string, string],
      windingMember: memberMapping.get(rope.windingMember) as string,
    });
}
export class DesignHistory {
  private undoList: string[] = [];
  private redoList: string[] = [];
  get canUndo() {
    return this.undoList.length > 0;
  }
  get canRedo() {
    return this.redoList.length > 0;
  }
  push(before: Design, after: Design) {
    const value = serializeDesign(before);
    if (value === serializeDesign(after)) return;
    this.undoList.push(value);
    if (this.undoList.length > 80) this.undoList.shift();
    this.redoList = [];
  }
  undo(current: Design): Design {
    const value = this.undoList.at(-1);
    if (!value) throw new Error("元に戻せる操作がありません");
    const restored = parseDesign(value);
    this.undoList.pop();
    this.redoList.push(serializeDesign(current));
    return restored;
  }
  redo(current: Design): Design {
    const value = this.redoList.at(-1);
    if (!value) throw new Error("やり直せる操作がありません");
    const restored = parseDesign(value);
    this.redoList.pop();
    this.undoList.push(serializeDesign(current));
    return restored;
  }
}

export function insertMaleAtHole(design: Design, female: string, hole: number, length: number, side: 1 | -1) {
  const part =
    design.version === 6
      ? HITOTO_PARTS.find((p) => p.kind === "male" && Math.abs(p.span - length) < 1e-6)
      : undefined;
  if (design.version === 6 && !part) throw new Error("図面の雄材規格を選んでください");
  const preview = insertionPreview(design, female, hole, length, side);
  const startId = nextId(design, "n");
  design.nodes.push({ id: startId, position: preview.start, fixed: false });
  const endId = nextId(design, "n");
  design.nodes.push({ id: endId, position: preview.end, fixed: false });
  const memberId = nextId(design, "m");
  design.members.push({
    id: memberId,
    kind: "male",
    start: startId,
    end: endId,
    material: design.materials[0].id,
    roll: 0,
    layer: 0,
    holeCount: 2,
    ...(part ? { catalogId: part.id } : {}),
  });
  for (const connection of preview.connections)
    design.connections.push({ id: nextId(design, "joint"), male: memberId, ...connection });
  return { memberId, nodeId: endId, connected: preview.connections.length };
}

/**
 * Smallest valid design to build from: one female board with both ends supported.
 * The board is placed at roll 0 (standing upright, front face toward +Z).
 */
export function createSeedDesign(length = 1.4): Design {
  const design = createDesign();
  design.name = "新しい設計";
  design.notes = "";
  design.nodes = [
    { id: "n0", position: [0, 0, 0], fixed: true },
    { id: "n1", position: [length, 0, 0], fixed: true },
  ];
  design.members = [
    {
      id: "m0",
      kind: "female",
      start: "n0",
      end: "n1",
      material: design.materials[0].id,
      roll: 0,
      layer: 0,
      holeCount: Math.max(2, Math.min(7, Math.floor(length / (design.geometry.holeSize * 1.5)) + 1)),
    },
  ];
  design.ropes = [];
  design.rings = [];
  design.connections = [];
  design.analysis.loadNode = "n1";
  return parseDesign(serializeDesign(design));
}

export const AXIS_DIRECTIONS = {
  x: [1, 0, 0],
  "-x": [-1, 0, 0],
  y: [0, 1, 0],
  "-y": [0, -1, 0],
  z: [0, 0, 1],
  "-z": [0, 0, -1],
} as const satisfies Record<string, Vec3>;
export type AxisDirection = keyof typeof AXIS_DIRECTIONS;
export type FemaleDirectionOption = {
  direction: AxisDirection;
  /** Why a female board cannot leave the anchor in this direction, if it cannot. */
  blocked?: string;
  /** Nearest existing node straight ahead, used to snap the board length. */
  target?: { node: string; length: number };
};

/** Directions a female board can take from a node, with the node it would reach if any. */
export function femaleDirections(design: Design, nodeId: string): FemaleDirectionOption[] {
  const anchor = design.nodes.find((n) => n.id === nodeId);
  if (!anchor) throw new Error("起点の節点を選んでください");
  const point = (id: string) => design.nodes.find((n) => n.id === id)?.position;
  const shafts = design.members
    .filter((m) => m.kind === "male" && (m.start === nodeId || m.end === nodeId))
    .map((m) => {
      const a = point(m.start);
      const b = point(m.end);
      if (!a || !b) return null;
      const v = b.map((x, i) => x - a[i]);
      const length = Math.hypot(...v);
      return length > 0 ? v.map((x) => x / length) : null;
    })
    .filter((v): v is number[] => v !== null);
  return (Object.keys(AXIS_DIRECTIONS) as AxisDirection[]).map((direction) => {
    const d = AXIS_DIRECTIONS[direction];
    if (shafts.some((s) => Math.abs(s[0] * d[0] + s[1] * d[1] + s[2] * d[2]) > 1 - 1e-6))
      return { direction, blocked: "雄材の角棒と同じ向きです。板は角棒に垂直に付けます" };
    let target: FemaleDirectionOption["target"];
    for (const node of design.nodes) {
      if (node.id === nodeId) continue;
      const offset = node.position.map((x, i) => x - anchor.position[i]);
      const along = offset[0] * d[0] + offset[1] * d[1] + offset[2] * d[2];
      if (along < 0.2 - 1e-9 || along > 4 + 1e-9) continue;
      const side = Math.hypot(...offset.map((x, i) => x - along * d[i]));
      if (side > 1e-6) continue;
      if (!target || along < target.length) target = { node: node.id, length: Math.round(along * 1e6) / 1e6 };
    }
    return target ? { direction, target } : { direction };
  });
}

/** Starts a drawing-based design without inventing connections or changing legacy files. */
export function createDrawingDesign(catalogId = "female-2400-square"): Design {
  const part = catalogPart(catalogId);
  const design = createDesign();
  design.version = 6;
  design.name = `hitoto ${part.label}`;
  design.notes =
    "hitoto_buzai_zumen.pdf準拠。形状1単位=1000mm。凸部は角丸30mm角（ユーザー確認）、凸部R6.3mmは仮定。雌材の面取り6.3Rは未再現。材料・荷重・時間は未校正。";
  design.geometry = { ...HITOTO_GEOMETRY };
  // The old clearance law describes square holes; never silently reuse it for circular holes.
  design.jointModel = "rigid-approximation";
  design.nodes = [
    { id: "n0", position: [0, 0, 0], fixed: true },
    { id: "n1", position: [part.span, 0, 0], fixed: true },
  ];
  design.members = [
    {
      id: "m0",
      kind: part.kind,
      start: "n0",
      end: "n1",
      material: "wood",
      roll: 0,
      layer: 0,
      holeCount: part.holes.length || 2,
      catalogId,
    },
  ];
  design.ropes = [];
  design.rings = [];
  design.connections = [];
  design.analysis.loadNode = "n1";
  return parseDesign(serializeDesign(design));
}

/**
 * Re-records the holes every inserted male passes through (males with hole connections, plus `alsoMale`).
 * Used after an edit moves boards or tenons so the recorded joints match the geometry again.
 */
export function rematchInsertedMales(design: Design, alsoMale?: string) {
  const males = design.members.filter(
    (m) => m.kind === "male" && (m.id === alsoMale || design.connections.some((c) => c.male === m.id)),
  );
  design.connections = design.connections.filter((c) => !males.some((m) => m.id === c.male));
  for (const male of males) {
    const start = design.nodes.find((n) => n.id === male.start);
    const end = design.nodes.find((n) => n.id === male.end);
    if (!start || !end) continue;
    for (const hole of matchingShaftHoles(design, start.position, end.position, male.id))
      design.connections.push({ id: nextId(design, "joint"), male: male.id, ...hole });
  }
}

/** Board normals, to restore with `keepBoardSides` after an edit that changes which male hosts a board. */
export function boardSides(design: Design) {
  return new Map(
    design.members.filter((m) => m.kind === "female").map((m) => [m.id, boardAxes(design, m).normal]),
  );
}
/**
 * A board's facing side follows the male it sits on. When that male is removed or detached the board
 * would flip to the other side of its tenon; turn it by 180° so it stays where it was.
 */
export function keepBoardSides(design: Design, before: ReturnType<typeof boardSides>) {
  for (const member of design.members) {
    const normal = before.get(member.id);
    if (!normal || member.kind !== "female") continue;
    if (dot3(boardAxes(design, member).normal, normal) < 0)
      member.roll = member.roll > 0 ? member.roll - 180 : member.roll + 180;
  }
}

/**
 * Removes a member with everything that depends on it: its rings, ropes that use it, its hole connections
 * and nodes nothing else uses. The last member cannot be removed (a design always has one).
 */
export function removeMember(design: Design, memberId: string) {
  const removed = design.members.find((m) => m.id === memberId);
  if (!removed) throw new Error("部材がありません");
  if (design.members.length === 1)
    throw new Error(
      "最後の1本は削除できません。別の部材を置いてから削除するか、「＋ 新規」で始める部材を選び直してください",
    );
  const sides = boardSides(design);
  design.members = design.members.filter((m) => m.id !== memberId);
  keepBoardSides(design, sides);
  design.rings = design.rings.filter((r) => r.member !== memberId);
  design.connections = design.connections.filter((c) => c.male !== memberId && c.female !== memberId);
  design.ropes = design.ropes.filter(
    (r) =>
      r.windingMember !== memberId &&
      [r.route[1], r.route[2]].sort().join(":") !== [removed.start, removed.end].sort().join(":"),
  );
  const used = new Set([
    ...design.members.flatMap((m) => [m.start, m.end]),
    ...design.ropes.flatMap((r) => r.route),
  ]);
  design.nodes = design.nodes.filter(
    (n) => used.has(n.id) || (n.id !== removed.start && n.id !== removed.end),
  );
  if (!design.nodes.some((n) => n.id === design.analysis.loadNode)) {
    const free =
      design.nodes.find((n) => !n.fixed && used.has(n.id)) ?? design.nodes.find((n) => used.has(n.id));
    if (!free) throw new Error("荷重点に使える節点が残りません");
    design.analysis.loadNode = free.id;
  }
  // Removing a board frees its holes; removing a male can leave others' joints unchanged.
  rematchInsertedMales(design);
}

/**
 * Moves a female board one seat outward (+1) or inward (−1) by exchanging the two seats. A board spans two
 * tenons, so every board in those two seats that is linked to it through shared tenons swaps as well;
 * otherwise the far end of a neighbour would collide. Rings in the two seats on those tenons swap too.
 * Seats 0–3 hold boards; the outermost one is kept for ropes. Returns the boards that changed seat.
 */
export function shiftLayer(design: Design, femaleId: string, delta: 1 | -1): string[] {
  const female = design.members.find((m) => m.id === femaleId);
  if (female?.kind !== "female") throw new Error("重ね順を変える雌材を選んでください");
  const from = female.layer;
  const to = from + delta;
  if (to < 0 || to > 3)
    throw new Error(delta > 0 ? "これより外側の段はロープ用です" : "これより内側の段はありません");
  const pair = (layer: number) => layer === from || layer === to;
  const group = new Set([female]);
  const queue = [female];
  while (queue.length) {
    const current = queue.pop();
    if (!current) break;
    for (const other of design.members)
      if (
        !group.has(other) &&
        other.kind === "female" &&
        pair(other.layer) &&
        [other.start, other.end].some((n) => n === current.start || n === current.end)
      ) {
        group.add(other);
        queue.push(other);
      }
  }
  const nodes = new Set([...group].flatMap((m) => [m.start, m.end]));
  for (const ring of design.rings) {
    const host = design.members.find((m) => m.id === ring.member);
    if (host && pair(ring.slot) && nodes.has(host[ring.end])) ring.slot = ring.slot === from ? to : from;
  }
  for (const board of group) board.layer = board.layer === from ? to : from;
  rematchInsertedMales(design);
  return [...group].map((m) => m.id);
}

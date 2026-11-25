import { holeOffsets } from "./catalog";
import { validateMemberCollisions } from "./collision";
import type { Design, Member, Vec3 } from "./design";
import {
  boardSides,
  connectThreadedMales,
  keepBoardSides,
  nextId,
  placeBoard,
  rematchInsertedMales,
  removeMember,
} from "./editor";
import { add3, boardAxes, cross3, dot3, holeSite, scale3, sub3 } from "./holes";
import { nextOuterLayer } from "./seats";
import { rollFacing } from "./templates";

/**
 * What a move or rotation acts on.
 * - node: one node (the attached members stretch; drawing-catalog lengths usually reject this)
 * - member: one member on its own; nodes it shares with other members are split off
 * - group: the member plus everything joined to it through shared nodes or hole connections
 * - all: the whole structure
 * - set: several members picked together (`id` lists them, comma separated); like a single member,
 *   nodes they share with members outside the set are split off
 */
export type MoveTarget = "node" | "member" | "group" | "all" | "set";
/** A rigid motion: rotate by `angle` degrees about `axis` through `pivot`, then translate. */
export type Motion = { translate: Vec3; axis: Vec3; angle: number; pivot: Vec3 };

const EPS = 1e-6;
const round = (v: Vec3) => v.map((x) => Math.round(x * 1e6) / 1e6) as Vec3;
const same = (a: Vec3, b: Vec3) => Math.hypot(...sub3(a, b)) < EPS;

/** Members reached from `memberId` through shared nodes or recorded hole connections. */
export function connectedMembers(design: Design, memberId: string): string[] {
  const seen = new Set([memberId]);
  const queue = [memberId];
  while (queue.length) {
    const next = queue.pop();
    const current = design.members.find((m) => m.id === next);
    if (!current) continue;
    const linked = [
      ...design.members.filter((m) => [m.start, m.end].some((n) => n === current.start || n === current.end)),
      ...design.connections
        .filter((c) => c.male === current.id || c.female === current.id)
        .flatMap((c) => design.members.filter((m) => m.id === c.male || m.id === c.female)),
    ];
    for (const m of linked)
      if (!seen.has(m.id)) {
        seen.add(m.id);
        queue.push(m.id);
      }
  }
  return design.members.filter((m) => seen.has(m.id)).map((m) => m.id);
}

/** Members and nodes a target moves. `id` is a node id for "node" and a member id otherwise. */
export function targetParts(design: Design, target: MoveTarget, id: string) {
  if (target === "all")
    return { members: design.members.map((m) => m.id), nodes: design.nodes.map((n) => n.id) };
  if (target === "node")
    return { members: [] as string[], nodes: design.nodes.some((n) => n.id === id) ? [id] : [] };
  const members = target === "group" ? connectedMembers(design, id) : target === "set" ? id.split(",") : [id];
  const picked = design.members.filter((m) => members.includes(m.id));
  return { members: picked.map((m) => m.id), nodes: [...new Set(picked.flatMap((m) => [m.start, m.end]))] };
}

/** Centre of the bounding box of the given nodes. */
export function pivotOf(design: Design, nodeIds: string[]): Vec3 {
  const points = design.nodes.filter((n) => nodeIds.includes(n.id)).map((n) => n.position);
  if (!points.length) return [0, 0, 0];
  return round(
    [0, 1, 2].map((i) => {
      const values = points.map((p) => p[i]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    }) as Vec3,
  );
}

/** Rodrigues rotation of `v` by `angle` degrees about the unit `axis`. */
export function rotate3(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const t = (angle * Math.PI) / 180;
  const k = scale3(axis, 1 / Math.hypot(...axis));
  return add3(
    add3(scale3(v, Math.cos(t)), scale3(cross3(k, v), Math.sin(t))),
    scale3(k, dot3(k, v) * (1 - Math.cos(t))),
  );
}

function boardNormal(start: Vec3, end: Vec3, roll: number): Vec3 {
  const length = Math.hypot(...sub3(end, start));
  const x = scale3(sub3(end, start), 1 / length);
  const ref: Vec3 = Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const yRaw = cross3(ref, x);
  const y = scale3(yRaw, 1 / Math.hypot(...yRaw));
  const z = cross3(x, y);
  const angle = (roll * Math.PI) / 180;
  return add3(scale3(z, Math.cos(angle)), scale3(y, -Math.sin(angle)));
}

function replaceNode(design: Design, from: string, to: string) {
  for (const m of design.members) {
    if (m.start === from) m.start = to;
    if (m.end === from) m.end = to;
  }
  for (const r of design.ropes) r.route = r.route.map((n) => (n === from ? to : n)) as typeof r.route;
  if (design.analysis.loadNode === from) design.analysis.loadNode = to;
  design.nodes = design.nodes.filter((n) => n.id !== from);
}

/**
 * Moves and/or rotates a target rigidly, in place. Lengths and the relative board orientation inside
 * the target are kept, so drawing-catalog members stay valid. For a single member, shared nodes are
 * split off first; afterwards its ends join any node they land on exactly, and a male's tenons record
 * the holes they now pass through. Returns the node ids that moved (after splitting and joining).
 */
export function moveParts(
  design: Design,
  target: MoveTarget,
  id: string,
  motion: Motion,
): { nodes: string[]; droppedRopes: string[] } {
  const parts = targetParts(design, target, id);
  if (!parts.nodes.length) throw new Error("動かす対象を選んでください");
  const rotating = Math.abs(motion.angle) > 1e-9;
  if (rotating && target === "node")
    throw new Error("節点は回転できません。部材・つながり・全体を選んでください");
  const sides = boardSides(design);
  const moved = new Map<string, string>();
  const member = target === "member" ? design.members.find((m) => m.id === id) : undefined;
  // A single member or a picked set leaves the rest of the structure where it is.
  const detached = target === "member" || target === "set";
  const picked = design.members.filter((m) => parts.members.includes(m.id));
  for (const nodeId of parts.nodes) {
    const shared = design.members.some(
      (m) => !parts.members.includes(m.id) && (m.start === nodeId || m.end === nodeId),
    );
    if (detached && shared) {
      const original = design.nodes.find((n) => n.id === nodeId);
      if (!original) continue;
      const copy = nextId(design, "n");
      design.nodes.push({ id: copy, position: [...original.position], fixed: false });
      for (const m of picked) {
        if (m.start === nodeId) m.start = copy;
        if (m.end === nodeId) m.end = copy;
      }
      moved.set(nodeId, copy);
    } else moved.set(nodeId, nodeId);
  }
  const members = design.members.filter((m) => parts.members.includes(m.id));
  const before = new Map(members.map((m) => [m.id, positions(design, m)]));
  for (const nodeId of moved.values()) {
    const node = design.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const local = sub3(node.position, motion.pivot);
    const turned = rotating ? rotate3(local, motion.axis, motion.angle) : local;
    const next = add3(add3(motion.pivot, turned), motion.translate);
    // Rounding after a rotation would change member lengths beyond the catalog tolerance.
    node.position = rotating ? next : round(next);
  }
  if (rotating)
    for (const m of members) {
      const old = before.get(m.id);
      if (!old) continue;
      const [start, end] = positions(design, m);
      m.roll = rollFacing(
        start,
        end,
        rotate3(boardNormal(old[0], old[1], m.roll), motion.axis, motion.angle),
      );
    }
  if (detached) {
    // The moved ends are used only by the moved members (shared ones were split off above), so an end
    // that lands exactly on a node that stayed joins it.
    for (const nodeId of new Set(moved.values())) {
      const own = design.nodes.find((n) => n.id === nodeId);
      const landing = design.nodes.find(
        (n) =>
          own && n.id !== own.id && same(n.position, own.position) && ![...moved.values()].includes(n.id),
      );
      if (own && landing) replaceNode(design, own.id, landing.id);
    }
  }
  if (target === "member" && member) {
    if (member.kind === "female") {
      const others = { ...design, members: design.members.filter((m) => m.id !== member.id) };
      const clash = others.members.some(
        (m) =>
          m.kind === "female" &&
          m.layer === member.layer &&
          [m.start, m.end].some((n) => n === member.start || n === member.end),
      );
      if (clash) member.layer = nextOuterLayer(others, [member.start, member.end]);
    }
  }
  // Boards that stayed put keep their side even if their host male moved away.
  for (const id of parts.members) sides.delete(id);
  keepBoardSides(design, sides);
  // Re-match tenons to holes for males that are inserted through holes (or the male just moved).
  rematchInsertedMales(design, member?.kind === "male" ? member.id : undefined);
  // A member moved on its own takes its ropes off: they hang on the tenons it left or it was their winder.
  const split = [...moved].filter(([from, to]) => from !== to).map(([from]) => from);
  const movesMale = picked.some((m) => m.kind === "male");
  const dropped = design.ropes.filter(
    (r) =>
      detached &&
      (parts.members.includes(r.windingMember) || (movesMale && r.route.some((n) => split.includes(n)))),
  );
  design.ropes = design.ropes.filter((r) => !dropped.includes(r));
  return {
    nodes: [...moved.values()].filter((n) => design.nodes.some((v) => v.id === n)),
    droppedRopes: dropped.map((r) => r.id),
  };
}

function positions(design: Design, member: Member): [Vec3, Vec3] {
  const start = design.nodes.find((n) => n.id === member.start);
  const end = design.nodes.find((n) => n.id === member.end);
  if (!start || !end) throw new Error("部材の節点がありません");
  return [start.position, end.position];
}

/** A line a part can turn about while it stays on its joints. */
export type Hinge = { pivot: Vec3; axis: Vec3 };
/**
 * Drops the tiny off-axis components of a unit shaft direction. Node coordinates are rounded to 1e-6 by
 * some edits and not by others, so a male built along a coordinate axis can lean by ~1e-6 rad. Turning a
 * 3 m board about that leaning line lifts its far end by micrometres, which then reads as a collision or
 * an off-seat hole. Components below 1e-5 are taken as zero; real slanted males are far above that.
 */
function snapAxis(axis: Vec3): Vec3 {
  const snapped = axis.map((v) => (Math.abs(v) < 1e-5 ? 0 : v)) as Vec3;
  return scale3(snapped, 1 / Math.hypot(...snapped));
}
/**
 * How the joints between a moving part and the rest of the structure restrict it:
 * - free: nothing joins it to a male outside the part
 * - hinge: every joint lies on one male shaft line, so the part can only turn about that line
 * - locked: joints on different lines hold it in place
 * A joint is a board sitting on a tenon of a male outside the part (or the reverse), or a recorded hole
 * connection between the part and a member outside it.
 */
export function jointConstraint(
  design: Design,
  target: MoveTarget,
  id: string,
): { kind: "free" } | { kind: "hinge"; hinge: Hinge; joints: number } | { kind: "locked"; joints: number } {
  if (target === "node" || target === "all") return { kind: "free" };
  const inside = new Set(targetParts(design, target, id).members);
  const lines: Hinge[] = [];
  const shaft = (male: Member): Hinge => {
    const [a, b] = positions(design, male);
    const v = sub3(b, a);
    return { pivot: a, axis: snapAxis(scale3(v, 1 / Math.hypot(...v))) };
  };
  for (const a of design.members.filter((m) => inside.has(m.id)))
    for (const b of design.members.filter((m) => !inside.has(m.id))) {
      if (a.kind === b.kind) continue;
      const male = a.kind === "male" ? a : b;
      for (const node of [a.start, a.end].filter((n) => n === b.start || n === b.end)) {
        const at = design.nodes.find((n) => n.id === node)?.position;
        if (at) lines.push({ pivot: at, axis: shaft(male).axis });
      }
    }
  for (const c of design.connections) {
    if (inside.has(c.male) === inside.has(c.female)) continue;
    const male = design.members.find((m) => m.id === c.male);
    if (male) lines.push({ pivot: holeSite(design, c.female, c.hole).position, axis: shaft(male).axis });
  }
  if (!lines.length) return { kind: "free" };
  const [first] = lines;
  const onLine = lines.every((l) => {
    if (Math.abs(Math.abs(dot3(l.axis, first.axis)) - 1) > 1e-6) return false;
    const offset = sub3(l.pivot, first.pivot);
    return Math.hypot(...sub3(offset, scale3(first.axis, dot3(offset, first.axis)))) < 1e-6;
  });
  return onLine
    ? { kind: "hinge", hinge: first, joints: lines.length }
    : { kind: "locked", joints: lines.length };
}

/**
 * Finds how far a part can turn about a hinge without colliding, checking the sweep in small steps (the
 * farthest moving point advances at most `reach` per step) and remembering what was already checked.
 */
export class HingeSweep {
  private low = 0;
  private high = 0;
  private lowBlocked = false;
  private highBlocked = false;
  private readonly step: number;
  private readonly members: Set<string>;
  constructor(
    private readonly design: Design,
    private readonly target: MoveTarget,
    private readonly id: string,
    readonly hinge: Hinge,
    // Half a board or tenon thickness (30 mm): a step can never jump over either.
    reach = 0.015,
  ) {
    const parts = targetParts(design, target, id);
    this.members = new Set(parts.members);
    const radius = Math.max(
      1e-6,
      ...design.nodes
        .filter((n) => parts.nodes.includes(n.id))
        .map((n) => {
          const offset = sub3(n.position, hinge.pivot);
          return Math.hypot(...sub3(offset, scale3(hinge.axis, dot3(offset, hinge.axis))));
        }),
    );
    this.step = Math.min(2, (reach / radius) * (180 / Math.PI));
  }
  /** The checked range so far, and whether each side has hit something. */
  get range() {
    return { min: this.low, max: this.high, minBlocked: this.lowBlocked, maxBlocked: this.highBlocked };
  }
  /** The closest angle to `angle` (degrees) reachable from 0 without a collision on the way. */
  limit(angle: number): number {
    const wanted = Math.max(-360, Math.min(360, angle));
    while (wanted > this.high && !this.highBlocked) {
      const next = Math.min(this.high + this.step, wanted);
      if (this.clear(next)) this.high = next;
      else this.highBlocked = true;
    }
    while (wanted < this.low && !this.lowBlocked) {
      const next = Math.max(this.low - this.step, wanted);
      if (this.clear(next)) this.low = next;
      else this.lowBlocked = true;
    }
    return Math.max(this.low, Math.min(this.high, wanted));
  }
  /** Whether the part turned by `angle` about the hinge collides with nothing. */
  clear(angle: number): boolean {
    const draft = structuredClone(this.design);
    try {
      moveParts(draft, this.target, this.id, { translate: [0, 0, 0], ...this.hinge, angle });
      validateMemberCollisions(draft, this.members);
      return true;
    } catch (error) {
      // A collision or a tenon leaving its hole is exactly what ends the free range.
      if (error instanceof Error) return false;
      throw error;
    }
  }
}

/** A mirror plane through `point` with unit `normal`. */
export type MirrorPlane = { point: Vec3; normal: Vec3 };
/**
 * The plane across the middle of `maleId`, perpendicular to its shaft: with the two tenons as the ends of
 * the male, a structure built symmetrically about the male mirrors one tenon side onto the other.
 */
export function mirrorPlane(design: Design, maleId: string): MirrorPlane {
  const male = design.members.find((m) => m.id === maleId);
  if (male?.kind !== "male") throw new Error("中心にする雄材を選んでください");
  const [a, b] = positions(design, male);
  const shaft = sub3(b, a);
  // Keep axis-aligned normals exact so mirrored nodes stay on the editor's grid.
  const normal = scale3(shaft, 1 / Math.hypot(...shaft)).map((v) => (Math.abs(v) < 1e-12 ? 0 : v)) as Vec3;
  return { point: round(scale3(add3(a, b), 0.5)), normal };
}
const reflect = (v: Vec3, n: Vec3) => sub3(v, scale3(n, 2 * dot3(v, n)));
/**
 * Adds the mirror image of the given members across `plane`. Boards on one tenon of a male land on the
 * other tenon of its mirror image (the same male when it straddles the plane) and take the innermost
 * free layer there; nodes on the plane are shared. Members that would land on an existing member of the same kind (including members on the
 * plane itself) are skipped, so mirroring a whole structure makes it symmetric. Mirrored males record
 * the holes they pass through. Ropes and rings are not mirrored. Returns the new members.
 */
export function mirrorParts(
  design: Design,
  memberIds: string[],
  plane: MirrorPlane,
  { allowNone = false } = {},
): string[] {
  const axisAligned = plane.normal.filter((v) => Math.abs(v) > 1e-12).length === 1;
  const nodeAt = (position: Vec3) => {
    const offset = dot3(sub3(position, plane.point), plane.normal);
    const raw = sub3(position, scale3(plane.normal, 2 * offset));
    // An axis-aligned reflection is exact up to rounding; keep coordinates on the editor's 1e-6 grid.
    const target = axisAligned ? round(raw) : raw;
    const existing = design.nodes.find((n) => same(n.position, target));
    if (existing) return existing.id;
    const id = nextId(design, "n");
    design.nodes.push({ id, position: target, fixed: false });
    return id;
  };
  const sources = design.members
    .filter((m) => memberIds.includes(m.id))
    // Males first, so boards are placed against the tenons they hang on.
    .sort((a, b) => Number(a.kind === "female") - Number(b.kind === "female"));
  const created: string[] = [];
  const inserted: string[] = [];
  for (const source of sources) {
    const [a, b] = positions(design, source);
    const start = nodeAt(a);
    const end = nodeAt(b);
    const taken = design.members.some(
      (m) =>
        m.kind === source.kind &&
        ((m.start === start && m.end === end) || (m.start === end && m.end === start)),
    );
    // Only existing nodes can already carry a member, so a skipped member left no new node behind.
    if (taken) {
      continue;
    }
    const [s, e] = positions(design, { ...source, start, end });
    const member: Member = {
      ...source,
      id: nextId(design, "m"),
      start,
      end,
      roll: rollFacing(s, e, reflect(boardNormal(a, b, source.roll), plane.normal)),
    };
    if (member.kind === "female") placeBoard(design, member);
    else design.members.push(member);
    created.push(member.id);
    if (design.connections.some((c) => c.male === source.id)) inserted.push(member.id);
  }
  if (!created.length && !allowNone) throw new Error("反対側には既に同じ部材があります（左右対称です）");
  for (const id of inserted) rematchInsertedMales(design, id);
  // Mirrored boards may pass over tenons of inserted males through their middle holes (e.g. the image of
  // a lengthened board), so every inserted male records its holes again; mirrored males may also stand
  // in holes of boards they do not share a node with.
  rematchInsertedMales(design);
  connectThreadedMales(design);
  return created;
}

/** The member of the same kind lying where `member` lands when mirrored across `plane`, if any. */
export function mirrorCounterpart(design: Design, member: Member, plane: MirrorPlane): string | undefined {
  const image = (id: string) => {
    const at = design.nodes.find((n) => n.id === id)?.position;
    if (!at) return undefined;
    const target = sub3(at, scale3(plane.normal, 2 * dot3(sub3(at, plane.point), plane.normal)));
    return design.nodes.find((n) => same(n.position, target))?.id;
  };
  const start = image(member.start);
  const end = image(member.end);
  if (!start || !end) return undefined;
  return design.members.find(
    (m) =>
      m.kind === member.kind &&
      ((m.start === start && m.end === end) || (m.start === end && m.end === start)),
  )?.id;
}
/** What identifies a member's placement, to tell which members an edit changed. */
function placement(design: Design, m: Member) {
  const ends = positions(design, m)
    .map((p) => p.map((v) => v.toFixed(6)).join(","))
    .sort();
  return [m.kind, m.catalogId ?? "", m.roll.toFixed(6), m.holeCount, ...ends].join("|");
}
/**
 * Mirror modelling: repeats on the other side of `plane` what an edit did to `after` compared with
 * `before`. A removed member takes its mirror image with it; a changed member replaces its old image with
 * a new one; an added member gets an image. Members edited together with their own image (e.g. a whole
 * symmetric structure moved at once) are left as they are. Returns the members added on the other side
 * and the edited members that lie on the plane itself, which have no other side.
 */
export function mirrorEdit(
  before: Design,
  after: Design,
  plane: MirrorPlane,
): { created: string[]; onPlane: string[] } {
  const old = new Map(before.members.map((m) => [m.id, m]));
  const changed = after.members.filter((m) => {
    const was = old.get(m.id);
    return !was || placement(before, was) !== placement(after, m);
  });
  const removed = before.members.filter((m) => !after.members.some((v) => v.id === m.id));
  const edited = new Set([...changed.map((m) => m.id), ...removed.map((m) => m.id)]);
  // The image of each edited member in the design before the edit.
  const images = new Map<string, string | undefined>();
  for (const id of edited) {
    const was = old.get(id);
    images.set(id, was ? mirrorCounterpart(before, was, plane) : undefined);
  }
  const paired = (id: string) => {
    const image = images.get(id);
    return image !== undefined && image !== id && edited.has(image);
  };
  for (const id of edited) {
    const image = images.get(id);
    if (!image || image === id || paired(id)) continue;
    if (after.members.some((m) => m.id === image)) removeMember(after, image);
  }
  const toMirror = changed.filter((m) => !paired(m.id) && after.members.some((v) => v.id === m.id));
  const onPlane = toMirror.filter((m) => mirrorCounterpart(after, m, plane) === m.id).map((m) => m.id);
  const created = mirrorParts(
    after,
    toMirror.map((m) => m.id),
    plane,
    { allowNone: true },
  );
  return { created, onPlane };
}

export type HoleRef = { female: string; hole: number };
/**
 * Turns the board of `moving` about the tenon it hangs on until that hole lies over `target`, so one
 * male can pass through both. Only the board turns (see `jointConstraint`); its other joints must lie
 * on the same shaft. The holes must face along that shaft and sit at the same distance from it.
 * Returns the angle turned, in degrees.
 */
export function alignHole(design: Design, target: HoleRef, moving: HoleRef): number {
  if (target.female === moving.female) throw new Error("別の雌材の穴を選んでください");
  const constraint = jointConstraint(design, "member", moving.female);
  if (constraint.kind !== "hinge")
    throw new Error(
      constraint.kind === "locked"
        ? `雌材 ${moving.female} は別々の軸の雄材に固定されているため回せません`
        : `雌材 ${moving.female} は雄材の角棒に載っていないため、回す軸がありません`,
    );
  const { pivot, axis } = constraint.hinge;
  const a = holeSite(design, moving.female, moving.hole);
  const b = holeSite(design, target.female, target.hole);
  if (Math.abs(Math.abs(dot3(b.normal, axis)) - 1) > 1e-6)
    throw new Error(`雌材 ${target.female} の穴は回す軸と平行ではないため、重ねられません`);
  const across = (p: Vec3) => {
    const offset = sub3(p, pivot);
    return sub3(offset, scale3(axis, dot3(offset, axis)));
  };
  const from = across(a.center);
  const to = across(b.center);
  const [r, R] = [Math.hypot(...from), Math.hypot(...to)];
  if (Math.abs(r - R) > 1e-5)
    throw new Error(
      `角棒からの距離が違うため重なりません（${moving.female} の穴 ${(r * 1000).toFixed(1)}mm・${target.female} の穴 ${(R * 1000).toFixed(1)}mm）`,
    );
  const angle = (Math.atan2(dot3(axis, cross3(from, to)), dot3(from, to)) * 180) / Math.PI;
  if (Math.abs(angle) >= 1e-9)
    moveParts(design, "member", moving.female, { translate: [0, 0, 0], axis, angle, pivot });
  // Also when the holes already meet: laying them over each other again clears any earlier drift, on
  // the board laid over as well when it sits on a shaft of its own.
  squareToShaft(design, moving.female, axis);
  const base = jointConstraint(design, "member", target.female);
  if (base.kind === "hinge") squareToShaft(design, target.female, base.hinge.axis);
  if (Math.abs(angle) < 1e-9) return 0;
  return angle;
}

/**
 * Puts the far end of a board that turned about a shaft back into the plane of its tenon end, square to
 * the shaft. Earlier turns about a slightly leaning shaft (see snapAxis) leave the far end of a long board
 * a few micrometres off that plane, so its holes miss the seats of the boards they were laid over. Only
 * such drift (under 0.1 mm) is removed; a board that really runs along the shaft is left alone.
 */
function squareToShaft(design: Design, female: string, axis: Vec3) {
  const member = design.members.find((m) => m.id === female);
  if (!member) return;
  const [start, end] = positions(design, member);
  const drift = dot3(sub3(start, end), axis);
  if (drift === 0 || Math.abs(drift) > 1e-4) return;
  const node = design.nodes.find((n) => n.id === member.end);
  if (node) node.position = add3(end, scale3(axis, drift));
}

/** The hinge a board turns about, with a reason when it cannot turn. */
function boardHinge(design: Design, female: string): Hinge {
  const constraint = jointConstraint(design, "member", female);
  if (constraint.kind === "hinge") return constraint.hinge;
  throw new Error(
    constraint.kind === "locked"
      ? `雌材 ${female} は別々の軸の雄材に固定されているため回せません`
      : `雌材 ${female} は雄材の角棒に載っていないため、回す軸がありません`,
  );
}
/**
 * Lays the second and later holes over the first. A hole at the same distance from its tenon as the
 * first one turns its board alone. Otherwise both boards turn about their own tenons (which must be
 * parallel) to where the two holes meet: of the up to two meeting points, the one free of collisions
 * with the least turning wins. Returns how far each board turned, in degrees.
 */
export function alignHoles(design: Design, holes: HoleRef[]): { female: string; angle: number }[] {
  const [target, ...rest] = holes;
  if (!target || !rest.length) throw new Error("穴を2つ以上選んでください");
  const turns: { female: string; angle: number }[] = [];
  let targetTurned = false;
  for (const moving of rest) {
    if (moving.female === target.female) throw new Error("別の雌材の穴を選んでください");
    const hinge = boardHinge(design, moving.female);
    const radius = (h: Hinge, hole: HoleRef) => {
      const offset = sub3(holeSite(design, hole.female, hole.hole).center, h.pivot);
      return Math.hypot(...sub3(offset, scale3(h.axis, dot3(offset, h.axis))));
    };
    const same =
      Math.abs(radius(hinge, moving) - radius(hinge, target)) <= 1e-5 &&
      Math.abs(Math.abs(dot3(holeSite(design, target.female, target.hole).normal, hinge.axis)) - 1) <= 1e-6;
    if (same || targetTurned) {
      turns.push({ female: moving.female, angle: alignHole(design, target, moving) });
      continue;
    }
    let other: Hinge;
    try {
      other = boardHinge(design, target.female);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // The base board cannot turn, so only the single-board rule applies; report why it fails.
      alignHole(design, target, moving);
      throw error;
    }
    if (Math.abs(Math.abs(dot3(other.axis, hinge.axis)) - 1) > 1e-6)
      throw new Error(
        `雌材 ${moving.female} と ${target.female} の角棒が平行ではないため、穴を重ねられません`,
      );
    const pair = meetingTurns(design, hinge, moving, other, target);
    turns.push({ female: moving.female, angle: pair.moving }, { female: target.female, angle: pair.target });
    targetTurned = true;
  }
  return turns;
}
/** Turns both boards about their parallel tenons so their holes meet; returns the two angles. */
function meetingTurns(design: Design, a: Hinge, holeA: HoleRef, b: Hinge, holeB: HoleRef) {
  const axis = a.axis;
  // Plane coordinates perpendicular to the shafts.
  const u = Math.abs(axis[0]) < 0.9 ? cross3(axis, [1, 0, 0]) : cross3(axis, [0, 1, 0]);
  const e1 = scale3(u, 1 / Math.hypot(...u));
  const e2 = cross3(axis, e1);
  const flat = (p: Vec3): [number, number] => [dot3(p, e1), dot3(p, e2)];
  const ca = flat(a.pivot);
  const cb = flat(b.pivot);
  const pa = flat(holeSite(design, holeA.female, holeA.hole).center);
  const pb = flat(holeSite(design, holeB.female, holeB.hole).center);
  const ra = Math.hypot(pa[0] - ca[0], pa[1] - ca[1]);
  const rb = Math.hypot(pb[0] - cb[0], pb[1] - cb[1]);
  const d = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
  if (d < 1e-9) throw new Error("同じ角棒に載る雌材どうしは、角棒からの距離が同じ穴しか重なりません");
  if (d > ra + rb + 1e-9 || d < Math.abs(ra - rb) - 1e-9)
    throw new Error(
      `穴が届きません（角棒どうしの間隔 ${(d * 1000).toFixed(1)}mm に対し、角棒から穴まで ${(ra * 1000).toFixed(1)}mm と ${(rb * 1000).toFixed(1)}mm）`,
    );
  const along = (d * d + ra * ra - rb * rb) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - along * along));
  const ux = (cb[0] - ca[0]) / d;
  const uy = (cb[1] - ca[1]) / d;
  const base = [ca[0] + ux * along, ca[1] + uy * along];
  const points = [
    [base[0] - uy * h, base[1] + ux * h],
    [base[0] + uy * h, base[1] - ux * h],
  ];
  // Signed angle about the shaft (e1 × e2 = axis) from one plane vector to another, in degrees.
  const turn = (from: number[], to: number[]) =>
    (Math.atan2(from[0] * to[1] - from[1] * to[0], from[0] * to[0] + from[1] * to[1]) * 180) / Math.PI;
  const options = points.map((p) => ({
    moving: turn([pa[0] - ca[0], pa[1] - ca[1]], [p[0] - ca[0], p[1] - ca[1]]),
    target: turn([pb[0] - cb[0], pb[1] - cb[1]], [p[0] - cb[0], p[1] - cb[1]]),
  }));
  // Both angles are measured about `axis` (the first shaft); the second shaft may point the other way, so
  // the second board turns about its own pivot but around the same axis.
  const apply = (into: Design, option: (typeof options)[number]) => {
    for (const [pivot, hole, angle] of [
      [a.pivot, holeA, option.moving],
      [b.pivot, holeB, option.target],
    ] as const) {
      if (Math.abs(angle) > 1e-9)
        moveParts(into, "member", hole.female, { translate: [0, 0, 0], axis, pivot, angle });
      squareToShaft(into, hole.female, axis);
    }
  };
  const clear = (option: (typeof options)[number]) => {
    const draft = structuredClone(design);
    try {
      apply(draft, option);
      validateMemberCollisions(draft, new Set([holeA.female, holeB.female]));
      return true;
    } catch (error) {
      // A meeting point that collides is simply the worse choice.
      if (error instanceof Error) return false;
      throw error;
    }
  };
  const ranked = options
    .map((option) => ({
      option,
      clear: clear(option),
      turning: Math.abs(option.moving) + Math.abs(option.target),
    }))
    .sort((x, y) => Number(y.clear) - Number(x.clear) || x.turning - y.turning)
    .map((r) => r.option);
  apply(design, ranked[0]);
  // Report each angle about the board's own shaft, like a single-board turn.
  const sign = dot3(b.axis, axis) < 0 ? -1 : 1;
  return { moving: ranked[0].moving, target: sign * ranked[0].target };
}

/**
 * The plane at the far end of the given members along `direction` (a unit axis), square to it: through
 * the outermost of their nodes, so a male standing at that end lies in it.
 */
export function endPlane(design: Design, memberIds: string[], direction: Vec3): MirrorPlane {
  const ids = new Set(
    design.members.filter((m) => memberIds.includes(m.id)).flatMap((m) => [m.start, m.end]),
  );
  const reach = design.nodes.filter((n) => ids.has(n.id)).map((n) => dot3(n.position, direction));
  if (!reach.length) throw new Error("反転する部材を選んでください");
  // Not rounded: the end male may stand off the 1e-6 grid (e.g. after laying holes over each other), and
  // a plane even a fraction of a micrometre beside it would make a second male next to it, not share it.
  return { point: scale3(direction, Math.max(...reach)), normal: direction };
}
/** The plane square to `direction` (a unit axis) that the chosen male lies in, to mirror about it. */
export function malePlane(design: Design, maleId: string, direction: Vec3): MirrorPlane {
  const male = design.members.find((m) => m.id === maleId);
  if (male?.kind !== "male") throw new Error("反転の軸にする端には雄材を選んでください");
  if (!squareTo(design, male, direction))
    throw new Error(`雄材 ${maleId} はこの向きと直角に交わる面に載っていません。別の向きを選んでください`);
  return { point: scale3(direction, dot3(positions(design, male)[0], direction)), normal: direction };
}
/** Whether the male's shaft is square to `direction`, so it lies in a mirror plane facing that way. */
export function squareTo(design: Design, male: Member, direction: Vec3) {
  const [a, b] = positions(design, male);
  const shaft = sub3(b, a);
  return Math.abs(dot3(shaft, direction)) <= 1e-6 * Math.hypot(...shaft);
}
/**
 * The axis direction to mirror toward so that `maleId` is the end: square to its shaft, from the middle of
 * the given members toward the male along the axis it is farthest off.
 */
export function sideToward(design: Design, memberIds: string[], maleId: string): Vec3 | null {
  const male = design.members.find((m) => m.id === maleId);
  if (male?.kind !== "male") return null;
  const [a, b] = positions(design, male);
  const shaft = sub3(b, a);
  const ids = new Set(
    design.members.filter((m) => memberIds.includes(m.id)).flatMap((m) => [m.start, m.end]),
  );
  const points = design.nodes.filter((n) => ids.has(n.id)).map((n) => n.position);
  if (!points.length) return null;
  const centre = scale3(points.reduce(add3, [0, 0, 0] as Vec3), 1 / points.length);
  const toward = sub3(a, centre);
  let best: Vec3 | null = null;
  let reach = 1e-6;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(shaft[i]) > 1e-6 * Math.hypot(...shaft)) continue;
    if (Math.abs(toward[i]) <= reach) continue;
    reach = Math.abs(toward[i]);
    best = [0, 0, 0];
    best[i] = Math.sign(toward[i]);
  }
  return best;
}
/**
 * Mirror copy joined at the end: adds the mirror image of the members across their end plane along
 * `direction`, so the image continues the structure from its outermost male (shared with the image)
 * instead of repeating it shifted. With `check: false` the result is not validated, for drawing a preview
 * of an image that does not fit. Returns the new members, and the whole image: the new members plus the
 * given ones lying on the plane, which are their own image (to mirror the image again further on).
 * With `through`, the image is joined at that male instead of the outermost end.
 */
export function mirrorAtEnd(
  design: Design,
  memberIds: string[],
  direction: Vec3,
  { check = true, through }: { check?: boolean; through?: string } = {},
): { created: string[]; image: string[] } {
  const plane = through ? malePlane(design, through, direction) : endPlane(design, memberIds, direction);
  const onPlane = design.members
    .filter((m) => memberIds.includes(m.id) && mirrorCounterpart(design, m, plane) === m.id)
    .map((m) => m.id);
  const created = mirrorParts(design, memberIds, plane, { allowNone: !check });
  if (check) validateMemberCollisions(design, new Set(created));
  return { created, image: [...onPlane, ...created] };
}

/**
 * Copies members shifted by `offset`. Copied ends that land exactly on a node use it, so a copy can
 * join the structure at shared tenons; a copy that would lie where a member of the same kind already
 * is, is left out (copying a bay sideways does not double the male the two bays share). Boards keep
 * their layer where it is free, otherwise they take the innermost free layer that fits. Males copied
 * from inserted males record their holes again. With `check: false` nothing is validated (for drawing
 * a preview of a copy that does not fit). Ropes and rings are not copied. Returns the new members.
 */
/**
 * Tenon nodes a board's middle holes land on: ends of males standing square to the board at a hole centre.
 * The board is turned to face out along the first such tenon (it would otherwise lie on the male's body),
 * and the nodes are returned so the board is seated and joined on them.
 */
function faceTenons(design: Design, board: Member): string[] {
  const axes = boardAxes(design, board);
  const centres = holeOffsets(axes.length, board.holeCount, board).map((t) =>
    add3(axes.start, scale3(axes.x, t)),
  );
  const at = (id: string) => design.nodes.find((n) => n.id === id)?.position;
  const nodes: string[] = [];
  let outward: Vec3 | null = null;
  for (const male of design.members) {
    if (male.kind !== "male") continue;
    for (const [tip, base] of [
      [male.start, male.end],
      [male.end, male.start],
    ]) {
      if (tip === board.start || tip === board.end) continue;
      const p = at(tip);
      const q = at(base);
      if (!p || !q || !centres.some((c) => same(c, p))) continue;
      const shaft = sub3(p, q);
      if (Math.abs(dot3(shaft, axes.normal)) < (1 - 1e-6) * Math.hypot(...shaft)) continue;
      nodes.push(tip);
      outward ??= shaft;
    }
  }
  if (outward && dot3(outward, boardAxes(design, board).normal) < 0)
    board.roll = board.roll > 0 ? board.roll - 180 : board.roll + 180;
  return nodes;
}
export function duplicateParts(
  design: Design,
  memberIds: string[],
  offset: Vec3,
  { check = true } = {},
): string[] {
  const axisAligned = offset.filter((v) => Math.abs(v) > 1e-12).length <= 1;
  const nodeAt = (position: Vec3) => {
    const target = axisAligned ? round(position) : position;
    const existing = design.nodes.find((n) => same(n.position, target));
    if (existing) return existing.id;
    const id = nextId(design, "n");
    design.nodes.push({ id, position: target, fixed: false });
    return id;
  };
  const sources = design.members
    .filter((m) => memberIds.includes(m.id))
    // Males first, so boards are placed against the tenons they hang on.
    .sort((a, b) => Number(a.kind === "female") - Number(b.kind === "female"));
  const created: string[] = [];
  const inserted: string[] = [];
  let malesChecked = !check;
  for (const source of sources) {
    if (source.kind === "female" && !malesChecked) {
      // The copied males stand before any board is placed on them: report their own clashes (such as two
      // tenons meeting in one hole) rather than a board failing to fit between them.
      validateMemberCollisions(design, new Set(created));
      malesChecked = true;
    }
    const [a, b] = positions(design, source);
    const start = nodeAt(add3(a, offset));
    const end = nodeAt(add3(b, offset));
    const taken = design.members.some(
      (m) =>
        m.kind === source.kind &&
        ((m.start === start && m.end === end) || (m.start === end && m.end === start)),
    );
    if (taken) continue;
    const copy: Member = { ...source, id: nextId(design, "m"), start, end };
    const through = copy.kind === "female" ? faceTenons(design, copy) : [];
    if (copy.kind === "female" && check) placeBoard(design, copy, source.layer, through);
    else design.members.push(copy);
    created.push(copy.id);
    if (design.connections.some((c) => c.male === source.id)) inserted.push(copy.id);
  }
  if (!check) return created;
  if (!created.length) throw new Error("その位置には同じ部材がすでにあります");
  for (const id of inserted) rematchInsertedMales(design, id);
  rematchInsertedMales(design);
  connectThreadedMales(design);
  validateMemberCollisions(design, new Set(created));
  return created;
}

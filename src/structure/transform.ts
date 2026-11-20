import { validateMemberCollisions } from "./collision";
import type { Design, Member, Vec3 } from "./design";
import { boardSides, keepBoardSides, nextId, rematchInsertedMales } from "./editor";
import { add3, cross3, dot3, holeSite, scale3, sub3 } from "./holes";
import { nextOuterLayer } from "./seats";
import { rollFacing } from "./templates";

/**
 * What a move or rotation acts on.
 * - node: one node (the attached members stretch; drawing-catalog lengths usually reject this)
 * - member: one member on its own; nodes it shares with other members are split off
 * - group: the member plus everything joined to it through shared nodes or hole connections
 * - all: the whole structure
 */
export type MoveTarget = "node" | "member" | "group" | "all";
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
  const members = target === "group" ? connectedMembers(design, id) : [id];
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
  for (const nodeId of parts.nodes) {
    const shared = design.members.some(
      (m) => !parts.members.includes(m.id) && (m.start === nodeId || m.end === nodeId),
    );
    if (target === "member" && member && shared) {
      const original = design.nodes.find((n) => n.id === nodeId);
      if (!original) continue;
      const copy = nextId(design, "n");
      design.nodes.push({ id: copy, position: [...original.position], fixed: false });
      if (member.start === nodeId) member.start = copy;
      if (member.end === nodeId) member.end = copy;
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
  if (target === "member" && member) {
    for (const end of ["start", "end"] as const) {
      const own = design.nodes.find((n) => n.id === member[end]);
      const landing = design.nodes.find(
        (n) =>
          own && n.id !== own.id && same(n.position, own.position) && ![...moved.values()].includes(n.id),
      );
      // The member's own end nodes are used by nothing else (shared ones were split off above).
      if (own && landing) replaceNode(design, own.id, landing.id);
    }
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
  const dropped = design.ropes.filter(
    (r) =>
      target === "member" &&
      (r.windingMember === id || (member?.kind === "male" && r.route.some((n) => split.includes(n)))),
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
    return { pivot: a, axis: scale3(v, 1 / Math.hypot(...v)) };
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

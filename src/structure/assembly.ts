import { Box3, Vector3 } from "three";
import { type Design, type HoleConnection, type Vec3, validateDesign } from "./design";
import { drawingSolid } from "./drawing-collision";
import { boardAxes, dot3, matchingShaftHoles, scale3 } from "./holes";

export type AssemblyStep = {
  id: string;
  kind: "male" | "female" | "ring";
  number: number;
  approach: Vec3;
  instruction: string;
  temporarySupport?: boolean;
  supportIds?: string[];
};
export type AssemblyPlan = {
  steps: AssemblyStep[];
  complete: boolean;
  explored: number;
  limited: boolean;
  blocked: { id: string; reason: string }[];
  notes: string[];
};
type Cell = ReturnType<ReturnType<typeof drawingSolid>["cells"]>[number];

/** Continuous separating-axis test for translation, not discrete animation-frame sampling. */
export function sweptCellsOverlap(a: Cell, b: Cell, travel: Vector3) {
  const swept = a.bounds.clone().union(a.bounds.clone().translate(travel));
  if (!swept.intersectsBox(b.bounds)) return false;
  let enter = 0,
    exit = 1;
  const separates = (raw: Vector3) => {
    if (raw.lengthSq() < 1e-18) return false;
    const axis = raw.clone().normalize();
    let amin = Infinity,
      amax = -Infinity,
      bmin = Infinity,
      bmax = -Infinity;
    for (const p of a.points) {
      const v = p.dot(axis);
      amin = Math.min(amin, v);
      amax = Math.max(amax, v);
    }
    for (const p of b.points) {
      const v = p.dot(axis);
      bmin = Math.min(bmin, v);
      bmax = Math.max(bmax, v);
    }
    const speed = travel.dot(axis),
      low = bmin - amax + 1e-6,
      high = bmax - amin - 1e-6;
    if (Math.abs(speed) < 1e-12) return low >= 0 || high <= 0;
    const t1 = low / speed,
      t2 = high / speed;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    return enter >= exit - 1e-9;
  };
  for (const axis of [...a.normals, ...b.normals]) if (separates(axis)) return false;
  for (const ea of a.edges) for (const eb of b.edges) if (separates(ea.clone().cross(eb))) return false;
  return enter < exit - 1e-9;
}

export function analyzeAssembly(
  design: Design,
  maxStates = 20000,
  maxMs = 12000,
  manualOrder?: readonly string[],
): AssemblyPlan {
  validateDesign(design);
  if (design.version !== 6) throw new Error("組立解析は図面規格（v6）に対応しています");
  const started = performance.now();
  const solids = new Map(design.members.map((m) => [m.id, drawingSolid(design, m).cells()]));
  const boxes = new Map(
    [...solids].map(([id, cells]) => [id, cells.reduce((box, c) => box.union(c.bounds), new Box3())]),
  );
  const floor = Math.min(...[...boxes.values()].map((b) => b.min.y));
  const connections: HoleConnection[] = [...design.connections];
  for (const male of design.members.filter((m) => m.kind === "male")) {
    const axes = boardAxes(design, male);
    for (const c of matchingShaftHoles(design, axes.start, axes.end, male.id))
      if (!connections.some((v) => v.male === male.id && v.female === c.female && v.hole === c.hole))
        connections.push({ ...c, male: male.id, id: `inferred-${male.id}-${c.female}-${c.hole}` });
  }
  const ids = [...design.members.map((m) => m.id), ...design.rings.map((r) => `ring:${r.id}`)];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const bit = (id: string) => 1n << BigInt(rank.get(id) ?? 0);
  const full = (1n << BigInt(ids.length)) - 1n;
  const built = (mask: bigint, id: string) => (mask & bit(id)) !== 0n;
  const height = (id: string) => boxes.get(id)?.getCenter(new Vector3()).y ?? floor;
  const order = [...ids].sort((a, b) => height(a) - height(b) || a.localeCompare(b));
  const maleLinks = design.members
    .filter((m) => m.kind === "male")
    .map((m) => ({ id: m.id, links: connections.filter((c) => c.male === m.id) }));
  // Prefer closing open ends before extending a one-sided assembly further.
  // This measures installed connections, not structural stability or bearing capacity.
  const unsupportedEnds = (mask: bigint) =>
    maleLinks.reduce((count, male) => {
      if (!built(mask, male.id)) return count;
      const ends = new Set(male.links.filter((c) => built(mask, c.female)).map((c) => c.end));
      return count + 2 - ends.size;
    }, 0);
  const supportCost = (mask: bigint) =>
    unsupportedEnds(mask) +
    design.members.filter(
      (m) =>
        m.kind === "female" &&
        built(mask, m.id) &&
        (boxes.get(m.id)?.min.y ?? Infinity) > floor + 0.001 &&
        !connections.some((c) => c.female === m.id && built(mask, c.male)),
    ).length;
  const blockers = new Map<string, boolean>();
  const pathBlocked = (id: string, travel: Vec3, other: string) => {
    const key = `${id}:${travel.join(",")}:${other}`;
    const known = blockers.get(key);
    if (known !== undefined) return known;
    const a = solids.get(id),
      b = solids.get(other);
    if (!a || !b) return false;
    const delta = new Vector3(...travel);
    const broad = boxes.get(id)?.clone();
    if (!broad?.union(broad.clone().translate(delta)).intersectsBox(boxes.get(other) as Box3)) {
      blockers.set(key, false);
      return false;
    }
    const hit = a.some((c) => b.some((d) => sweptCellsOverlap(c, d, delta)));
    blockers.set(key, hit);
    return hit;
  };
  const outerBlock = (male: string, end: string, seat: number, mask: bigint, ignore: string) => {
    const c = connections.find(
      (c) =>
        c.male === male && c.end === end && c.seat > seat && c.female !== ignore && built(mask, c.female),
    );
    if (c) return c.female;
    const r = design.rings.find(
      (r) => r.member === male && r.end === end && r.slot > seat && built(mask, `ring:${r.id}`),
    );
    return r ? `ring:${r.id}` : undefined;
  };
  const candidate = (id: string, mask: bigint): AssemblyStep | string => {
    const m = design.members.find((m) => m.id === id);
    let approach: Vec3, instruction: string;
    let kind: AssemblyStep["kind"];
    let temporarySupport = false;
    if (!m) {
      const ring = design.rings.find((r) => `ring:${r.id}` === id);
      if (!ring || !built(mask, ring.member)) return "丸材を通す雄材が未設置";
      const outer = outerBlock(ring.member, ring.end, ring.slot, mask, id);
      if (outer) return `${outer}が外側を塞いでいる`;
      const male = design.members.find((m) => m.id === ring.member);
      if (!male) return "取付先の雄材がない";
      approach = scale3(
        boardAxes(design, male).x,
        (ring.end === "start" ? -1 : 1) * (design.geometry.tenonLength + 0.08),
      );
      instruction = `${ring.member}の${ring.end === "start" ? "始点" : "終点"}側から丸材を${ring.slot}段へ通す（経路干渉は未検証）`;
      kind = "ring";
    } else {
      kind = m.kind;
      const links = connections.filter((c) => c.male === id || c.female === id);
      if (
        mask === 0n ||
        (m.kind === "female" &&
          (boxes.get(id)?.min.y ?? Infinity) <= floor + 0.001 &&
          !links.some((c) => built(mask, c.male)))
      ) {
        if ((boxes.get(id)?.min.y ?? Infinity) > floor + 0.001) return "開始材は地面に接する材のみ";
        approach = [0, 0.25, 0];
        instruction = "地面に置いて開始材にする";
      } else if (m.kind === "male") {
        const attached = links.filter((c) => built(mask, c.female));
        if (!attached.length) {
          if (!links.length) return "既設の雌材につながっていない";
          temporarySupport = true;
        }
        if (new Set(attached.map((c) => c.end)).size > 1)
          return "両端の穴が既設材で埋まっており、雄材を新しく差し込めない";
        const end = attached[0]?.end ?? "start";
        approach = scale3(
          boardAxes(design, m).x,
          (end === "start" ? 1 : -1) * (design.geometry.tenonLength + 0.08),
        );
        instruction = `${attached.map((c) => `${c.female}の穴${c.hole + 1}`).join("・")}へ${end === "start" ? "始点" : "終点"}側の凸部を差し込む`;
      } else {
        const attached = links.filter((c) => built(mask, c.male));
        if (!attached.length) {
          if (!links.length) return "既設の雄材につながっていない";
          temporarySupport = true;
        }
        const directions = attached.map((c) => {
          const male = design.members.find((m) => m.id === c.male);
          if (!male) throw new Error("接続雄材がありません");
          return scale3(boardAxes(design, male).x, c.end === "start" ? -1 : 1);
        });
        if (directions.some((d) => dot3(d, directions[0]) < 0.99999))
          return "複数の凸部へ同じ外側方向から差し込めない";
        for (const c of attached) {
          const outer = outerBlock(c.male, c.end, c.seat, mask, id);
          if (outer) return `${outer}が外側を塞いでいるため内側へ追加できない`;
        }
        approach = scale3(directions[0] ?? boardAxes(design, m).normal, design.geometry.tenonLength + 0.08);
        instruction = `${attached.map((c) => `${c.male}の${c.end === "start" ? "始点" : "終点"}側・${c.seat}段`).join("、")}へ外側からはめる`;
      }
      if ((boxes.get(id)?.min.y ?? floor) + Math.min(0, approach[1]) < floor - 1e-6)
        return "差し込み開始位置が地面の下になります";
      for (const other of design.members)
        if (built(mask, other.id) && pathBlocked(id, approach, other.id))
          return `差し込み経路で${other.id}と干渉`;
    }
    if (temporarySupport) instruction = "仮支えで完成姿勢に保持し、後続の材を接続するまで支え続ける";
    return { id, kind, number: 0, approach, instruction, ...(temporarySupport ? { temporarySupport } : {}) };
  };
  const seen = new Set<bigint>();
  let explored = 0,
    limited = false,
    best: AssemblyStep[] = [],
    bestMask = 0n;
  const search = (mask: bigint, path: AssemblyStep[]): AssemblyStep[] | null => {
    if (path.length > best.length) {
      best = [...path];
      bestMask = mask;
    }
    if (mask === full) return path;
    if (seen.has(mask)) return null;
    if (++explored > maxStates || performance.now() - started > maxMs) {
      limited = true;
      return null;
    }
    seen.add(mask);
    // Once both ends are occupied, later additions can never make a new male insertable.
    for (const m of design.members)
      if (m.kind === "male" && !built(mask, m.id)) {
        const ends = new Set(
          connections.filter((c) => c.male === m.id && built(mask, c.female)).map((c) => c.end),
        );
        if (ends.size > 1) return null;
      }
    // An outer layer on an installed tenon permanently prevents adding an inner board or ring.
    for (const c of connections) {
      if (!built(mask, c.female) && built(mask, c.male) && outerBlock(c.male, c.end, c.seat, mask, c.female))
        return null;
    }
    for (const r of design.rings) {
      if (
        !built(mask, `ring:${r.id}`) &&
        built(mask, r.member) &&
        outerBlock(r.member, r.end, r.slot, mask, `ring:${r.id}`)
      )
        return null;
    }
    const priorities = new Map(
      order.filter((id) => !built(mask, id)).map((id) => [id, unsupportedEnds(mask | bit(id))]),
    );
    const nextOrder = order
      .filter((id) => !built(mask, id))
      .sort((a, b) => (priorities.get(a) as number) - (priorities.get(b) as number));
    for (const id of nextOrder) {
      const step = candidate(id, mask);
      if (typeof step === "string") continue;
      const result = search(mask | bit(id), [...path, { ...step, number: path.length + 1 }]);
      if (result) return result;
      if (limited) return null;
    }
    return null;
  };
  const reverseSeen = new Set<bigint>();
  const dismantle = (mask: bigint): AssemblyStep[] | null => {
    if (mask === 0n) return [];
    if (reverseSeen.has(mask)) return null;
    if (
      !design.members.some((m) => built(mask, m.id) && (boxes.get(m.id)?.min.y ?? Infinity) <= floor + 0.001)
    )
      return null;
    if (++explored > maxStates || performance.now() - started > maxMs) {
      limited = true;
      return null;
    }
    reverseSeen.add(mask);
    for (const id of [...order].reverse()) {
      if (!built(mask, id)) continue;
      const remaining = mask & ~bit(id);
      const step = candidate(id, remaining);
      if (typeof step === "string") continue;
      const earlier = dismantle(remaining);
      if (earlier) return [...earlier, { ...step, number: earlier.length + 1 }];
      if (limited) return null;
    }
    return null;
  };
  let manualBlocked: AssemblyPlan["blocked"] | undefined;
  let result: AssemblyStep[] | null = null;
  if (manualOrder) {
    const unique = new Set<string>();
    for (const id of manualOrder) {
      if (!rank.has(id)) throw new Error(`不明な部材ID：${id}`);
      if (unique.has(id)) throw new Error(`部材が重複しています：${id}`);
      unique.add(id);
    }
    manualBlocked = [];
    for (const [index, id] of manualOrder.entries()) {
      const step = candidate(id, bestMask);
      if (typeof step === "string") {
        manualBlocked.push({ id, reason: `${index + 1}手順目：${step}` });
        break;
      }
      best.push({ ...step, number: index + 1 });
      bestMask |= bit(id);
    }
    for (const id of ids.filter((id) => !built(bestMask, id) && !manualBlocked?.some((b) => b.id === id)))
      manualBlocked.push({
        id,
        reason: unique.has(id) ? "先行手順の問題を修正して再検査してください" : "手順が未指定です",
      });
    if (bestMask === full) result = best;
  } else result = dismantle(full);
  if (result && !manualOrder) {
    // Move a preferred step earlier only if every displaced insertion remains valid.
    // The unchanged suffix starts from exactly the same installed set.
    let mask = 0n;
    for (let i = 0; i < result.length; i++) {
      if (performance.now() - started > maxMs) break;
      const choices = result
        .slice(i)
        .map((step, offset) => ({
          index: i + offset,
          step: candidate(step.id, mask),
          score: supportCost(mask | bit(step.id)),
        }))
        .filter((c) => typeof c.step !== "string");
      choices.sort(
        (a, b) =>
          a.score - b.score ||
          Number((a.step as AssemblyStep).temporarySupport ?? false) -
            Number((b.step as AssemblyStep).temporarySupport ?? false) ||
          height((a.step as AssemblyStep).id) - height((b.step as AssemblyStep).id) ||
          a.index - b.index,
      );
      for (const choice of choices) {
        const moved = choice.step as AssemblyStep;
        let trialMask = mask | bit(moved.id);
        const changed = [moved];
        for (let j = i; j < choice.index; j++) {
          const step = candidate(result[j].id, trialMask);
          if (typeof step === "string") break;
          changed.push(step);
          trialMask |= bit(step.id);
        }
        if (changed.length !== choice.index - i + 1) continue;
        result.splice(i, changed.length, ...changed);
        break;
      }
      mask |= bit(result[i].id);
    }
  } else if (!result && !limited && !manualOrder) {
    result = search(0n, []);
  }
  let mask = 0n;
  const steps = (result ?? best).map((step, i) => {
    mask |= bit(step.id);
    const supportIds = design.members
      .filter((m) => {
        if (!built(mask, m.id) || (boxes.get(m.id)?.min.y ?? Infinity) <= floor + 0.001) return false;
        if (m.kind === "male")
          return (
            new Set(connections.filter((c) => c.male === m.id && built(mask, c.female)).map((c) => c.end))
              .size < 2
          );
        return !connections.some((c) => c.female === m.id && built(mask, c.male));
      })
      .map((m) => m.id);
    return { ...step, number: i + 1, supportIds };
  });
  return {
    steps,
    complete: !!result,
    explored,
    limited,
    blocked: result
      ? []
      : (manualBlocked ??
        ids
          .filter((id) => !built(bestMask, id))
          .map((id) => ({
            id,
            reason:
              typeof candidate(id, bestMask) === "string"
                ? (candidate(id, bestMask) as string)
                : "順序の再検討が必要",
          }))),
    notes: [
      ...(manualOrder
        ? ["手動で指定された順序を検査しました。自動並べ替えは行いません。問題のある手順以降は再生しません。"]
        : []),
      "地面に接する雌材は別の脚側でも開始可能。未接続の材は作業者・治具による仮支えを明示して保持します。雄材の両端に雌材をそろえる順を優先し、同条件なら低い材から進めます。最短・最適順の保証はありません。",
      "木材は外側からの直線差し込みを連続干渉判定。回転挿入・複数材を同時に動かす方法は探索しません。",
      "橙色の番号は仮支え対象です。未接続材と片端だけ接続した雄材を表示します。接続後の自立・仮支えの強度・作業者や工具の空間は未検証です。",
      ...(design.rings.length ? ["丸材は段順のみ判定。移動中の丸材との干渉は未検証です。"] : []),
      ...(design.ropes.length
        ? ["ロープは木材組立後に取り付ける別作業です。経路・巻き取り手順は今回の動画に含みません。"]
        : []),
    ],
  };
}

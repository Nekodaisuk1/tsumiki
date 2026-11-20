import { catalogPart, HITOTO_GEOMETRY, tenonOuterRadius } from "./catalog";
import { validateMemberCollisions } from "./collision.ts";
import { holeSite, matchingShaftHoles } from "./holes.ts";
import { ASSEMBLY_SLOTS, TENON_THICKNESS_UNITS } from "./seats.ts";
export type Vec3 = [number, number, number];
export type Node = { id: string; position: Vec3; fixed: boolean };
export type Member = {
  id: string;
  kind: "male" | "female";
  start: string;
  end: string;
  material: string;
  roll: number;
  layer: number;
  holeCount: number;
  catalogId?: string;
};
export type GeometryProfile = {
  specification?: "hitoto-v1";
  tenonCornerRadius?: number;
  boardWidth: number;
  thickness: number;
  tenonSize: number;
  tenonLength: number;
  holeSize: number;
};
export const DEFAULT_GEOMETRY: GeometryProfile = {
  boardWidth: 0.18,
  thickness: 0.045,
  tenonSize: 0.055,
  tenonLength: 0.045 * TENON_THICKNESS_UNITS,
  holeSize: 0.065,
};
export type Ring = {
  id: string;
  member: string;
  end: "start" | "end";
  slot: number;
  role: "spacer-unmodeled";
};
export type Material = {
  id: string;
  E: number;
  G: number;
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  density: number;
};
export type Rope = {
  id: string;
  route: [string, string, string, string];
  stiffness: number;
  prestrain: number;
  slack: number;
  windingMember: string;
};
export type HoleConnection = {
  id: string;
  male: string;
  female: string;
  end: "start" | "end";
  hole: number;
  seat: number;
};
export type JointModel = "rigid-approximation" | "clearance-contact";
export type JointParameters = {
  /** Relative stiffness once a tenon touches the hole wall (per contact direction). */
  contactStiffness: number;
  /** Small relative resistance while the tenon moves inside the clearance. */
  openStiffness: number;
};
export type RopeWrap = "sliding" | "locked";
export const DEFAULT_JOINT: JointParameters = { contactStiffness: 2000, openStiffness: 0.5 };
export type Design = {
  format: "tsumiki-design";
  version: 5 | 6;
  solver: "frame3d-contact-v5";
  units: "dimensionless";
  name: string;
  notes: string;
  jointModel: JointModel;
  joint: JointParameters;
  /** Friction bound at the rope wraps C and B. The real rope lies between these limits. */
  ropeWrap: RopeWrap;
  nodes: Node[];
  members: Member[];
  materials: Material[];
  ropes: Rope[];
  rings: Ring[];
  geometry: GeometryProfile;
  connections: HoleConnection[];
  analysis: {
    loadNode: string;
    direction: "x" | "y" | "z";
    force: number;
    torque: number;
    gravity: number;
    baseAcceleration: number;
    frequency: number;
    duration: number;
    damping: number;
    timeStep: number;
    excitationStop: number;
  };
  view: { deformationScale: number };
};
export function createDesign(width = 1.4, depth = 1, height = 1.2): Design {
  const positions: Vec3[] = [
    [0, 0, 0],
    [width, 0, 0],
    [width, 0, depth],
    [0, 0, depth],
    [0, height, 0],
    [width, height, 0],
    [width, height, depth],
    [0, height, depth],
  ];
  const nodes = positions.map((position, i) => ({ id: `n${i}`, position, fixed: i < 4 }));
  const members: Member[] = [];
  for (const [start, end, kind, layer] of [
    [0, 1, "male", 0],
    [3, 2, "male", 0],
    [4, 5, "male", 0],
    [7, 6, "male", 0],
    [0, 4, "female", 0],
    [1, 5, "female", 0],
    [2, 6, "female", 0],
    [3, 7, "female", 0],
    [0, 3, "female", 1],
    [1, 2, "female", 1],
    [4, 7, "female", 1],
    [5, 6, "female", 1],
  ] as const) {
    members.push({
      id: `m${members.length}`,
      kind,
      start: `n${start}`,
      end: `n${end}`,
      material: "wood",
      roll: kind === "female" ? 90 : 0,
      layer,
      holeCount: Math.max(
        2,
        Math.min(
          7,
          Math.floor(
            Math.hypot(...positions[start].map((v, i) => v - positions[end][i])) /
              (DEFAULT_GEOMETRY.holeSize * 1.5),
          ) + 1,
        ),
      ),
    });
  }
  const routes: [string, string, string, string][] = [
    ["n0", "n5", "n4", "n1"],
    ["n3", "n6", "n7", "n2"],
  ];
  return {
    format: "tsumiki-design",
    version: 5,
    solver: "frame3d-contact-v5",
    units: "dimensionless",
    name: "横向き雄材の立体枠",
    notes:
      "寸法未確定。座標・材料・荷重は検証用の無次元仮定。接合は穴と角棒の隙間・接触の近似（摩擦なし）。穴の適合・組立可否は未検証。",
    jointModel: "clearance-contact",
    joint: { ...DEFAULT_JOINT },
    ropeWrap: "locked",
    nodes,
    members,
    materials: [{ id: "wood", E: 10000, G: 4000, A: 0.04, Iy: 0.0005, Iz: 0.0005, J: 0.0008, density: 10 }],
    ropes: routes.map((route, i) => ({
      id: `r${i}`,
      route,
      stiffness: 120,
      prestrain: 0.002,
      slack: 0.025,
      windingMember: ["m0", "m1"][i],
    })),
    rings: [],
    geometry: { ...DEFAULT_GEOMETRY },
    connections: [],
    analysis: {
      loadNode: "n6",
      direction: "x",
      force: 0.08,
      torque: 0,
      gravity: 0.02,
      baseAcceleration: 0.05,
      frequency: 0.8,
      duration: 6,
      damping: 0.04,
      timeStep: 1 / 120,
      excitationStop: 3,
    },
    view: { deformationScale: 15 },
  };
}
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${context}: オブジェクトが必要です`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[], context: string) {
  if (Object.keys(value).some((key) => !expected.includes(key)) || expected.some((key) => !(key in value)))
    throw new Error(`${context}: 項目の不足または未対応の項目があります`);
}
function number(value: unknown, min: number, max: number, context: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${context}: ${min}〜${max}の有限数が必要です`);
}
function identifier(value: unknown, context: string) {
  if (typeof value !== "string" || !/^[a-zA-Z][\w-]{0,39}$/.test(value))
    throw new Error(`${context}: IDが不正です`);
}
export function validateDesign(value: unknown): asserts value is Design {
  const d = object(value, "design");
  keys(
    d,
    [
      "format",
      "version",
      "solver",
      "units",
      "name",
      "notes",
      "jointModel",
      "joint",
      "ropeWrap",
      "geometry",
      "connections",
      "nodes",
      "members",
      "materials",
      "ropes",
      "rings",
      "analysis",
      "view",
    ],
    "design",
  );
  if (
    d.format !== "tsumiki-design" ||
    (d.version !== 5 && d.version !== 6) ||
    d.solver !== "frame3d-contact-v5" ||
    d.units !== "dimensionless" ||
    !["rigid-approximation", "clearance-contact"].includes(String(d.jointModel))
  )
    throw new Error("未対応の保存形式・バージョン・解析モデルです");
  const joint = object(d.joint, "joint");
  keys(joint, ["contactStiffness", "openStiffness"], "joint");
  number(joint.contactStiffness, 1e-3, 1e7, "joint.contactStiffness");
  number(joint.openStiffness, 1e-6, 1e7, "joint.openStiffness");
  if (Number(joint.openStiffness) >= Number(joint.contactStiffness))
    throw new Error("隙間内の抵抗は接触時の剛性より小さくしてください");
  if (!["sliding", "locked"].includes(String(d.ropeWrap))) throw new Error("ropeWrap が不正です");
  if (
    typeof d.name !== "string" ||
    d.name.length > 200 ||
    typeof d.notes !== "string" ||
    d.notes.length > 10000
  )
    throw new Error("名称またはメモが不正です");
  for (const key of ["nodes", "members", "materials", "ropes", "rings", "connections"]) {
    if (!Array.isArray(d[key]) || d[key].length > 100) throw new Error(`${key}: 配列または件数が不正です`);
  }
  const design = d as unknown as Design;
  if (
    design.nodes.length < 2 ||
    design.nodes.length > 32 ||
    design.members.length < 1 ||
    design.materials.length < 1
  )
    throw new Error("節点は2〜32、部材・材料は1件以上必要です");
  const geometry = object(d.geometry, "geometry");
  keys(
    geometry,
    [
      "boardWidth",
      "thickness",
      "tenonSize",
      "tenonLength",
      "holeSize",
      ...(design.version === 6 ? ["specification", "tenonCornerRadius"] : []),
    ],
    "geometry",
  );
  if (design.version === 6) {
    if (geometry.specification !== "hitoto-v1") throw new Error("図面規格が不正です");
    for (const key of ["boardWidth", "thickness", "tenonSize", "tenonLength", "holeSize"] as const)
      if (geometry[key] !== HITOTO_GEOMETRY[key]) throw new Error(`図面寸法 ${key} が一致しません`);
    number(geometry.tenonCornerRadius, 0, design.geometry.tenonSize / 2, "tenonCornerRadius");
  }
  for (const key of ["boardWidth", "thickness", "tenonSize", "tenonLength", "holeSize"])
    number(geometry[key], 0.005, 0.5, `geometry.${key}`);
  if (
    design.geometry.holeSize <= design.geometry.tenonSize ||
    design.geometry.holeSize >= (design.geometry.boardWidth / Math.sqrt(2)) * 0.98
  )
    throw new Error("穴は角棒より大きく、板幅より小さくしてください");
  if (
    design.version === 5 &&
    Math.abs(design.geometry.tenonLength - design.geometry.thickness * TENON_THICKNESS_UNITS) > 1e-10
  )
    throw new Error("雄材の凸部の長さは雌材の板厚5枚分です");
  const seen = new Set<string>();
  for (const list of [
    design.nodes,
    design.members,
    design.materials,
    design.ropes,
    design.rings,
    design.connections,
  ])
    for (const item of list) {
      const o = object(item, "item");
      identifier(o.id, "id");
      if (seen.has(String(o.id))) throw new Error("IDが重複しています");
      seen.add(String(o.id));
    }
  const nodes = new Set(design.nodes.map((n) => n.id));
  const mats = new Set(design.materials.map((m) => m.id));
  for (const n of design.nodes) {
    const o = object(n, "node");
    keys(o, ["id", "position", "fixed"], "node");
    if (!Array.isArray(n.position) || n.position.length !== 3 || typeof n.fixed !== "boolean")
      throw new Error("節点が不正です");
    for (const v of n.position) number(v, -20, 20, "position");
  }
  for (const m of design.materials) {
    keys(object(m, "material"), ["id", "E", "G", "A", "Iy", "Iz", "J", "density"], "material");
    for (const key of ["E", "G", "A", "Iy", "Iz", "J", "density"] as const)
      number(m[key], 1e-8, 1e7, `material.${key}`);
  }
  const edgeSet = new Set<string>();
  const edgeKinds = new Map<string, string>();
  for (const m of design.members) {
    keys(
      object(m, "member"),
      [
        "id",
        "kind",
        "start",
        "end",
        "material",
        "roll",
        "layer",
        "holeCount",
        ...(design.version === 6 ? ["catalogId"] : []),
      ],
      "member",
    );
    if (
      !["male", "female"].includes(m.kind) ||
      !nodes.has(m.start) ||
      !nodes.has(m.end) ||
      m.start === m.end ||
      !mats.has(m.material)
    )
      throw new Error("部材参照が不正です");
    number(m.roll, -180, 180, "member.roll");
    if (m.kind === "female" && typeof m.layer === "number" && m.layer >= ASSEMBLY_SLOTS)
      throw new Error("先端の1枚分はロープ用です。雌材は0〜3段に配置してください");
    number(m.layer, 0, ASSEMBLY_SLOTS - 1, "member.layer");
    number(m.holeCount, 2, 32, "member.holeCount");
    if (!Number.isInteger(m.layer) || !Number.isInteger(m.holeCount))
      throw new Error("板の段と穴数は整数です");
    const a = design.nodes.find((n) => n.id === m.start);
    const b = design.nodes.find((n) => n.id === m.end);
    if (!a || !b || Math.hypot(...a.position.map((v, i) => v - b.position[i])) < 1e-4)
      throw new Error("部材長がゼロです");
    if (
      m.kind === "female" &&
      Math.hypot(...a.position.map((v, i) => v - b.position[i])) / (m.holeCount - 1) <=
        design.geometry.holeSize * 1.05
    )
      throw new Error("雌材の穴が重なります。穴数を減らすか部材を長くしてください");
    if (design.version === 6) {
      if (typeof m.catalogId !== "string") throw new Error("図面の部材規格を選んでください");
      const part = catalogPart(m.catalogId);
      if (
        m.kind !== part.kind ||
        Math.abs(Math.hypot(...a.position.map((v, i) => v - b.position[i])) - part.span) > 1e-6 ||
        m.holeCount !== (part.kind === "female" ? part.holes.length : 2)
      )
        throw new Error(`図面規格 ${part.label} の長さ・穴数・種類を維持してください`);
    }
    const edge = [m.start, m.end].sort().join(":");
    const seat = m.kind === "female" ? `${edge}:female:${m.layer}` : `${edge}:male`;
    if (
      edgeSet.has(seat) ||
      (edgeKinds.has(edge) && !(edgeKinds.get(edge) === "female" && m.kind === "female"))
    )
      throw new Error("同じ節点・段の部材が重複しています");
    edgeSet.add(seat);
    edgeKinds.set(edge, m.kind);
  }
  for (const r of design.ropes) {
    keys(object(r, "rope"), ["id", "route", "stiffness", "prestrain", "slack", "windingMember"], "rope");
    if (
      !Array.isArray(r.route) ||
      r.route.length !== 4 ||
      new Set(r.route).size !== 4 ||
      r.route.some((n) => !nodes.has(n))
    )
      throw new Error("ロープ経路が不正です");
    number(r.stiffness, 0.01, 1e5, "rope stiffness");
    number(r.prestrain, 0, 0.02, "prestrain");
    number(r.slack, 0, 0.2, "slack");
    const winding = design.members.find((m) => m.id === r.windingMember);
    const side = design.members.find(
      (m) => [m.start, m.end].sort().join(":") === [r.route[1], r.route[2]].sort().join(":"),
    );
    if (
      winding?.kind !== "male" ||
      [winding.start, winding.end].sort().join(":") !== [r.route[0], r.route[3]].sort().join(":") ||
      !side ||
      side.kind !== "male"
    )
      throw new Error("ロープは対向する雄材間に掛け、開始・終端を巻き取り雄材に接続してください");
    for (let i = 0; i < 3; i++) {
      const a = design.nodes.find((n) => n.id === r.route[i]);
      const b = design.nodes.find((n) => n.id === r.route[i + 1]);
      if (!a || !b || Math.hypot(...a.position.map((v, j) => v - b.position[j])) < 1e-4)
        throw new Error("ロープ区間長がゼロです");
    }
  }
  for (let i = 0; i < design.ropes.length; i++)
    for (let j = i + 1; j < design.ropes.length; j++) {
      const a = design.ropes[i];
      const b = design.ropes[j];
      const side = (r: Rope) =>
        design.members.find(
          (m) =>
            m.kind === "male" &&
            [m.start, m.end].sort().join(":") === [r.route[1], r.route[2]].sort().join(":"),
        )?.id;
      if (a.windingMember === b.windingMember || a.windingMember === side(b) || b.windingMember === side(a))
        throw new Error("巻き取り用の雄材は専用です。他のロープの固定には使用できません");
    }
  const connectionSeats = new Set<string>();
  for (const c of design.connections) {
    keys(object(c, "connection"), ["id", "male", "female", "end", "hole", "seat"], "connection");
    const male = design.members.find((m) => m.id === c.male && m.kind === "male");
    const female = design.members.find((m) => m.id === c.female && m.kind === "female");
    if (!male || !female || !["start", "end"].includes(c.end)) throw new Error("穴接続の参照が不正です");
    number(c.hole, 0, female.holeCount - 1, "connection.hole");
    number(c.seat, 0, 3, "connection.seat");
    if (!Number.isInteger(c.hole) || !Number.isInteger(c.seat)) throw new Error("穴と段は整数です");
    const key = `${c.female}:${c.hole}`;
    if (connectionSeats.has(key)) throw new Error("同じ穴への接続が重複しています");
    connectionSeats.add(key);
    holeSite(design, c.female, c.hole);
  }
  for (const male of design.members.filter((m) => design.connections.some((c) => c.male === m.id))) {
    const start = design.nodes.find((n) => n.id === male.start);
    const end = design.nodes.find((n) => n.id === male.end);
    if (!start || !end) throw new Error("雄材の節点がありません");
    const expected = matchingShaftHoles(design, start.position, end.position, male.id);
    const actual = design.connections.filter((c) => c.male === male.id);
    if (
      actual.length !== expected.length ||
      expected.some(
        (e) =>
          !actual.some(
            (a) => a.female === e.female && a.hole === e.hole && a.end === e.end && a.seat === e.seat,
          ),
      )
    )
      throw new Error("雄材のシャフトと雌材の穴の接続が一致しません。穴に垂直にスナップしてください");
  }
  if (
    design.version === 6 &&
    design.rings.length &&
    tenonOuterRadius(design.geometry) > design.geometry.holeSize / 2
  )
    throw new Error("凸部の角丸Rが小さく、丸材の丸穴に入りません");
  const seats = new Set<string>();
  for (const r of design.rings) {
    keys(object(r, "ring"), ["id", "member", "end", "slot", "role"], "ring");
    const host = design.members.find((m) => m.id === r.member);
    if (host?.kind !== "male" || !["start", "end"].includes(r.end) || r.role !== "spacer-unmodeled")
      throw new Error("丸材は雄材の差し込み部にはめてください");
    number(r.slot, 0, 8, "ring.slot");
    if (!Number.isInteger(r.slot) || r.slot >= ASSEMBLY_SLOTS)
      throw new Error("先端の1枚分はロープ用です。丸材は0〜3段まで（凸部の長さ5枚分）です");
    const seat = `${r.member}:${r.end}:${r.slot}`;
    if (seats.has(seat)) throw new Error("同じ位置に丸材が重複しています");
    seats.add(seat);
    const node = host[r.end];
    if (design.connections.some((c) => c.male === r.member && c.end === r.end && c.seat === r.slot))
      throw new Error("丸材が穴で接続した雌材の段と重なります");
    if (
      design.members.some(
        (m) => m.kind === "female" && (m.start === node || m.end === node) && m.layer === r.slot,
      )
    )
      throw new Error("丸材が雌材の段と重なります。空いている段を選んでください");
  }
  validateMemberCollisions(design);
  const a = object(d.analysis, "analysis");
  keys(
    a,
    [
      "loadNode",
      "direction",
      "force",
      "torque",
      "gravity",
      "baseAcceleration",
      "frequency",
      "duration",
      "damping",
      "timeStep",
      "excitationStop",
    ],
    "analysis",
  );
  if (!nodes.has(String(a.loadNode)) || !["x", "y", "z"].includes(String(a.direction)))
    throw new Error("荷重点または方向が不正です");
  for (const key of ["force", "torque"]) {
    number(a[key], -2, 2, key);
  }
  number(a.gravity, 0, 2, "gravity");
  number(a.baseAcceleration, 0, 2, "baseAcceleration");
  number(a.frequency, 0.05, 5, "frequency");
  number(a.duration, 1, 12, "duration");
  number(a.damping, 0.001, 0.3, "damping");
  number(a.timeStep, 1 / 240, 1 / 60, "timeStep");
  number(a.excitationStop, 0.1, Number(a.duration), "excitationStop");
  const view = object(d.view, "view");
  keys(view, ["deformationScale"], "view");
  number(view.deformationScale, 1, 100, "deformationScale");
}
export function serializeDesign(design: Design): string {
  validateDesign(design);
  return `${JSON.stringify(design, null, 2)}\n`;
}
export function migrateDesignV1(value: unknown): unknown {
  const old = object(value, "design");
  if (old.version !== 1) return value;
  keys(
    old,
    [
      "format",
      "version",
      "solver",
      "units",
      "name",
      "notes",
      "jointModel",
      "nodes",
      "members",
      "materials",
      "ropes",
      "rings",
      "analysis",
      "view",
    ],
    "legacy design",
  );
  if (old.solver !== "frame3d-linear-v1" || !Array.isArray(old.members) || !Array.isArray(old.rings))
    throw new Error("v1の解析モデルまたは部材が不正です");
  const members: Record<string, unknown>[] = old.members.map((item) => {
    const m = object(item, "legacy member");
    keys(m, ["id", "kind", "start", "end", "material"], "legacy member");
    return { ...m, roll: 0, layer: 0, holeCount: 7 };
  });
  const rings = old.rings.map((item) => {
    const r = object(item, "legacy ring");
    keys(r, ["id", "node", "role"], "legacy ring");
    if (r.role !== "spacer-unmodeled") throw new Error("v1丸材の役割が不正です");
    const host = members.find((m) => m.kind === "male" && (m.start === r.node || m.end === r.node));
    if (!host) throw new Error("v1の丸材に対応する雄材がありません。配置を修正してください");
    const end = host.start === r.node ? "start" : "end";
    return { id: r.id, member: host.id, end, slot: 1, role: r.role };
  });
  return {
    ...old,
    version: 2,
    solver: "frame3d-linear-v2",
    geometry: { ...DEFAULT_GEOMETRY },
    members,
    rings,
  };
}
export function parseDesign(text: string): Design {
  if (text.length > 1_000_000) throw new Error("設計ファイルは1 MB以下にしてください");
  let value: unknown = migrateDesignV1(JSON.parse(text));
  const old = object(value, "design");
  if (old.version === 2) {
    if (old.solver !== "frame3d-linear-v2") throw new Error("未対応の旧解析モデルです");
    const geometry = object(old.geometry, "geometry");
    if (typeof geometry.thickness !== "number" || !Number.isFinite(geometry.thickness))
      throw new Error("旧形式の板厚が不正です");
    value = {
      ...old,
      version: 3,
      solver: "frame3d-linear-v3",
      geometry: { ...geometry, tenonLength: geometry.thickness * TENON_THICKNESS_UNITS },
    };
  }
  const previous = object(value, "design");
  if (previous.version === 3) {
    if (previous.solver !== "frame3d-linear-v3") throw new Error("未対応の旧解析モデルです");
    value = { ...previous, version: 4, solver: "frame3d-linear-v4", connections: [] };
  }
  const fourth = object(value, "design");
  if (fourth.version === 4) {
    if (fourth.solver !== "frame3d-linear-v4" || fourth.jointModel !== "rigid-approximation")
      throw new Error("未対応の旧解析モデルです");
    // v4 had only rigid joints. Keep that model so earlier results stay reproducible.
    value = {
      ...fourth,
      version: 5,
      solver: "frame3d-contact-v5",
      joint: { ...DEFAULT_JOINT },
      ropeWrap: "sliding",
    };
  }
  validateDesign(value);
  return value;
}

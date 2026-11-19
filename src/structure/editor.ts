import { type Design, parseDesign, serializeDesign, type Vec3 } from "./design";
import { insertionPreview } from "./holes";
import { nextOuterLayer } from "./seats";
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
) {
  if (!Number.isFinite(length) || length < 0.2 || length > 4) throw new Error("追加する長さ比は0.2〜4です");
  const start = design.nodes.find((n) => n.id === nodeId);
  if (!start) throw new Error("始点を選択してください");
  const position = start.position.map((v, i) => Math.round((v + direction[i] * length) * 1e6) / 1e6) as Vec3;
  let end = design.nodes.find((n) => Math.hypot(...n.position.map((v, i) => v - position[i])) < 1e-6);
  const layer = kind === "female" ? nextOuterLayer(design, end ? [start.id, end.id] : [start.id]) : 0;
  if (!end) {
    end = { id: nextId(design, "n"), position, fixed: false };
    design.nodes.push(end);
  }
  const memberId = nextId(design, "m");
  design.members.push({
    id: memberId,
    kind,
    start: start.id,
    end: end.id,
    material: design.materials[0].id,
    roll: kind === "female" ? 90 : 0,
    layer,
    holeCount: Math.max(2, Math.min(7, Math.floor(length / (design.geometry.holeSize * 1.5)) + 1)),
  });
  return { memberId, nodeId: end.id };
}
export function extendBay(design: Design, depth: number) {
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
  });
  for (const connection of preview.connections)
    design.connections.push({ id: nextId(design, "joint"), male: memberId, ...connection });
  return { memberId, nodeId: endId, connected: preview.connections.length };
}

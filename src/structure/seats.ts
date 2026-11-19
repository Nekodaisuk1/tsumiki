import type { Design } from "./design";
export const TENON_THICKNESS_UNITS = 5;
export const ROPE_RESERVED_SLOTS = 1;
export const ASSEMBLY_SLOTS = TENON_THICKNESS_UNITS - ROPE_RESERVED_SLOTS;

export function nextOuterLayer(design: Design, nodeIds: string[]): number {
  let outer = -1;
  for (const member of design.members) {
    if (member.kind === "female" && nodeIds.some((id) => member.start === id || member.end === id)) {
      outer = Math.max(outer, member.layer);
    }
  }
  for (const ring of design.rings) {
    const host = design.members.find((m) => m.id === ring.member);
    if (host && nodeIds.includes(host[ring.end])) outer = Math.max(outer, ring.slot);
  }
  for (const c of design.connections) {
    const host = design.members.find((m) => m.id === c.male);
    if (host && nodeIds.includes(host[c.end])) outer = Math.max(outer, c.seat);
  }
  const layer = outer + 1;
  if (layer >= ASSEMBLY_SLOTS) {
    throw new Error("先端の1枚分はロープ用です。雌材・丸材は4枚分までのため、これ以上外側へ追加できません");
  }
  return layer;
}

import type { Design } from "./design";
import { memberSolidPoints } from "./drawing-collision";

/** Parts whose solid reaches within this of the lowest point stand on the floor. */
const FLOOR_TOLERANCE = 0.001;

/**
 * Supports a drawing design where it stands on the floor, replacing every node's `fixed` flag. The floor
 * is the lowest point of all member solids; a member reaching it is held at its lower end node, or at both
 * ends when they are equally low (a board or male lying on the floor). A load point that ends up fixed or
 * missing moves to the highest free node. Legacy designs keep their saved supports.
 */
export function autoSupports(design: Design): { fixed: string[]; loadNode: string } {
  if (design.version !== 6)
    return {
      fixed: design.nodes.filter((n) => n.fixed).map((n) => n.id),
      loadNode: design.analysis.loadNode,
    };
  const y = (id: string) => design.nodes.find((n) => n.id === id)?.position[1] ?? Number.POSITIVE_INFINITY;
  const lowest = new Map(
    design.members.map((m) => [m.id, Math.min(...memberSolidPoints(design, m).map((p) => p.y))]),
  );
  const floor = Math.min(...lowest.values());
  const fixed = new Set<string>();
  for (const m of design.members) {
    if ((lowest.get(m.id) ?? Number.POSITIVE_INFINITY) > floor + FLOOR_TOLERANCE) continue;
    const [a, b] = [y(m.start), y(m.end)];
    if (Math.abs(a - b) < FLOOR_TOLERANCE) {
      fixed.add(m.start);
      fixed.add(m.end);
    } else fixed.add(a < b ? m.start : m.end);
  }
  for (const n of design.nodes) n.fixed = fixed.has(n.id);
  const load = design.nodes.find((n) => n.id === design.analysis.loadNode);
  if (!load || load.fixed) {
    const free = design.nodes.filter((n) => !n.fixed);
    const highest = free.reduce<(typeof free)[number] | undefined>(
      (best, n) => (!best || n.position[1] >= best.position[1] ? n : best),
      undefined,
    );
    if (highest) design.analysis.loadNode = highest.id;
  }
  return { fixed: [...fixed], loadNode: design.analysis.loadNode };
}

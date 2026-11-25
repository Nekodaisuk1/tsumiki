import { expect, it } from "vitest";
import { analyzeAssembly } from "../src/structure/assembly";
import { parseDesign } from "../src/structure/design";
import bridge from "./fixtures/assembly-bridge.json";

it("assembles all 45 bridge members with explicit temporary support", () => {
  const design = parseDesign(JSON.stringify(bridge));
  const before = JSON.stringify(design);
  const plan = analyzeAssembly(design);
  expect(plan.complete).toBe(true);
  expect(plan.limited).toBe(false);
  expect(new Set(plan.steps.map((s) => s.id)).size).toBe(45);
  expect(plan.steps.map((s) => s.number)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
  expect(plan.steps.some((s) => s.temporarySupport)).toBe(true);
  const installed = new Set<string>();
  for (const step of plan.steps) {
    if (step.kind === "male") {
      const ends = new Set(
        design.connections.filter((c) => c.male === step.id && installed.has(c.female)).map((c) => c.end),
      );
      expect(ends.size).toBeLessThanOrEqual(1);
    }
    installed.add(step.id);
    for (const id of step.supportIds ?? []) expect(installed.has(id)).toBe(true);
    if (step.temporarySupport) {
      expect(step.instruction).toContain("仮支え");
      expect(step.supportIds).toContain(step.id);
    }
  }
  expect(plan.steps.at(-1)?.supportIds).toEqual([]);
  expect(JSON.stringify(design)).toBe(before);
}, 20000);

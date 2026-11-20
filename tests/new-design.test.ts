import { describe, expect, it } from "vitest";
import { parseDesign, serializeDesign } from "../src/structure/design";
import { appendMember, createSeedDesign, femaleDirections, insertMaleAtHole } from "../src/structure/editor";
import { insertionPreview } from "../src/structure/holes";

describe("building from scratch", () => {
  it("starts from one supported upright female board whose holes take a male toward +Z", () => {
    const seed = createSeedDesign();
    expect(seed.nodes).toHaveLength(2);
    expect(seed.members).toHaveLength(1);
    expect(seed.members[0].kind).toBe("female");
    expect(seed.nodes.every((n) => n.fixed)).toBe(true);
    const preview = insertionPreview(seed, "m0", 3, 1.2, 1);
    expect(seed.members[0].roll).toBe(0);
    expect(preview.end[2]).toBeGreaterThan(preview.start[2]);
    expect(Math.abs(preview.end[0] - preview.start[0])).toBeLessThan(1e-9);
    expect(Math.abs(preview.end[1] - preview.start[1])).toBeLessThan(1e-9);
  });

  it("offers female directions perpendicular to the male shaft and snaps to nodes ahead", () => {
    const design = createSeedDesign();
    const { nodeId } = insertMaleAtHole(design, "m0", 3, 1.2, 1);
    const options = femaleDirections(design, nodeId);
    const blocked = options.filter((o) => o.blocked).map((o) => o.direction);
    expect(blocked.sort()).toEqual(["-z", "z"]);
    expect(options.find((o) => o.direction === "x")?.target).toBeUndefined();

    const added = appendMember(design, nodeId, "female", [1, 0, 0], 1);
    const valid = parseDesign(serializeDesign(design));
    expect(valid.members.find((m) => m.id === added.memberId)?.kind).toBe("female");
    expect(valid.connections.some((c) => c.female === added.memberId && c.hole === 0)).toBe(true);
    const back = femaleDirections(valid, added.nodeId).find((o) => o.direction === "-x");
    expect(back?.target).toEqual({ node: nodeId, length: 1 });
  });

  it("rejects an unknown anchor", () => {
    expect(() => femaleDirections(createSeedDesign(), "missing")).toThrow("起点");
  });
});

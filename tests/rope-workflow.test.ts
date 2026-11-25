import { expect, it } from "vitest";
import { createDesign, serializeDesign } from "../src/structure/design";
import { detectRopeFrames, ropeAttachments, routeForWinder, windingUnavailable } from "../src/structure/rope";

it("places rope on the outermost reserved thickness on all four tenons", () => {
  const d = createDesign();
  for (const rope of d.ropes)
    for (const a of ropeAttachments(d, rope))
      expect(Math.hypot(...a.offset) / d.geometry.thickness).toBeCloseTo(4.5);
});
it("detects supported opposite-male frames and routes either selected winder", () => {
  const d = createDesign();
  const frames = detectRopeFrames(d);
  expect(frames).toHaveLength(4);
  for (const frame of frames)
    for (const winder of frame.males) {
      const single = structuredClone(d);
      single.ropes = [{ ...d.ropes[0], route: routeForWinder(frame, winder), windingMember: winder }];
      expect(() => serializeDesign(single)).not.toThrow();
    }
});
it("rejects reusing a winding male for another rope anchor", () => {
  const d = createDesign();
  const frame = detectRopeFrames(d)[0];
  const duplicate = {
    ...d.ropes[0],
    id: "duplicate",
    route: routeForWinder(frame, frame.males[1]),
    windingMember: frame.males[1],
  };
  d.ropes.push(duplicate);
  expect(() => serializeDesign(d)).toThrow(/専用|他のロープ/);
  expect(windingUnavailable(d, frame, frame.males[0], duplicate.id)).toContain("使用");
});

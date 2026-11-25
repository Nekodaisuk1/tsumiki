import { describe, expect, it } from "vitest";
import { clampSize, parseLayout } from "../src/layout";

describe("pane layout", () => {
  it("clamps sizes into the available room", () => {
    expect(clampSize(500, 240, 800)).toBe(500);
    expect(clampSize(100, 240, 800)).toBe(240);
    expect(clampSize(900.4, 240, 800)).toBe(800);
  });

  it("keeps the minimum when the room is smaller than it", () => {
    expect(clampSize(400, 240, 120)).toBe(240);
  });

  it("reads only known, finite, positive sizes", () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout('{"side":420,"time":-1,"outliner":"80","extra":5}')).toEqual({ side: 420 });
    expect(parseLayout('{"side":1e999}')).toEqual({});
  });

  it("rejects stored data that is not an object", () => {
    expect(() => parseLayout("[1,2]")).toThrow();
    expect(() => parseLayout("not json")).toThrow();
  });
});

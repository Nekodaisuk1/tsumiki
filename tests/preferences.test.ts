import { describe, expect, it } from "vitest";
import { defaults, parsePreferences } from "../src/preferences";
import { createDrawingDesign, DesignHistory } from "../src/structure/editor";

describe("preferences validation", () => {
  it("upgrades partial settings without mutating defaults", () => {
    expect(parsePreferences('{"theme":"light"}')).toEqual({ ...defaults, theme: "light" });
    expect(defaults.theme).toBe("dark");
  });
  it.each([
    "null",
    "[]",
    '{"theme":"unknown"}',
    '{"palette":"unknown"}',
    '{"layerLabels":"true"}',
    '{"autosave":"false"}',
    '{"zoomSpeed":0}',
    '{"panSpeed":4}',
    '{"undoLimit":999}',
  ])("rejects invalid preferences: %s", (raw) => {
    expect(() => parsePreferences(raw)).toThrow();
  });
  it("bounds undo history while preserving the newest edits", () => {
    const history = new DesignHistory();
    history.setLimit(20);
    let design = createDrawingDesign();
    for (let i = 0; i < 25; i++) {
      const next = structuredClone(design);
      next.name = `Design ${i}`;
      history.push(design, next);
      design = next;
    }
    let count = 0;
    while (history.canUndo) {
      design = history.undo(design);
      count++;
    }
    expect(count).toBe(20);
    expect(design.name).toBe("Design 4");
    expect(history.redo(design).name).toBe("Design 5");
  });
});

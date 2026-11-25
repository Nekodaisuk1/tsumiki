import { Vector3 } from "three";
import { afterEach, expect, it, vi } from "vitest";
import * as solids from "../src/structure/drawing-collision";
import { createDrawingDesign } from "../src/structure/editor";
import { floorContacts } from "../src/structure/floor-contact";

afterEach(() => vi.restoreAllMocks());

it("finds floor contacts in a solid vertex cloud larger than the JS argument limit", () => {
  const design = createDrawingDesign();
  const length = design.nodes[1].position[0];
  const corners = [new Vector3(0, -0.05, 0), new Vector3(length, -0.05, 0.03), new Vector3(0, 0.05, 0)];
  vi.spyOn(solids, "memberSolidPoints").mockReturnValue(
    Array.from({ length: 300000 }, (_, i) => corners[i % 3]),
  );
  const result = floorContacts(
    design,
    design.nodes.map((n) => n.position),
  );
  expect(result.floorY).toBe(-0.05);
  expect(result.contacts).toHaveLength(2);
  expect(result.contacts.map((c) => c.node)).toEqual([0, 1]);
});

/**
 * Unit tests for lib/model-analysis.ts. Pure-function tests — no Blockbench
 * runtime needed.
 *
 * Run:    bun test lib/model-analysis.test.ts
 */
import { test, expect, describe } from "bun:test";
import {
  diffModelStructure,
  normalizeRect,
  rectArea,
  rectOverlapArea,
  findUvOverlaps,
  listUvIslands,
  uvDensityPerFace,
  type StructDump,
  type UvFace,
} from "./model-analysis";

// --------------------------------------------------------------------------- //
// diffModelStructure
// --------------------------------------------------------------------------- //

describe("diffModelStructure", () => {
  const before: StructDump = {
    groups: [{ uuid: "g1", name: "arm", parent: null }],
    elements: [
      { uuid: "e1", name: "cube_a", parent: "arm", faces: { north: { uv: [0, 0, 4, 4] } } },
      { uuid: "e2", name: "cube_b", parent: "arm" },
      { uuid: "e3", name: "gone", parent: "arm" },
    ],
  };

  test("detects added / removed elements", () => {
    const after: StructDump = {
      groups: before.groups,
      elements: [
        before.elements![0],
        before.elements![1],
        { uuid: "e4", name: "new_cube", parent: "arm" },
      ],
    };
    const d = diffModelStructure(before, after);
    expect(d.elements.added.map((x) => x.uuid)).toEqual(["e4"]);
    expect(d.elements.removed.map((x) => x.uuid)).toEqual(["e3"]);
  });

  test("detects rename and reparent", () => {
    const after: StructDump = {
      groups: [{ uuid: "g1", name: "arm", parent: null }],
      elements: [
        { uuid: "e1", name: "cube_a", parent: "arm", faces: { north: { uv: [0, 0, 4, 4] } } },
        { uuid: "e2", name: "cube_b_renamed", parent: "hand" },
        { uuid: "e3", name: "gone", parent: "arm" },
      ],
    };
    const d = diffModelStructure(before, after);
    expect(d.elements.renamed).toEqual([{ uuid: "e2", from: "cube_b", to: "cube_b_renamed" }]);
    expect(d.elements.reparented).toEqual([
      { uuid: "e2", name: "cube_b_renamed", from: "arm", to: "hand" },
    ]);
  });

  test("detects per-face UV change", () => {
    const after: StructDump = {
      groups: before.groups,
      elements: [
        { uuid: "e1", name: "cube_a", parent: "arm", faces: { north: { uv: [0, 0, 8, 8] } } },
        before.elements![1],
        before.elements![2],
      ],
    };
    const d = diffModelStructure(before, after);
    expect(d.elements.uv_changed).toEqual([{ uuid: "e1", name: "cube_a", faces: ["north"] }]);
  });

  test("identical dumps produce empty diff", () => {
    const d = diffModelStructure(before, before);
    expect(d.summary.elements_added).toBe(0);
    expect(d.summary.elements_removed).toBe(0);
    expect(d.summary.elements_uv_changed).toBe(0);
  });
});

// --------------------------------------------------------------------------- //
// UV geometry primitives
// --------------------------------------------------------------------------- //

describe("rect helpers", () => {
  test("normalizeRect flips inverted coords", () => {
    expect(normalizeRect([4, 4, 0, 0])).toEqual([0, 0, 4, 4]);
  });
  test("rectArea", () => {
    expect(rectArea([0, 0, 4, 2])).toBe(8);
  });
  test("rectOverlapArea — overlapping", () => {
    expect(rectOverlapArea([0, 0, 4, 4], [2, 2, 6, 6])).toBe(4);
  });
  test("rectOverlapArea — disjoint is 0", () => {
    expect(rectOverlapArea([0, 0, 2, 2], [5, 5, 7, 7])).toBe(0);
  });
  test("rectOverlapArea — edge-touching is 0", () => {
    expect(rectOverlapArea([0, 0, 2, 2], [2, 0, 4, 2])).toBe(0);
  });
});

// --------------------------------------------------------------------------- //
// findUvOverlaps
// --------------------------------------------------------------------------- //

describe("findUvOverlaps", () => {
  test("reports overlapping pair with area", () => {
    const faces: UvFace[] = [
      { id: "a", rect: [0, 0, 4, 4] },
      { id: "b", rect: [2, 2, 6, 6] },
      { id: "c", rect: [10, 10, 12, 12] },
    ];
    const overlaps = findUvOverlaps(faces);
    expect(overlaps).toEqual([{ a: "a", b: "b", area: 4 }]);
  });

  test("non-overlapping atlas yields none", () => {
    const faces: UvFace[] = [
      { id: "a", rect: [0, 0, 4, 4] },
      { id: "b", rect: [4, 0, 8, 4] },
    ];
    expect(findUvOverlaps(faces)).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
// listUvIslands
// --------------------------------------------------------------------------- //

describe("listUvIslands", () => {
  test("separates disjoint islands and merges touching faces", () => {
    const faces: UvFace[] = [
      { id: "a", rect: [0, 0, 2, 2] },
      { id: "b", rect: [2, 0, 4, 2] }, // touches a
      { id: "c", rect: [20, 20, 24, 24] }, // far away
    ];
    const islands = listUvIslands(faces);
    expect(islands.length).toBe(2);
    expect(islands[0].faces.sort()).toEqual(["a", "b"]);
    expect(islands[0].bounds).toEqual([0, 0, 4, 2]);
    expect(islands[1].faces).toEqual(["c"]);
  });
});

// --------------------------------------------------------------------------- //
// uvDensityPerFace
// --------------------------------------------------------------------------- //

describe("uvDensityPerFace", () => {
  test("pixel area and atlas fraction", () => {
    const out = uvDensityPerFace([{ id: "a", rect: [0, 0, 16, 16] }], 256, 256);
    expect(out[0].uv_pixel_area).toBe(256);
    expect(out[0].atlas_fraction).toBeCloseTo(256 / 65536, 8);
    expect(out[0].texels_per_unit2).toBeUndefined();
  });
  test("texels_per_unit2 when worldArea given", () => {
    const out = uvDensityPerFace([{ id: "a", rect: [0, 0, 16, 16], worldArea: 64 }], 256, 256);
    expect(out[0].texels_per_unit2).toBe(4);
  });
});

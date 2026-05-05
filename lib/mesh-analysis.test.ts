/**
 * Unit tests for lib/mesh-analysis.ts. Pure-function tests — no Blockbench
 * runtime needed.
 *
 * Run:    bun test
 *         bun test lib/mesh-analysis.test.ts
 */
import { test, expect, describe } from "bun:test";
import {
  triangleArea,
  faceArea,
  edgeKey,
  faceEdges,
  buildEdgeAdjacency,
  findBoundaryEdges,
  findNonManifoldEdges,
  findDuplicateVertices,
  findUnusedVertices,
  boundingBox,
  connectedFaces,
  type FaceDict,
  type VertexDict,
} from "./mesh-analysis";

// --------------------------------------------------------------------------- //
// Triangle / face area
// --------------------------------------------------------------------------- //

describe("triangleArea", () => {
  test("right triangle (1,1)", () => {
    expect(triangleArea([0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeCloseTo(0.5, 10);
  });

  test("collinear points → 0", () => {
    expect(triangleArea([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBe(0);
  });

  test("axis-aligned in YZ plane", () => {
    expect(triangleArea([0, 0, 0], [0, 2, 0], [0, 0, 2])).toBeCloseTo(2, 10);
  });

  test("3-4-5 triangle has area 6", () => {
    expect(triangleArea([0, 0, 0], [3, 0, 0], [0, 4, 0])).toBeCloseTo(6, 10);
  });
});

describe("faceArea", () => {
  test("triangle delegates to triangleArea", () => {
    expect(faceArea([[0, 0, 0], [1, 0, 0], [0, 1, 0]])).toBeCloseTo(0.5, 10);
  });

  test("unit-square quad", () => {
    expect(
      faceArea([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]])
    ).toBeCloseTo(1, 10);
  });

  test("degenerate (2 verts) → 0", () => {
    expect(faceArea([[0, 0, 0], [1, 0, 0]])).toBe(0);
  });

  test("collapsed quad (all coincident) → 0", () => {
    expect(
      faceArea([[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]])
    ).toBe(0);
  });
});

// --------------------------------------------------------------------------- //
// Edge keys / adjacency
// --------------------------------------------------------------------------- //

describe("edgeKey", () => {
  test("orders endpoints lexicographically", () => {
    expect(edgeKey("b", "a")).toBe("a-b");
    expect(edgeKey("a", "b")).toBe("a-b");
  });

  test("self-loop preserves identity", () => {
    expect(edgeKey("a", "a")).toBe("a-a");
  });
});

describe("faceEdges", () => {
  test("triangle yields 3 edges, last loops to first", () => {
    const e = faceEdges(["a", "b", "c"]);
    expect(e).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
  });

  test("quad yields 4 edges", () => {
    expect(faceEdges(["a", "b", "c", "d"])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
    ]);
  });
});

describe("buildEdgeAdjacency", () => {
  test("two adjacent triangles share one edge", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["b", "d", "c"] },
    };
    const adj = buildEdgeAdjacency(faces);
    // shared edge b-c → both faces
    expect(adj.get(edgeKey("b", "c"))?.sort()).toEqual(["f1", "f2"]);
    // unshared edges → one face each
    expect(adj.get(edgeKey("a", "b"))).toEqual(["f1"]);
    expect(adj.get(edgeKey("a", "c"))).toEqual(["f1"]);
    expect(adj.get(edgeKey("b", "d"))).toEqual(["f2"]);
    expect(adj.get(edgeKey("c", "d"))).toEqual(["f2"]);
  });
});

// --------------------------------------------------------------------------- //
// Boundary / non-manifold
// --------------------------------------------------------------------------- //

describe("findBoundaryEdges", () => {
  test("single triangle → all 3 edges are boundary", () => {
    const faces: FaceDict = { f1: { vertices: ["a", "b", "c"] } };
    const adj = buildEdgeAdjacency(faces);
    expect(findBoundaryEdges(adj)).toHaveLength(3);
  });

  test("closed tetrahedron-ish (2 triangles sharing one edge) → 4 boundary edges", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["b", "d", "c"] },
    };
    const adj = buildEdgeAdjacency(faces);
    expect(findBoundaryEdges(adj)).toHaveLength(4); // a-b, a-c, b-d, c-d
  });
});

describe("findNonManifoldEdges", () => {
  test("3 faces sharing one edge → 1 non-manifold edge", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["a", "b", "d"] },
      f3: { vertices: ["a", "b", "e"] },
    };
    const adj = buildEdgeAdjacency(faces);
    const nm = findNonManifoldEdges(adj);
    expect(nm).toHaveLength(1);
    expect(nm[0].face_count).toBe(3);
  });

  test("manifold mesh has 0 non-manifold edges", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["b", "d", "c"] },
    };
    expect(findNonManifoldEdges(buildEdgeAdjacency(faces))).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------- //
// Duplicate-vertex detection (spatial hash)
// --------------------------------------------------------------------------- //

describe("findDuplicateVertices", () => {
  test("no duplicates in well-spaced grid", () => {
    const v: VertexDict = {
      a: [0, 0, 0],
      b: [10, 0, 0],
      c: [0, 10, 0],
      d: [0, 0, 10],
    };
    expect(findDuplicateVertices(v, 0.01).pairs).toHaveLength(0);
  });

  test("two coincident vertices reported once", () => {
    const v: VertexDict = {
      a: [0, 0, 0],
      b: [0.0001, 0, 0],
    };
    const r = findDuplicateVertices(v, 0.001);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].distance).toBeCloseTo(0.0001, 7);
  });

  test("vertices outside epsilon are not duplicates", () => {
    const v: VertexDict = {
      a: [0, 0, 0],
      b: [0.5, 0, 0],
    };
    expect(findDuplicateVertices(v, 0.0001).pairs).toHaveLength(0);
  });

  test("cap truncation works", () => {
    // 100 vertices all at origin → C(100,2) = 4950 pairs, capped at 50.
    const v: VertexDict = {};
    for (let i = 0; i < 100; i++) v[`v${i}`] = [0, 0, 0];
    const r = findDuplicateVertices(v, 0.001, 50);
    expect(r.pairs).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });

  test("each pair reported at most once (no a-b AND b-a)", () => {
    const v: VertexDict = {
      x1: [0, 0, 0],
      x2: [0, 0, 0],
      x3: [0, 0, 0],
    };
    const r = findDuplicateVertices(v, 0.001);
    expect(r.pairs).toHaveLength(3); // C(3,2) = 3 unique pairs
  });

  test("spatial-hash works across cell boundaries", () => {
    // Two points close but in different grid cells (cellSize = 2*eps = 0.002).
    // Distance 0.0015 < eps=0.001? No, 0.0015 > 0.001. Use 0.0008 instead.
    const v: VertexDict = {
      a: [0.0009, 0, 0],
      b: [0.0011, 0, 0], // distance 0.0002, cell border at 0.001
    };
    const r = findDuplicateVertices(v, 0.001);
    expect(r.pairs).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------- //
// Bounding box
// --------------------------------------------------------------------------- //

describe("boundingBox", () => {
  test("empty mesh → 0 bbox", () => {
    expect(boundingBox({})).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  test("axis-aligned vertices", () => {
    const v: VertexDict = {
      a: [-1, -2, -3],
      b: [4, 5, 6],
      c: [0, 0, 0],
    };
    expect(boundingBox(v)).toEqual({
      min: [-1, -2, -3],
      max: [4, 5, 6],
    });
  });

  test("single vertex → degenerate bbox", () => {
    const v: VertexDict = { a: [7, 8, 9] };
    expect(boundingBox(v)).toEqual({ min: [7, 8, 9], max: [7, 8, 9] });
  });
});

// --------------------------------------------------------------------------- //
// Unused vertices
// --------------------------------------------------------------------------- //

describe("findUnusedVertices", () => {
  test("vertex referenced by face is not unused", () => {
    const v: VertexDict = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] };
    const f: FaceDict = { f1: { vertices: ["a", "b", "c"] } };
    expect(findUnusedVertices(v, f)).toEqual([]);
  });

  test("orphan vertex returned", () => {
    const v: VertexDict = {
      a: [0, 0, 0],
      b: [1, 0, 0],
      c: [0, 1, 0],
      orphan: [99, 99, 99],
    };
    const f: FaceDict = { f1: { vertices: ["a", "b", "c"] } };
    expect(findUnusedVertices(v, f)).toEqual(["orphan"]);
  });

  test("empty face dict → all vertices unused", () => {
    const v: VertexDict = { a: [0, 0, 0], b: [1, 0, 0] };
    expect(findUnusedVertices(v, {}).sort()).toEqual(["a", "b"]);
  });
});

// --------------------------------------------------------------------------- //
// Connected-faces BFS
// --------------------------------------------------------------------------- //

describe("connectedFaces", () => {
  test("single seed in a chain reaches all", () => {
    // f1-f2-f3 chain via shared edges
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["b", "d", "c"] },
      f3: { vertices: ["d", "e", "c"] },
    };
    expect(connectedFaces(["f1"], faces).sort()).toEqual(["f1", "f2", "f3"]);
  });

  test("disconnected components stay separate", () => {
    const faces: FaceDict = {
      // First component
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["b", "d", "c"] },
      // Second component (no shared verts)
      f3: { vertices: ["x", "y", "z"] },
    };
    expect(connectedFaces(["f1"], faces).sort()).toEqual(["f1", "f2"]);
    expect(connectedFaces(["f3"], faces)).toEqual(["f3"]);
  });

  test("invalid seed dropped, valid seed kept", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
    };
    expect(connectedFaces(["f1", "missing"], faces)).toEqual(["f1"]);
  });

  test("empty seed → empty result", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
    };
    expect(connectedFaces([], faces)).toEqual([]);
  });

  test("two seeds across components find both components", () => {
    const faces: FaceDict = {
      f1: { vertices: ["a", "b", "c"] },
      f2: { vertices: ["x", "y", "z"] },
    };
    expect(connectedFaces(["f1", "f2"], faces).sort()).toEqual(["f1", "f2"]);
  });
});

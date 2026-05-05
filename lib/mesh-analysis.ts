/**
 * Pure mesh-analysis algorithms — extracted so they can be unit-tested
 * without a running Blockbench instance, and reused by future tools.
 *
 * No imports of `bpy`/Blockbench globals. All functions take plain
 * vertex/face dicts and return plain results.
 */

export type Vec3 = [number, number, number];
export type VertexDict = Record<string, Vec3>;
export type FaceDict = Record<string, { vertices: string[] }>;

// ---------------------------------------------------------------------------
// Triangle area (used for zero-area face detection)
// ---------------------------------------------------------------------------

/**
 * Area of the triangle (a, b, c) via half the cross-product magnitude.
 * Robust to non-axis-aligned triangles. Returns 0 for collinear points.
 */
export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    abz = b[2] - a[2];
  const acx = c[0] - a[0],
    acy = c[1] - a[1],
    acz = c[2] - a[2];
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Effective area of an n-gon (3 = tri, 4 = quad). For quads we sum the two
 * fan-triangulated triangles; for higher n we treat the first three vertices.
 * Sub-`epsilon` total area = degenerate.
 */
export function faceArea(verts: Vec3[]): number {
  if (verts.length < 3) return 0;
  let area = triangleArea(verts[0], verts[1], verts[2]);
  if (verts.length === 4) {
    area += triangleArea(verts[0], verts[2], verts[3]);
  }
  return area;
}

// ---------------------------------------------------------------------------
// Edge → face adjacency
// ---------------------------------------------------------------------------

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Returns the [a, b] vertex pairs that bound `face` (treating it as a
 * closed polygon — last vertex connects back to first).
 */
export function faceEdges(faceVerts: string[]): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < faceVerts.length; i++) {
    const a = faceVerts[i];
    const b = faceVerts[(i + 1) % faceVerts.length];
    edges.push([a, b]);
  }
  return edges;
}

/**
 * Build the edge → face[] adjacency map for an entire mesh.
 */
export function buildEdgeAdjacency(
  faces: FaceDict
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const fkey of Object.keys(faces)) {
    for (const [a, b] of faceEdges(faces[fkey].vertices)) {
      const k = edgeKey(a, b);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(fkey);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Topology classification
// ---------------------------------------------------------------------------

/**
 * Edges that bound exactly one face (mesh boundary — open seams).
 */
export function findBoundaryEdges(
  edgeMap: Map<string, string[]>
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, faces] of edgeMap.entries()) {
    if (faces.length === 1) {
      const [a, b] = k.split("-") as [string, string];
      out.push([a, b]);
    }
  }
  return out;
}

/**
 * Edges shared by more than 2 faces — a non-manifold condition that breaks
 * many engines' import paths.
 */
export function findNonManifoldEdges(
  edgeMap: Map<string, string[]>
): Array<{ vkeys: [string, string]; face_count: number }> {
  const out: Array<{ vkeys: [string, string]; face_count: number }> = [];
  for (const [k, faces] of edgeMap.entries()) {
    if (faces.length > 2) {
      const [a, b] = k.split("-") as [string, string];
      out.push({ vkeys: [a, b], face_count: faces.length });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Duplicate-vertex detection (spatial hash, O(n) avg)
// ---------------------------------------------------------------------------

/**
 * Find vertex pairs within `epsilon` distance of each other. Uses a
 * uniform-grid spatial hash so the average complexity is O(n) instead
 * of O(n²) — essential for dense meshes (>1000 verts).
 *
 * Returns up to `cap` pairs (default 50). The truncation flag in the
 * result lets callers know more pairs exist beyond the limit.
 */
export function findDuplicateVertices(
  vertices: VertexDict,
  epsilon: number,
  cap: number = 50
): {
  pairs: Array<{ a: string; b: string; distance: number }>;
  truncated: boolean;
} {
  const pairs: Array<{ a: string; b: string; distance: number }> = [];
  const cellSize = Math.max(epsilon * 2, 1e-12); // avoid division-by-zero

  // Bucket vertices into a uniform 3D grid.
  const grid = new Map<string, string[]>();
  const cellOf = (v: Vec3): [number, number, number] => [
    Math.floor(v[0] / cellSize),
    Math.floor(v[1] / cellSize),
    Math.floor(v[2] / cellSize),
  ];
  for (const vk of Object.keys(vertices)) {
    const [cx, cy, cz] = cellOf(vertices[vk]);
    const key = `${cx},${cy},${cz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(vk);
  }

  // For each vertex, compare only against same/neighboring cells.
  // Skip already-seen pairs by ordering (only compare vk < otherVk).
  const epsSq = epsilon * epsilon;
  outer: for (const vk of Object.keys(vertices)) {
    const v = vertices[vk];
    const [cx, cy, cz] = cellOf(v);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(
            `${cx + dx},${cy + dy},${cz + dz}`
          );
          if (!bucket) continue;
          for (const other of bucket) {
            if (other <= vk) continue; // ordering avoids dup pairs + self
            const o = vertices[other];
            const ddx = v[0] - o[0];
            const ddy = v[1] - o[1];
            const ddz = v[2] - o[2];
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
            if (distSq < epsSq) {
              pairs.push({
                a: vk,
                b: other,
                distance: Math.sqrt(distSq),
              });
              if (pairs.length >= cap) break outer;
            }
          }
        }
      }
    }
  }

  return { pairs, truncated: pairs.length >= cap };
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export function boundingBox(vertices: VertexDict): {
  min: Vec3;
  max: Vec3;
} {
  const keys = Object.keys(vertices);
  if (keys.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const vk of keys) {
    const v = vertices[vk];
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Unused vertices
// ---------------------------------------------------------------------------

/**
 * Vertex keys that no face references.
 */
export function findUnusedVertices(
  vertices: VertexDict,
  faces: FaceDict
): string[] {
  const used = new Set<string>();
  for (const fkey of Object.keys(faces)) {
    for (const vk of faces[fkey].vertices) used.add(vk);
  }
  return Object.keys(vertices).filter((k) => !used.has(k));
}

// ---------------------------------------------------------------------------
// Topology BFS (used by select_mesh_elements topology=connected)
// ---------------------------------------------------------------------------

/**
 * BFS through shared-edge face adjacency starting from `seedFaces`.
 * Returns all face keys reachable through the connected component(s).
 */
export function connectedFaces(
  seedFaces: string[],
  faces: FaceDict,
  edgeMap?: Map<string, string[]>
): string[] {
  const adj = edgeMap ?? buildEdgeAdjacency(faces);
  const visited = new Set<string>(seedFaces.filter((f) => faces[f]));
  if (visited.size === 0) return [];

  const queue = Array.from(visited);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const face = faces[cur];
    if (!face) continue;
    for (const [a, b] of faceEdges(face.vertices)) {
      const neighbours = adj.get(edgeKey(a, b)) ?? [];
      for (const n of neighbours) {
        if (n !== cur && !visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
  }
  return Array.from(visited);
}

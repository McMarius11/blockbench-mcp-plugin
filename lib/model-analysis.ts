/**
 * Pure model-analysis algorithms — no Blockbench coupling, unit-testable.
 *
 * Two families:
 *   - Structural diff (`diffModelStructure`) between two `export_model_structure`
 *     dumps: added / removed / renamed / reparented elements and groups, plus
 *     per-face UV changes.
 *   - UV analysis (`findUvOverlaps`, `listUvIslands`, `uvDensityPerFace`) over a
 *     normalized list of UV rectangles in texture-pixel space.
 *
 * The Blockbench-facing tools in server/tools/analysis.ts gather the raw data
 * and delegate the math here.
 */

// --------------------------------------------------------------------------- //
// Structural diff
// --------------------------------------------------------------------------- //

export interface StructNode {
  uuid: string;
  name: string;
  type?: string;
  parent?: string | null;
  /** Cube per-face uv map: { north: [x0,y0,x1,y1], ... } */
  faces?: Record<string, { uv?: number[] } | undefined>;
}

export interface StructDump {
  groups?: StructNode[];
  elements?: StructNode[];
}

export interface RenameDiff {
  uuid: string;
  from: string;
  to: string;
}

export interface ReparentDiff {
  uuid: string;
  name: string;
  from: string | null;
  to: string | null;
}

export interface UvChangeDiff {
  uuid: string;
  name: string;
  faces: string[];
}

export interface NodeSetDiff {
  added: Array<{ uuid: string; name: string }>;
  removed: Array<{ uuid: string; name: string }>;
  renamed: RenameDiff[];
  reparented: ReparentDiff[];
}

export interface ModelDiff {
  elements: NodeSetDiff & { uv_changed: UvChangeDiff[] };
  groups: NodeSetDiff;
  summary: Record<string, number>;
}

function indexByUuid(nodes: StructNode[] | undefined): Map<string, StructNode> {
  const m = new Map<string, StructNode>();
  for (const n of nodes ?? []) {
    if (n && typeof n.uuid === "string") m.set(n.uuid, n);
  }
  return m;
}

function uvFacesDiffer(
  a: StructNode["faces"],
  b: StructNode["faces"]
): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of keys) {
    const ua = a?.[key]?.uv;
    const ub = b?.[key]?.uv;
    if (!ua && !ub) continue;
    if (!ua || !ub || ua.length !== ub.length) {
      changed.push(key);
      continue;
    }
    if (ua.some((v, i) => Math.abs(v - ub[i]) > 1e-6)) changed.push(key);
  }
  return changed.sort();
}

function diffNodeSet(
  beforeIdx: Map<string, StructNode>,
  afterIdx: Map<string, StructNode>
): NodeSetDiff {
  const added: NodeSetDiff["added"] = [];
  const removed: NodeSetDiff["removed"] = [];
  const renamed: RenameDiff[] = [];
  const reparented: ReparentDiff[] = [];

  for (const [uuid, after] of afterIdx) {
    const before = beforeIdx.get(uuid);
    if (!before) {
      added.push({ uuid, name: after.name });
      continue;
    }
    if (before.name !== after.name) {
      renamed.push({ uuid, from: before.name, to: after.name });
    }
    const bp = before.parent ?? null;
    const ap = after.parent ?? null;
    if (bp !== ap) {
      reparented.push({ uuid, name: after.name, from: bp, to: ap });
    }
  }
  for (const [uuid, before] of beforeIdx) {
    if (!afterIdx.has(uuid)) removed.push({ uuid, name: before.name });
  }

  return { added, removed, renamed, reparented };
}

/** Diff two model structure dumps by element/group UUID. */
export function diffModelStructure(before: StructDump, after: StructDump): ModelDiff {
  const beforeEls = indexByUuid(before.elements);
  const afterEls = indexByUuid(after.elements);
  const beforeGroups = indexByUuid(before.groups);
  const afterGroups = indexByUuid(after.groups);

  const elements = diffNodeSet(beforeEls, afterEls);
  const groups = diffNodeSet(beforeGroups, afterGroups);

  const uv_changed: UvChangeDiff[] = [];
  for (const [uuid, after_] of afterEls) {
    const before_ = beforeEls.get(uuid);
    if (!before_) continue;
    const faces = uvFacesDiffer(before_.faces, after_.faces);
    if (faces.length) uv_changed.push({ uuid, name: after_.name, faces });
  }

  return {
    elements: { ...elements, uv_changed },
    groups,
    summary: {
      elements_added: elements.added.length,
      elements_removed: elements.removed.length,
      elements_renamed: elements.renamed.length,
      elements_reparented: elements.reparented.length,
      elements_uv_changed: uv_changed.length,
      groups_added: groups.added.length,
      groups_removed: groups.removed.length,
      groups_renamed: groups.renamed.length,
      groups_reparented: groups.reparented.length,
    },
  };
}

// --------------------------------------------------------------------------- //
// UV analysis
// --------------------------------------------------------------------------- //

export type UvRect = [number, number, number, number]; // [x0, y0, x1, y1]

export interface UvFace {
  /** Stable identifier, e.g. "<elementName>:<faceKey>". */
  id: string;
  rect: UvRect;
}

/** Normalize a rect so x0<=x1 and y0<=y1. */
export function normalizeRect(rect: UvRect): UvRect {
  return [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ];
}

export function rectArea(rect: UvRect): number {
  const n = normalizeRect(rect);
  return (n[2] - n[0]) * (n[3] - n[1]);
}

/** Area of intersection between two rects (0 if they don't overlap). */
export function rectOverlapArea(a: UvRect, b: UvRect): number {
  const na = normalizeRect(a);
  const nb = normalizeRect(b);
  const ox = Math.max(0, Math.min(na[2], nb[2]) - Math.max(na[0], nb[0]));
  const oy = Math.max(0, Math.min(na[3], nb[3]) - Math.max(na[1], nb[1]));
  return ox * oy;
}

export interface UvOverlap {
  a: string;
  b: string;
  area: number;
}

/**
 * All pairs of faces whose UV rects overlap with positive area. O(n²) — fine
 * for typical model face counts. Degenerate (zero-area) faces are skipped.
 */
export function findUvOverlaps(faces: UvFace[], minArea = 1e-6): UvOverlap[] {
  const out: UvOverlap[] = [];
  for (let i = 0; i < faces.length; i++) {
    if (rectArea(faces[i].rect) <= 0) continue;
    for (let j = i + 1; j < faces.length; j++) {
      const area = rectOverlapArea(faces[i].rect, faces[j].rect);
      if (area > minArea) {
        out.push({ a: faces[i].id, b: faces[j].id, area });
      }
    }
  }
  return out;
}

export interface UvIsland {
  faces: string[];
  bounds: UvRect;
}

/** Whether two rects overlap or touch (shared edge counts as adjacency). */
function rectsAdjacent(a: UvRect, b: UvRect): boolean {
  const na = normalizeRect(a);
  const nb = normalizeRect(b);
  return na[0] <= nb[2] && nb[0] <= na[2] && na[1] <= nb[3] && nb[1] <= na[3];
}

/**
 * Group faces into UV islands — connected components where rects overlap or
 * touch. Returns each island's member ids and combined bounds.
 */
export function listUvIslands(faces: UvFace[]): UvIsland[] {
  const n = faces.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsAdjacent(faces[i].rect, faces[j].rect)) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(i);
  }

  const islands: UvIsland[] = [];
  for (const members of groups.values()) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const idx of members) {
      const r = normalizeRect(faces[idx].rect);
      x0 = Math.min(x0, r[0]);
      y0 = Math.min(y0, r[1]);
      x1 = Math.max(x1, r[2]);
      y1 = Math.max(y1, r[3]);
    }
    islands.push({
      faces: members.map((idx) => faces[idx].id),
      bounds: [x0, y0, x1, y1],
    });
  }
  // Largest islands first.
  islands.sort((a, b) => b.faces.length - a.faces.length);
  return islands;
}

export interface UvDensity {
  id: string;
  uv_pixel_area: number;
  /** Fraction of the whole atlas this face's UV rect covers. */
  atlas_fraction: number;
  /** Texels per world unit² — only present when a positive worldArea is given. */
  texels_per_unit2?: number;
}

/**
 * Per-face UV density. `uv_pixel_area` is the rect area in texture pixels²;
 * `atlas_fraction` is relative to textureWidth×textureHeight. When a face's
 * `worldArea` is supplied (>0), also reports texels-per-world-unit² so callers
 * can spot under/over-resolved faces.
 */
export function uvDensityPerFace(
  faces: Array<UvFace & { worldArea?: number }>,
  textureWidth: number,
  textureHeight: number
): UvDensity[] {
  const atlas = Math.max(1, textureWidth * textureHeight);
  return faces.map((f) => {
    const area = rectArea(f.rect);
    const d: UvDensity = {
      id: f.id,
      uv_pixel_area: area,
      atlas_fraction: area / atlas,
    };
    if (f.worldArea && f.worldArea > 0) {
      d.texels_per_unit2 = area / f.worldArea;
    }
    return d;
  });
}

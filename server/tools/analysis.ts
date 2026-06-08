/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import {
  diffModelStructure,
  findUvOverlaps,
  listUvIslands,
  uvDensityPerFace,
  type StructDump,
  type StructNode,
  type UvFace,
  type UvRect,
} from "@/lib/model-analysis";

// --------------------------------------------------------------------------- //
// Schemas
// --------------------------------------------------------------------------- //

export const compareModelsParameters = z.object({
  before: z
    .string()
    .describe(
      "Baseline model as JSON — an `export_model_structure` dump (string). Diffed against `after`."
    ),
  after: z
    .string()
    .optional()
    .describe(
      "Comparison model as JSON (an `export_model_structure` dump). Omit to diff `before` against the currently open project."
    ),
});

const uvScopeSchema = z.object({
  scope: z
    .enum(["all", "selection", "group"])
    .optional()
    .default("all")
    .describe("Restrict to the whole project, current selection, or a named group's subtree."),
  group: z.string().optional().describe("Group UUID or name — required when scope=group."),
});

export const findUvOverlapsParameters = uvScopeSchema.extend({
  min_area: z
    .number()
    .min(0)
    .optional()
    .default(1)
    .describe("Minimum overlap area (in UV pixels²) to report. Filters out negligible touches."),
});

export const uvIslandListParameters = uvScopeSchema;

export const uvDensityPerFaceParameters = uvScopeSchema.extend({
  limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .default(1000)
    .describe("Maximum number of faces to report."),
});

export const validateRigParameters = z.object({
  checks: z
    .array(z.enum(["limb_pivot", "hand_center", "limb_x_seam", "bone_orphans"]))
    .optional()
    .describe(
      "Which checks to run. Omit to run all applicable. `bone_orphans` runs " +
        "automatically over animated bones; `limb_pivot`/`hand_center` need " +
        "`pairs`; `limb_x_seam` needs `chains`."
    ),
  pairs: z
    .array(
      z.object({
        bone: z.string().describe("Bone/group name or uuid."),
        cube: z.string().describe("Cube name or uuid bound to this bone."),
        kind: z
          .enum(["limb", "hand"])
          .optional()
          .default("limb")
          .describe(
            "`limb`: nearest cube corner must be within `limb_anchor_max` of " +
              "the bone origin. `hand`: cube CENTER must be within " +
              "`hand_bone_center_max` of the bone origin."
          ),
      })
    )
    .optional()
    .describe(
      "Bone↔cube bindings to check (e.g. ARM_BONE_CUBE_PAIRS). Drives " +
        "limb_pivot and hand_center."
    ),
  chains: z
    .array(
      z.object({
        name: z.string().optional().describe("Label for the chain (e.g. 'R_arm')."),
        cubes: z
          .array(z.string())
          .min(2)
          .describe(
            "Ordered cube names/uuids proximal→distal (e.g. [arm, forearm, hand]). Adjacent cubes are checked for a shared Y cross-section at the X seam."
          ),
      })
    )
    .optional()
    .describe("Ordered limb cube chains for the limb_x_seam check."),
  limb_anchor_max: z
    .number()
    .optional()
    .default(0.5)
    .describe("Max distance (BB units) from nearest cube corner to bone origin for limb_pivot."),
  hand_bone_center_max: z
    .number()
    .optional()
    .default(1.25)
    .describe("Max distance (BB units) from cube center to bone origin for hand_center."),
  seam_tolerance: z
    .number()
    .optional()
    .default(0.01)
    .describe("Max allowed mismatch (BB units) in shared Y min/max between adjacent chain cubes."),
});

export const analysisToolDocs: ToolSpec[] = [
  {
    name: "compare_models",
    description:
      "Diffs two model structures (added / removed / renamed / reparented elements and groups, plus per-face UV changes). Pass two `export_model_structure` dumps, or just `before` to diff against the currently open project. Enables regression tracking between build iterations.",
    annotations: { title: "Compare Models", readOnlyHint: true },
    parameters: compareModelsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "find_uv_overlaps",
    description:
      "Finds faces whose UV rectangles overlap on the SAME texture (the classic cause of texture bleed / wrong-face painting). Overlaps across different textures are ignored. Returns overlapping face pairs with overlap area, grouped by texture. Read-only.",
    annotations: { title: "Find UV Overlaps", readOnlyHint: true },
    parameters: findUvOverlapsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "uv_island_list",
    description:
      "Lists UV islands (connected components of overlapping/touching face rects) per texture, largest first, with member faces and bounds. Useful for auditing atlas layout. Read-only.",
    annotations: { title: "List UV Islands", readOnlyHint: true },
    parameters: uvIslandListParameters,
    status: STATUS_STABLE,
  },
  {
    name: "uv_density_per_face",
    description:
      "Per-face UV density: pixel area, fraction of the atlas, and (for cubes) texels-per-world-unit² — to spot under/over-resolved faces in a 256×256-style atlas workflow. Read-only.",
    annotations: { title: "UV Density Per Face", readOnlyHint: true },
    parameters: uvDensityPerFaceParameters,
    status: STATUS_STABLE,
  },
  {
    name: "validate_rig",
    description:
      "Composite rig validation against the LIVE project (no .bbmodel parse): `bone_orphans` (animated bones with zero child elements — runs automatically), `limb_pivot` (nearest cube corner within `limb_anchor_max` of the bone origin), `hand_center` (cube center within `hand_bone_center_max` of the bone origin), and `limb_x_seam` (adjacent cubes in a proximal→distal chain share a Y cross-section at the X seam). Supply `pairs` (bone↔cube) and `chains` (ordered cubes) to drive the geometric checks. Returns `{ passed, issues[] }` with per-issue delta vs threshold. EXPERIMENTAL: thresholds mirror validate_asset.py humanoid rules — tune for your rig. See issue #20.",
    annotations: { title: "Validate Rig", readOnlyHint: true },
    parameters: validateRigParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function parseDump(json: string, label: string): StructDump {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`\`${label}\` is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`\`${label}\` must be a model-structure object.`);
  }
  return parsed as StructDump;
}

function parentRef(el: { parent?: unknown }): string | null {
  const p = el.parent as { uuid?: string; name?: string } | undefined;
  if (!p || typeof p !== "object") return null;
  return p.uuid ?? p.name ?? null;
}

/** Build a StructDump from the currently open project (uuid/name/parent + cube face uv). */
function currentProjectDump(): StructDump {
  const elements: StructNode[] = [];
  // @ts-ignore - Cube global
  for (const cube of Cube.all) {
    const faces: Record<string, { uv?: number[] }> = {};
    for (const [key, face] of Object.entries(cube.faces ?? {})) {
      faces[key] = { uv: (face as { uv?: number[] }).uv };
    }
    elements.push({
      uuid: cube.uuid,
      name: cube.name,
      type: "cube",
      parent: parentRef(cube),
      faces,
    });
  }
  // @ts-ignore - Mesh global
  for (const mesh of Mesh.all) {
    elements.push({ uuid: mesh.uuid, name: mesh.name, type: "mesh", parent: parentRef(mesh) });
  }
  // @ts-ignore - Group global
  const groups: StructNode[] = Group.all.map((g: { uuid: string; name: string; parent?: unknown }) => ({
    uuid: g.uuid,
    name: g.name,
    type: "group",
    parent: parentRef(g),
  }));
  return { groups, elements };
}

interface ScopeElements {
  cubes: Array<{ uuid: string; name: string; faces?: Record<string, unknown>; from?: number[]; to?: number[] }>;
  meshes: Array<{ uuid: string; name: string; faces?: Record<string, unknown>; vertices?: Record<string, number[]> }>;
}

function gatherScope(scope: "all" | "selection" | "group", groupRef?: string): ScopeElements {
  // @ts-ignore - globals
  const isDesc = (el: { parent?: unknown }, g: unknown): boolean => {
    let cur: { parent?: unknown } | undefined = el;
    while (cur && cur.parent && typeof cur.parent === "object") {
      if (cur.parent === g) return true;
      cur = cur.parent as { parent?: unknown };
    }
    return false;
  };
  if (scope === "group") {
    // @ts-ignore
    const g = Group.all.find((x: { uuid: string; name: string }) => x.uuid === groupRef || x.name === groupRef);
    if (!g) throw new Error(`Group "${groupRef}" not found.`);
    // @ts-ignore
    return { cubes: Cube.all.filter((c: { parent?: unknown }) => isDesc(c, g)), meshes: Mesh.all.filter((m: { parent?: unknown }) => isDesc(m, g)) };
  }
  if (scope === "selection") {
    // @ts-ignore
    return { cubes: [...Cube.selected], meshes: [...Mesh.selected] };
  }
  // @ts-ignore
  return { cubes: [...Cube.all], meshes: [...Mesh.all] };
}

const CUBE_FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;

/** Texture key for a face (name or "(none)") used to bucket UV analysis. */
function faceTextureKey(face: { texture?: unknown; getTexture?: () => { name?: string } | null }): string {
  if (!face || !face.texture) return "(none)";
  return face.getTexture?.()?.name ?? String(face.texture);
}

/** Collect UV rects per texture for the scope. Cube faces use face.uv directly;
 *  mesh faces use the bounding rect of their per-vertex uvs. */
function collectUvFacesByTexture(
  scope: ScopeElements
): Map<string, Array<UvFace & { worldArea?: number }>> {
  const byTex = new Map<string, Array<UvFace & { worldArea?: number }>>();
  const push = (tex: string, f: UvFace & { worldArea?: number }) => {
    (byTex.get(tex) ?? byTex.set(tex, []).get(tex)!).push(f);
  };

  for (const cube of scope.cubes) {
    const from = cube.from ?? [0, 0, 0];
    const to = cube.to ?? [0, 0, 0];
    const sx = Math.abs(to[0] - from[0]);
    const sy = Math.abs(to[1] - from[1]);
    const sz = Math.abs(to[2] - from[2]);
    const faceWorldArea: Record<string, number> = {
      north: sx * sy,
      south: sx * sy,
      east: sz * sy,
      west: sz * sy,
      up: sx * sz,
      down: sx * sz,
    };
    for (const key of CUBE_FACE_KEYS) {
      const face = (cube.faces as Record<string, { uv?: number[]; enabled?: boolean; texture?: unknown; getTexture?: () => { name?: string } | null }> | undefined)?.[key];
      if (!face || face.enabled === false) continue;
      const uv = face.uv;
      if (!uv || uv.length < 4) continue;
      push(faceTextureKey(face), {
        id: `${cube.name}:${key}`,
        rect: [uv[0], uv[1], uv[2], uv[3]] as UvRect,
        worldArea: faceWorldArea[key],
      });
    }
  }

  for (const mesh of scope.meshes) {
    for (const [key, faceRaw] of Object.entries(mesh.faces ?? {})) {
      const face = faceRaw as { uv?: Record<string, number[]>; texture?: unknown; getTexture?: () => { name?: string } | null };
      const uvs = face.uv ? Object.values(face.uv) : [];
      if (uvs.length < 3) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [u, v] of uvs) {
        x0 = Math.min(x0, u); y0 = Math.min(y0, v);
        x1 = Math.max(x1, u); y1 = Math.max(y1, v);
      }
      push(faceTextureKey(face), { id: `${mesh.name}:${key}`, rect: [x0, y0, x1, y1] });
    }
  }

  return byTex;
}

// --------------------------------------------------------------------------- //
// Registration
// --------------------------------------------------------------------------- //

export function registerAnalysisTools() {
  // compare_models
  createTool(analysisToolDocs[0].name, {
    ...analysisToolDocs[0],
    async execute({ before, after }) {
      const beforeDump = parseDump(before, "before");
      const afterDump = after ? parseDump(after, "after") : currentProjectDump();
      const diff = diffModelStructure(beforeDump, afterDump);
      return JSON.stringify({ against: after ? "provided" : "current_project", ...diff }, null, 2);
    },
  }, analysisToolDocs[0].status);

  // find_uv_overlaps
  createTool(analysisToolDocs[1].name, {
    ...analysisToolDocs[1],
    async execute({ scope, group, min_area }) {
      const byTex = collectUvFacesByTexture(gatherScope(scope, group));
      const textures: Array<{ texture: string; overlaps: ReturnType<typeof findUvOverlaps> }> = [];
      let total = 0;
      for (const [tex, faces] of byTex) {
        const overlaps = findUvOverlaps(faces, min_area);
        if (overlaps.length) {
          textures.push({ texture: tex, overlaps });
          total += overlaps.length;
        }
      }
      return JSON.stringify({ scope, total_overlaps: total, textures }, null, 2);
    },
  }, analysisToolDocs[1].status);

  // uv_island_list
  createTool(analysisToolDocs[2].name, {
    ...analysisToolDocs[2],
    async execute({ scope, group }) {
      const byTex = collectUvFacesByTexture(gatherScope(scope, group));
      const textures = [...byTex.entries()].map(([tex, faces]) => ({
        texture: tex,
        island_count: listUvIslands(faces).length,
        islands: listUvIslands(faces),
      }));
      return JSON.stringify({ scope, textures }, null, 2);
    },
  }, analysisToolDocs[2].status);

  // uv_density_per_face
  createTool(analysisToolDocs[3].name, {
    ...analysisToolDocs[3],
    async execute({ scope, group, limit }) {
      const byTex = collectUvFacesByTexture(gatherScope(scope, group));
      // @ts-ignore - Project global
      const tw = Project?.texture_width ?? 16;
      // @ts-ignore
      const th = Project?.texture_height ?? 16;
      const faces: Array<{ texture: string; density: ReturnType<typeof uvDensityPerFace>[number] }> = [];
      for (const [tex, fs] of byTex) {
        for (const d of uvDensityPerFace(fs, tw, th)) {
          faces.push({ texture: tex, density: d });
          if (faces.length >= limit) break;
        }
        if (faces.length >= limit) break;
      }
      return JSON.stringify(
        { scope, atlas: [tw, th], truncated: faces.length >= limit, count: faces.length, faces },
        null,
        2
      );
    },
  }, analysisToolDocs[3].status);

  // validate_rig
  createTool(analysisToolDocs[4].name, {
    ...analysisToolDocs[4],
    async execute({
      checks,
      pairs,
      chains,
      limb_anchor_max,
      hand_bone_center_max,
      seam_tolerance,
    }) {
      const run = (name: string): boolean => !checks || checks.includes(name as any);
      const issues: Array<Record<string, unknown>> = [];

      // @ts-ignore - Blockbench globals
      const findCube = (ref: string): Cube | undefined =>
        // @ts-ignore
        Cube.all.find((c: Cube) => c.uuid === ref || c.name === ref);
      // @ts-ignore
      const findGroup = (ref: string): Group | undefined =>
        // @ts-ignore
        Group.all.find((g: Group) => g.uuid === ref || g.name === ref);

      const dist = (a: number[], b: number[]): number =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const cubeCenter = (c: { from: number[]; to: number[] }): number[] => [
        (c.from[0] + c.to[0]) / 2,
        (c.from[1] + c.to[1]) / 2,
        (c.from[2] + c.to[2]) / 2,
      ];
      // The 8 corners of a cube's from/to box.
      const cubeCorners = (c: { from: number[]; to: number[] }): number[][] => {
        const xs = [c.from[0], c.to[0]];
        const ys = [c.from[1], c.to[1]];
        const zs = [c.from[2], c.to[2]];
        const out: number[][] = [];
        for (const x of xs) for (const y of ys) for (const z of zs) out.push([x, y, z]);
        return out;
      };

      // limb_pivot + hand_center (driven by pairs)
      if (pairs && pairs.length) {
        for (const pair of pairs) {
          const bone = findGroup(pair.bone);
          const cube = findCube(pair.cube);
          if (!bone) {
            issues.push({ check: "binding", bone: pair.bone, error: "bone not found" });
            continue;
          }
          if (!cube) {
            issues.push({ check: "binding", cube: pair.cube, error: "cube not found" });
            continue;
          }
          const origin = (bone.origin ?? [0, 0, 0]) as number[];
          if (pair.kind === "hand") {
            if (!run("hand_center")) continue;
            const delta = dist(cubeCenter(cube as any), origin);
            if (delta > hand_bone_center_max) {
              issues.push({
                check: "hand_center",
                bone: pair.bone,
                cube: pair.cube,
                delta: Number(delta.toFixed(3)),
                max: hand_bone_center_max,
              });
            }
          } else {
            if (!run("limb_pivot")) continue;
            const delta = Math.min(
              ...cubeCorners(cube as any).map((corner) => dist(corner, origin))
            );
            if (delta > limb_anchor_max) {
              issues.push({
                check: "limb_pivot",
                bone: pair.bone,
                cube: pair.cube,
                delta: Number(delta.toFixed(3)),
                max: limb_anchor_max,
              });
            }
          }
        }
      }

      // limb_x_seam (driven by chains)
      if (run("limb_x_seam") && chains && chains.length) {
        for (const chain of chains) {
          const resolved = chain.cubes.map((ref: string) => ({ ref, cube: findCube(ref) }));
          for (let i = 0; i < resolved.length - 1; i++) {
            const a = resolved[i];
            const b = resolved[i + 1];
            if (!a.cube || !b.cube) {
              issues.push({
                check: "limb_x_seam",
                chain: chain.name,
                error: `cube not found: ${!a.cube ? a.ref : b.ref}`,
              });
              continue;
            }
            // Adjacent limb cubes should share the same Y cross-section where
            // they meet along X. Compare their Y min/max extents.
            const ay = [Math.min(a.cube.from[1], a.cube.to[1]), Math.max(a.cube.from[1], a.cube.to[1])];
            const by = [Math.min(b.cube.from[1], b.cube.to[1]), Math.max(b.cube.from[1], b.cube.to[1])];
            const dMin = Math.abs(ay[0] - by[0]);
            const dMax = Math.abs(ay[1] - by[1]);
            if (dMin > seam_tolerance || dMax > seam_tolerance) {
              issues.push({
                check: "limb_x_seam",
                chain: chain.name,
                between: [a.ref, b.ref],
                y_min_delta: Number(dMin.toFixed(3)),
                y_max_delta: Number(dMax.toFixed(3)),
                tolerance: seam_tolerance,
              });
            }
          }
        }
      }

      // bone_orphans (automatic over animated bones)
      if (run("bone_orphans")) {
        const animatedUuids = new Set<string>();
        // @ts-ignore - Animation global
        if (typeof Animation !== "undefined" && Animation.all) {
          // @ts-ignore
          for (const anim of Animation.all) {
            for (const uuid of Object.keys(anim.animators ?? {})) {
              // Only group/bone animators (skip effect animators which use
              // non-group uuids).
              if (findGroup(uuid)) animatedUuids.add(uuid);
            }
          }
        }
        for (const uuid of animatedUuids) {
          const bone = findGroup(uuid);
          if (!bone) continue;
          // @ts-ignore - Cube/Mesh globals
          const hasChild =
            // @ts-ignore
            Cube.all.some((c: Cube) => c.parent === bone) ||
            // @ts-ignore
            (typeof Mesh !== "undefined" && Mesh.all.some((m: Mesh) => m.parent === bone));
          if (!hasChild) {
            issues.push({ check: "bone_orphans", bone: bone.name, uuid });
          }
        }
      }

      return JSON.stringify(
        { passed: issues.length === 0, issue_count: issues.length, issues },
        null,
        2
      );
    },
  }, analysisToolDocs[4].status);
}

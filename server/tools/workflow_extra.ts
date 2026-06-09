/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { cubeSchema, meshSchema } from "@/lib/zodObjects";
import { getProjectTexture } from "@/lib/util";

// ============================================================================
// Workflow extras — additional Blockbench actions previously only reachable
// through the UI (or risky_eval).
//
// Author: McMarius11 fork (asset-generator-blockbench)
// ============================================================================

function ensureProject(): void {
  // @ts-ignore
  if (!Project) throw new Error("No project is open.");
}

// Find an element (Cube or Mesh) by uuid OR name
function findElement(id: string): any {
  // @ts-ignore
  const fromCube = Cube.all.find((c: any) => c.uuid === id || c.name === id);
  if (fromCube) return fromCube;
  // @ts-ignore
  if (typeof Mesh !== "undefined") {
    // @ts-ignore
    const fromMesh = Mesh.all.find((m: any) => m.uuid === id || m.name === id);
    if (fromMesh) return fromMesh;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const placeSectionParameters = z
  .object({
    group: z
      .string()
      .describe(
        "Name of the section's destination group/bone. Reused if a group with " +
          "this name already exists, otherwise created."
      ),
    parent: z
      .string()
      .optional()
      .describe(
        'Optional parent group/bone (name or UUID, or "root") to nest the ' +
          "section group under when it has to be created. Ignored if the group " +
          "already exists."
      ),
    texture: z
      .string()
      .optional()
      .describe(
        "Texture id/name applied to every cube and mesh in this section. " +
          "Falls back to the project's default texture when omitted; throws if " +
          "a name is given but not found (no silent 0-texture build)."
      ),
    cubes: z
      .array(cubeSchema)
      .optional()
      .default([])
      .describe("Cubes to create inside the section group."),
    meshes: z
      .array(meshSchema)
      .optional()
      .default([])
      .describe("Meshes to create inside the section group."),
  })
  .refine((v) => v.cubes.length > 0 || v.meshes.length > 0, {
    message: "A section needs at least one cube or mesh.",
  });

export const mirrorElementsParameters = z.object({
  axis: z
    .enum(["x", "y", "z"])
    .describe("Axis to mirror across (world axis through origin)."),
  element_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Element UUIDs or names to mirror. If omitted, mirrors current selection."
    ),
  duplicate: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true, duplicates the elements before mirroring (keeps both halves). If false, mirrors in-place."
    ),
});

export const setOriginParameters = z.object({
  element_id: z
    .string()
    .describe("Cube/Mesh UUID or name."),
  origin: z
    .union([
      z.array(z.number()).length(3),
      z.enum(["geometry_center", "world_origin", "parent_group"]),
    ])
    .describe(
      "Either explicit [x,y,z] coords, or one of: 'geometry_center' (center of element bounds), 'world_origin' ([0,0,0]), 'parent_group' (the parent group's origin)."
    ),
});

export const addReferenceImageParameters = z.object({
  path: z
    .string()
    .describe("Absolute filesystem path to a PNG/JPG image."),
  position: z
    .array(z.number())
    .length(3)
    .optional()
    .default([0, 0, 0])
    .describe("World-space [x, y, z] position to place the image plane."),
  scale: z
    .number()
    .optional()
    .default(1)
    .describe("Image scale multiplier."),
  axis: z
    .enum(["x", "y", "z"])
    .optional()
    .default("z")
    .describe(
      "Axis the reference image plane faces. 'z' = front view, 'x' = side view, 'y' = top view."
    ),
});

export const convertProjectParameters = z.object({
  format: z
    .string()
    .describe(
      "Target format ID from Blockbench's Formats registry (e.g. 'free', 'bedrock_block', 'modded_entity', 'java_block')."
    ),
});

export const meshBevelParameters = z.object({
  mesh_id: z
    .string()
    .describe("Mesh UUID or name."),
  edge_keys: z
    .array(z.string())
    .describe("Edge keys (Mesh stores edges as 'vertexA_vertexB' strings) to bevel."),
  width: z
    .number()
    .min(0.01)
    .max(10)
    .optional()
    .default(0.5)
    .describe("Bevel width in units."),
});

export const meshInsetParameters = z.object({
  mesh_id: z
    .string()
    .describe("Mesh UUID or name."),
  face_keys: z
    .array(z.string())
    .describe("Face keys to inset."),
  inset: z
    .number()
    .min(0.01)
    .max(10)
    .optional()
    .default(0.5)
    .describe("Inset distance in units."),
});

export const meshLoopCutParameters = z.object({
  mesh_id: z
    .string()
    .describe("Mesh UUID or name."),
  face_key: z
    .string()
    .describe("Face key on the mesh to start the loop cut from."),
  cuts: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe("Number of cuts to make in the loop."),
});

export const bindMeshFaceTexturesParameters = z.object({
  mesh_id: z
    .string()
    .describe("Mesh UUID or name."),
  texture: z
    .string()
    .describe("Texture UUID, name, or id to bind to the mesh's faces."),
  face_keys: z
    .array(z.string())
    .optional()
    .describe(
      "Specific face keys to bind. If omitted, binds ALL faces of the mesh."
    ),
});

export const alignElementsParameters = z.object({
  element_ids: z
    .array(z.string())
    .min(2)
    .describe("Two or more cube/mesh UUIDs or names."),
  axis: z.enum(["x", "y", "z"]).describe("Axis to align along."),
  mode: z
    .enum(["min", "center", "max"])
    .describe(
      "min: align to lowest bounds, center: align to middle, max: align to highest bounds."
    ),
});

export const distributeElementsParameters = z.object({
  element_ids: z
    .array(z.string())
    .min(3)
    .describe("Three or more cube/mesh UUIDs or names."),
  axis: z
    .enum(["x", "y", "z"])
    .describe("Axis to distribute along."),
});

export const setGroupVisibilityParameters = z.object({
  group_id: z
    .string()
    .describe("Group UUID or name."),
  visible: z
    .boolean()
    .describe("True to show, false to hide."),
});

export const lockGroupParameters = z.object({
  group_id: z
    .string()
    .describe("Group UUID or name."),
  locked: z
    .boolean()
    .describe("True to lock (prevent edits), false to unlock."),
});

export const selectByPatternParameters = z.object({
  pattern: z
    .string()
    .describe("Regex pattern to match against element names."),
  type: z
    .enum(["all", "cubes", "meshes", "groups"])
    .optional()
    .default("all")
    .describe("Element type to filter."),
});

export const readSettingParameters = z.object({
  key: z
    .string()
    .describe(
      "Blockbench setting key (e.g. 'autosave_interval', 'export_compressed', 'theme')."
    ),
});

export const writeSettingParameters = z.object({
  key: z
    .string()
    .describe("Blockbench setting key."),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe("New value for the setting."),
});

// ---------------------------------------------------------------------------
// Tool docs
// ---------------------------------------------------------------------------

export const workflowExtraToolDocs: ToolSpec[] = [
  {
    name: "mirror_elements",
    description:
      "Mirror elements across an axis. Saves token + ensures geometric symmetry for paired weapon/character parts. With duplicate=true, creates a mirrored copy; with duplicate=false, flips in-place.",
    annotations: { title: "Mirror Elements", destructiveHint: true, openWorldHint: false },
    parameters: mirrorElementsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_origin",
    description:
      "Set or recalculate the pivot point of an element. Critical for animations — wrong origin = rotation pivots from world center instead of joint.",
    annotations: { title: "Set Origin", destructiveHint: true, openWorldHint: false },
    parameters: setOriginParameters,
    status: STATUS_STABLE,
  },
  {
    name: "add_reference_image",
    description:
      "Add a reference image to the viewport as a backdrop plane. Useful for matching proportions to concept art / screenshot.",
    annotations: { title: "Add Reference Image", destructiveHint: false, openWorldHint: true },
    parameters: addReferenceImageParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "convert_project",
    description:
      "Convert the current project to a different format (e.g. free → bedrock_block). May lose format-specific data.",
    annotations: { title: "Convert Project", destructiveHint: true, openWorldHint: false },
    parameters: convertProjectParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "mesh_bevel_edge",
    description: "Bevel selected mesh edges. Adds a chamfer of given width.",
    annotations: { title: "Bevel Edge", destructiveHint: true, openWorldHint: false },
    parameters: meshBevelParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "mesh_inset_face",
    description: "Inset selected mesh faces by the given distance.",
    annotations: { title: "Inset Face", destructiveHint: true, openWorldHint: false },
    parameters: meshInsetParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "mesh_loop_cut",
    description: "Loop-cut a mesh face into N strips.",
    annotations: { title: "Loop Cut", destructiveHint: true, openWorldHint: false },
    parameters: meshLoopCutParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "align_elements",
    description:
      "Align two or more elements along an axis (min/center/max bounds).",
    annotations: { title: "Align Elements", destructiveHint: true, openWorldHint: false },
    parameters: alignElementsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "distribute_elements",
    description:
      "Distribute three or more elements evenly along an axis.",
    annotations: { title: "Distribute Elements", destructiveHint: true, openWorldHint: false },
    parameters: distributeElementsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_group_visibility",
    description: "Show or hide a group.",
    annotations: { title: "Set Group Visibility", destructiveHint: false, openWorldHint: false },
    parameters: setGroupVisibilityParameters,
    status: STATUS_STABLE,
  },
  {
    name: "lock_group",
    description:
      "Lock or unlock a group (prevents accidental edits to its children).",
    annotations: { title: "Lock Group", destructiveHint: false, openWorldHint: false },
    parameters: lockGroupParameters,
    status: STATUS_STABLE,
  },
  {
    name: "select_by_pattern",
    description:
      "Select all elements whose name matches a regex pattern. Returns the list of matched UUIDs.",
    annotations: { title: "Select by Pattern", destructiveHint: false, openWorldHint: false },
    parameters: selectByPatternParameters,
    status: STATUS_STABLE,
  },
  {
    name: "read_setting",
    description:
      "Read a Blockbench setting by key. Returns the current value as a string.",
    annotations: { title: "Read Setting", destructiveHint: false, openWorldHint: false },
    parameters: readSettingParameters,
    status: STATUS_STABLE,
  },
  {
    name: "write_setting",
    description:
      "Write a Blockbench setting. Useful for changing autosave_interval, theme, default formats, etc. without going through the UI.",
    annotations: { title: "Write Setting", destructiveHint: true, openWorldHint: false },
    parameters: writeSettingParameters,
    status: STATUS_STABLE,
  },
  {
    name: "bind_mesh_face_textures",
    description:
      "Bind a texture to mesh faces. Workaround for upstream `place_mesh` and `apply_texture` not setting `face.texture` on mesh elements (only sets UV). Without binding, mesh faces render as the untextured pink/cyan pattern. Pass face_keys=null to bind every face.",
    annotations: { title: "Bind Mesh Face Textures", destructiveHint: true, openWorldHint: false },
    parameters: bindMeshFaceTexturesParameters,
    status: STATUS_STABLE,
  },
  {
    name: "place_section",
    description:
      "Build a whole Forge-style 'section' — one named group containing cubes " +
      "and/or meshes, all sharing one texture — in a SINGLE call, instead of " +
      "separate add_group + place_cube + place_mesh + bind round-trips. The " +
      "group is created if missing (optionally nested under `parent`) or " +
      "reused if it already exists. Texture is resolved once and applied to " +
      "every element; a bad texture name throws rather than producing a silent " +
      "untextured build. Returns `{ group, group_uuid, cubes_added, " +
      "meshes_added }`.",
    annotations: {
      title: "Place Section",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: placeSectionParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerWorkflowExtraTools() {
  // ---- mirror_elements ----
  createTool(workflowExtraToolDocs[0].name, {
    ...workflowExtraToolDocs[0],
    async execute({ axis, element_ids, duplicate }: any) {
      ensureProject();
      const targets = element_ids
        ? element_ids.map(findElement).filter(Boolean)
        : (selected as any[]);
      if (!targets.length) throw new Error("No elements to mirror.");
      const axisIdx = { x: 0, y: 1, z: 2 }[axis as "x" | "y" | "z"];

      const results: string[] = [];
      for (const el of targets) {
        let target = el;
        if (duplicate) {
          // @ts-ignore
          target = el.duplicate ? el.duplicate() : el;
          results.push(`duplicated ${el.name}`);
        }
        // Mirror coords by negating along axis
        for (const key of ["from", "to", "origin"] as const) {
          if (target[key]) {
            target[key][axisIdx] = -target[key][axisIdx];
          }
        }
        // For cubes, also need to swap from/to so from < to
        if (target.from && target.to) {
          for (let i = 0; i < 3; i++) {
            if (target.from[i] > target.to[i]) {
              const tmp = target.from[i];
              target.from[i] = target.to[i];
              target.to[i] = tmp;
            }
          }
        }
      }
      // @ts-ignore
      Canvas.updateAll();
      return `Mirrored ${targets.length} element(s) across ${axis} (duplicate=${duplicate}).`;
    },
  }, workflowExtraToolDocs[0].status);

  // ---- set_origin ----
  createTool(workflowExtraToolDocs[1].name, {
    ...workflowExtraToolDocs[1],
    async execute({ element_id, origin }: any) {
      ensureProject();
      const el = findElement(element_id);
      if (!el) throw new Error(`Element not found: ${element_id}`);

      let newOrigin: number[];
      if (Array.isArray(origin)) {
        newOrigin = origin;
      } else if (origin === "world_origin") {
        newOrigin = [0, 0, 0];
      } else if (origin === "geometry_center") {
        if (el.from && el.to) {
          newOrigin = [
            (el.from[0] + el.to[0]) / 2,
            (el.from[1] + el.to[1]) / 2,
            (el.from[2] + el.to[2]) / 2,
          ];
        } else {
          throw new Error("Cannot compute geometry_center for non-cube element.");
        }
      } else if (origin === "parent_group") {
        if (el.parent && el.parent.origin) {
          newOrigin = [...el.parent.origin];
        } else {
          newOrigin = [0, 0, 0];
        }
      } else {
        throw new Error(`Unknown origin mode: ${origin}`);
      }

      el.origin = newOrigin;
      // @ts-ignore
      Canvas.updateAll();
      return `Set origin of ${el.name} to [${newOrigin.join(", ")}].`;
    },
  }, workflowExtraToolDocs[1].status);

  // ---- add_reference_image ----
  createTool(workflowExtraToolDocs[2].name, {
    ...workflowExtraToolDocs[2],
    async execute({ path, position, scale, axis }: any) {
      ensureProject();
      // @ts-ignore - ReferenceImage is a Blockbench global
      if (typeof ReferenceImage === "undefined") {
        throw new Error("ReferenceImage API not available in this Blockbench version.");
      }
      // @ts-ignore
      const ref = new ReferenceImage({
        source: path,
        position: position,
        scale: [scale, scale],
        // axis controls the layer/projection direction
        layer: axis === "z" ? "viewport" : axis === "x" ? "side" : "top",
      });
      // @ts-ignore
      ref.add();
      return `Added reference image from ${path}.`;
    },
  }, workflowExtraToolDocs[2].status);

  // ---- convert_project ----
  createTool(workflowExtraToolDocs[3].name, {
    ...workflowExtraToolDocs[3],
    async execute({ format }: any) {
      ensureProject();
      // @ts-ignore - Formats is a Blockbench global
      const fmt = Formats[format];
      if (!fmt) throw new Error(`Unknown format: ${format}`);
      // @ts-ignore
      if (typeof fmt.convertTo === "function") {
        // @ts-ignore
        fmt.convertTo();
      } else {
        // @ts-ignore
        Project.format = fmt;
      }
      return `Converted project to ${format}.`;
    },
  }, workflowExtraToolDocs[3].status);

  // ---- mesh_bevel_edge ----
  createTool(workflowExtraToolDocs[4].name, {
    ...workflowExtraToolDocs[4],
    async execute({ mesh_id, edge_keys, width }: any) {
      ensureProject();
      const mesh = findElement(mesh_id);
      if (!mesh || mesh.type !== "mesh") throw new Error(`Mesh not found: ${mesh_id}`);
      // @ts-ignore - BarItems is a Blockbench global
      if (BarItems.bevel_edges && typeof BarItems.bevel_edges.click === "function") {
        // Selection-based action
        // @ts-ignore
        Project.mesh_selection = { [mesh.uuid]: { edges: edge_keys, vertices: [], faces: [] } };
        // @ts-ignore
        BarItems.bevel_edges.click({ width });
        return `Beveled ${edge_keys.length} edge(s) on ${mesh.name}.`;
      }
      throw new Error("bevel_edges action not available.");
    },
  }, workflowExtraToolDocs[4].status);

  // ---- mesh_inset_face ----
  createTool(workflowExtraToolDocs[5].name, {
    ...workflowExtraToolDocs[5],
    async execute({ mesh_id, face_keys, inset }: any) {
      ensureProject();
      const mesh = findElement(mesh_id);
      if (!mesh || mesh.type !== "mesh") throw new Error(`Mesh not found: ${mesh_id}`);
      // @ts-ignore
      if (BarItems.inset_face && typeof BarItems.inset_face.click === "function") {
        // @ts-ignore
        Project.mesh_selection = { [mesh.uuid]: { edges: [], vertices: [], faces: face_keys } };
        // @ts-ignore
        BarItems.inset_face.click({ amount: inset });
        return `Inset ${face_keys.length} face(s) on ${mesh.name}.`;
      }
      throw new Error("inset_face action not available.");
    },
  }, workflowExtraToolDocs[5].status);

  // ---- mesh_loop_cut ----
  createTool(workflowExtraToolDocs[6].name, {
    ...workflowExtraToolDocs[6],
    async execute({ mesh_id, face_key, cuts }: any) {
      ensureProject();
      const mesh = findElement(mesh_id);
      if (!mesh || mesh.type !== "mesh") throw new Error(`Mesh not found: ${mesh_id}`);
      // @ts-ignore
      if (BarItems.loop_cut && typeof BarItems.loop_cut.click === "function") {
        // @ts-ignore
        Project.mesh_selection = { [mesh.uuid]: { edges: [], vertices: [], faces: [face_key] } };
        // @ts-ignore
        BarItems.loop_cut.click({ cuts });
        return `Loop-cut ${face_key} on ${mesh.name} (${cuts} cuts).`;
      }
      throw new Error("loop_cut action not available.");
    },
  }, workflowExtraToolDocs[6].status);

  // ---- align_elements ----
  createTool(workflowExtraToolDocs[7].name, {
    ...workflowExtraToolDocs[7],
    async execute({ element_ids, axis, mode }: any) {
      ensureProject();
      const els = element_ids.map(findElement).filter(Boolean);
      if (els.length < 2) throw new Error("Need at least 2 elements.");
      const ai = { x: 0, y: 1, z: 2 }[axis as "x" | "y" | "z"];

      // Compute target value
      const mins = els.map((e: any) => Math.min(e.from[ai], e.to[ai]));
      const maxs = els.map((e: any) => Math.max(e.from[ai], e.to[ai]));
      let target: number;
      if (mode === "min") target = Math.min(...mins);
      else if (mode === "max") target = Math.max(...maxs);
      else /* center */ {
        target = (Math.max(...maxs) + Math.min(...mins)) / 2;
      }

      for (const el of els) {
        const size = Math.abs(el.to[ai] - el.from[ai]);
        if (mode === "min") {
          el.from[ai] = target;
          el.to[ai] = target + size;
        } else if (mode === "max") {
          el.to[ai] = target;
          el.from[ai] = target - size;
        } else {
          el.from[ai] = target - size / 2;
          el.to[ai] = target + size / 2;
        }
      }
      // @ts-ignore
      Canvas.updateAll();
      return `Aligned ${els.length} elements to ${mode} on ${axis}.`;
    },
  }, workflowExtraToolDocs[7].status);

  // ---- distribute_elements ----
  createTool(workflowExtraToolDocs[8].name, {
    ...workflowExtraToolDocs[8],
    async execute({ element_ids, axis }: any) {
      ensureProject();
      const els = element_ids.map(findElement).filter(Boolean);
      if (els.length < 3) throw new Error("Need at least 3 elements.");
      const ai = { x: 0, y: 1, z: 2 }[axis as "x" | "y" | "z"];

      // Sort by current center on axis
      els.sort((a: any, b: any) => (a.from[ai] + a.to[ai]) / 2 - (b.from[ai] + b.to[ai]) / 2);
      const firstC = (els[0].from[ai] + els[0].to[ai]) / 2;
      const lastC = (els[els.length - 1].from[ai] + els[els.length - 1].to[ai]) / 2;
      const step = (lastC - firstC) / (els.length - 1);

      for (let i = 1; i < els.length - 1; i++) {
        const newC = firstC + step * i;
        const size = Math.abs(els[i].to[ai] - els[i].from[ai]);
        els[i].from[ai] = newC - size / 2;
        els[i].to[ai] = newC + size / 2;
      }
      // @ts-ignore
      Canvas.updateAll();
      return `Distributed ${els.length} elements evenly on ${axis}.`;
    },
  }, workflowExtraToolDocs[8].status);

  // ---- set_group_visibility ----
  createTool(workflowExtraToolDocs[9].name, {
    ...workflowExtraToolDocs[9],
    async execute({ group_id, visible }: any) {
      ensureProject();
      // @ts-ignore - Group is a Blockbench global
      const grp = Group.all.find((g: any) => g.uuid === group_id || g.name === group_id);
      if (!grp) throw new Error(`Group not found: ${group_id}`);
      grp.visibility = visible;
      // @ts-ignore
      Canvas.updateAllVisibility?.();
      // @ts-ignore
      Canvas.updateAll();
      return `Set ${grp.name} visible=${visible}.`;
    },
  }, workflowExtraToolDocs[9].status);

  // ---- lock_group ----
  createTool(workflowExtraToolDocs[10].name, {
    ...workflowExtraToolDocs[10],
    async execute({ group_id, locked }: any) {
      ensureProject();
      // @ts-ignore
      const grp = Group.all.find((g: any) => g.uuid === group_id || g.name === group_id);
      if (!grp) throw new Error(`Group not found: ${group_id}`);
      grp.locked = locked;
      return `Set ${grp.name} locked=${locked}.`;
    },
  }, workflowExtraToolDocs[10].status);

  // ---- select_by_pattern ----
  createTool(workflowExtraToolDocs[11].name, {
    ...workflowExtraToolDocs[11],
    async execute({ pattern, type }: any) {
      ensureProject();
      const re = new RegExp(pattern);
      const results: any[] = [];
      // @ts-ignore
      if (type === "all" || type === "cubes") results.push(...Cube.all.filter((c: any) => re.test(c.name)));
      // @ts-ignore
      if ((type === "all" || type === "meshes") && typeof Mesh !== "undefined") {
        // @ts-ignore
        results.push(...Mesh.all.filter((m: any) => re.test(m.name)));
      }
      // @ts-ignore
      if ((type === "all" || type === "groups") && typeof Group !== "undefined") {
        // @ts-ignore
        results.push(...Group.all.filter((g: any) => re.test(g.name)));
      }
      // Apply selection
      // @ts-ignore
      selected.length = 0;
      for (const r of results) {
        if (r.type !== "group") {
          // @ts-ignore
          selected.push(r);
        }
      }
      return JSON.stringify(results.map((r: any) => ({ name: r.name, uuid: r.uuid, type: r.type || "group" })));
    },
  }, workflowExtraToolDocs[11].status);

  // ---- read_setting ----
  createTool(workflowExtraToolDocs[12].name, {
    ...workflowExtraToolDocs[12],
    async execute({ key }: any) {
      // @ts-ignore - settings is a Blockbench global
      if (typeof settings === "undefined") throw new Error("settings not available.");
      // @ts-ignore
      const s = settings[key];
      if (!s) throw new Error(`Setting not found: ${key}`);
      // @ts-ignore
      return JSON.stringify({ key, value: s.value, type: s.type });
    },
  }, workflowExtraToolDocs[12].status);

  // ---- write_setting ----
  createTool(workflowExtraToolDocs[13].name, {
    ...workflowExtraToolDocs[13],
    async execute({ key, value }: any) {
      // @ts-ignore
      if (typeof settings === "undefined") throw new Error("settings not available.");
      // @ts-ignore
      const s = settings[key];
      if (!s) throw new Error(`Setting not found: ${key}`);
      // @ts-ignore
      s.value = value;
      // @ts-ignore
      if (typeof s.onChange === "function") s.onChange(value);
      return `Set ${key} = ${JSON.stringify(value)}.`;
    },
  }, workflowExtraToolDocs[13].status);

  // ---- bind_mesh_face_textures ----
  // Workaround for upstream bug: place_mesh and apply_texture both fail to set
  // face.texture on mesh elements. Without this binding, faces render as
  // Blockbench's untextured pink/cyan checker pattern. Equivalent to what
  // modify_cube_uv does for cubes.
  createTool(workflowExtraToolDocs[14].name, {
    ...workflowExtraToolDocs[14],
    async execute({ mesh_id, texture, face_keys }: any) {
      ensureProject();
      const mesh = findElement(mesh_id);
      if (!mesh || mesh.type !== "mesh") {
        throw new Error(`Mesh not found or not a mesh: ${mesh_id}`);
      }
      // @ts-ignore - Texture is a Blockbench global
      const tex = Texture.all.find(
        (t: any) =>
          t.uuid === texture ||
          t.name === texture ||
          String(t.id) === String(texture)
      );
      if (!tex) throw new Error(`Texture not found: ${texture}`);

      const allKeys = Object.keys(mesh.faces);
      const targets: string[] = Array.isArray(face_keys) && face_keys.length > 0
        ? face_keys
        : allKeys;

      let bound = 0;
      for (const fk of targets) {
        const face = mesh.faces[fk];
        if (!face) continue;
        // Blockbench MeshFace.texture stores the texture's UUID at runtime;
        // serializer converts to numeric id when saving the bbmodel.
        face.texture = tex.uuid;
        bound++;
      }

      // Trigger viewport + UV editor update
      // @ts-ignore - Canvas is a Blockbench global
      if (typeof Canvas !== "undefined") {
        // @ts-ignore
        Canvas.updateView({ elements: [mesh], element_aspects: { faces: true } });
      }
      // @ts-ignore - UVEditor is a Blockbench global
      if (typeof UVEditor !== "undefined" && typeof UVEditor.loadData === "function") {
        // @ts-ignore
        UVEditor.loadData();
      }

      return `Bound texture "${tex.name}" to ${bound} face(s) on mesh "${mesh.name}".`;
    },
  }, workflowExtraToolDocs[14].status);

  // ---- place_section ----
  createTool(workflowExtraToolDocs[15].name, {
    ...workflowExtraToolDocs[15],
    async execute({ group, parent, texture, cubes, meshes }: any) {
      ensureProject();

      // Resolve the shared texture once. An explicit-but-missing name is an
      // error (the whole point of this tool over loose round-trips is to fail
      // loudly instead of building an untextured section).
      // @ts-ignore - Texture is a Blockbench global
      const projectTexture = texture
        ? getProjectTexture(texture)
        : Texture.getDefault();
      if (texture && !projectTexture) {
        throw new Error(`No texture found for "${texture}".`);
      }

      // @ts-ignore - getAllGroups is a Blockbench global utility
      const allGroups = getAllGroups();
      const resolve = (ref?: string): any =>
        !ref || ref === "root"
          ? "root"
          : allGroups.find((g: any) => g.name === ref || g.uuid === ref) ?? "root";

      Undo.initEdit({ elements: [], outliner: true, collections: [] });

      // Reuse an existing same-named group, else create it under `parent`.
      // @ts-ignore
      let sectionGroup: any = allGroups.find((g: any) => g.name === group);
      if (!sectionGroup) {
        // @ts-ignore - Group is a Blockbench global
        sectionGroup = new Group({ name: group }).init();
        sectionGroup.addTo(resolve(parent));
      }

      const createdCubes: any[] = (cubes ?? []).map((el: any) => {
        // @ts-ignore - Cube is a Blockbench global
        const cube = new Cube({
          autouv: 1,
          name: el.name,
          from: el.from,
          to: el.to,
          origin: el.origin,
          rotation: el.rotation,
        }).init();
        cube.addTo(sectionGroup);
        if (projectTexture) {
          cube.applyTexture(projectTexture, true);
          cube.mapAutoUV();
        }
        return cube;
      });

      const createdMeshes: any[] = (meshes ?? []).map((el: any) => {
        // @ts-ignore - Mesh is a Blockbench global
        const mesh = new Mesh({ name: el.name, vertices: {} }).init();
        const vkeys: string[] = [];
        (el.vertices ?? []).forEach((v: number[]) => {
          const r = mesh.addVertices(v as ArrayVector3);
          vkeys.push(Array.isArray(r) ? r[0] : r);
        });
        for (const spec of el.faces ?? []) {
          const verts = (spec.vertices as number[]).map((i: number) => vkeys[i]);
          if (verts.some((k: string) => !k)) {
            throw new Error(
              `Face on mesh "${el.name}" references an out-of-range vertex index.`
            );
          }
          const faceUv: Record<string, [number, number]> = {};
          if (spec.uv && typeof spec.uv === "object") {
            for (const [idx, uv] of Object.entries(spec.uv)) {
              const vk = vkeys[Number(idx)];
              if (vk) faceUv[vk] = uv as [number, number];
            }
          }
          // @ts-ignore - MeshFace is a Blockbench global
          mesh.addFaces(new MeshFace(mesh, { vertices: verts, uv: faceUv }));
        }
        mesh.addTo(sectionGroup);
        if (projectTexture) mesh.applyTexture(projectTexture);
        return mesh;
      });

      Undo.finishEdit("Agent placed section");
      // @ts-ignore - Canvas is a Blockbench global
      Canvas.updateAll();

      return JSON.stringify({
        group: sectionGroup.name,
        group_uuid: sectionGroup.uuid,
        cubes_added: createdCubes.length,
        meshes_added: createdMeshes.length,
      });
    },
  }, workflowExtraToolDocs[15].status);
}

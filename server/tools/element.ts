/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { findElementOrThrow, findTextureOrThrow } from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import {
  elementIdSchema,
  vector3Schema,
  autoUvEnum,
} from "@/lib/zodObjects";

export const removeElementParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to remove."),
});

export const elementTypeEnum = z.enum(["cube", "mesh", "group", "any"]);

export const cubeFaceEnum = z.enum([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

export const findElementsByCriteriaParameters = z.object({
  name_pattern: z
    .string()
    .optional()
    .describe(
      "Regex pattern to match element names (e.g., '^arm_.*'). Case-sensitive."
    ),
  name_contains: z
    .string()
    .optional()
    .describe("Substring to match in element names. Case-insensitive."),
  type: elementTypeEnum
    .optional()
    .default("any")
    .describe("Restrict to a single element type."),
  parent_group: z
    .string()
    .optional()
    .describe(
      "UUID or name of a parent group. Only descendants of this group are returned."
    ),
  min_size: vector3Schema
    .optional()
    .describe("Minimum [x,y,z] size for cubes. Cubes smaller on any axis are excluded."),
  max_size: vector3Schema
    .optional()
    .describe("Maximum [x,y,z] size for cubes. Cubes larger on any axis are excluded."),
  selected_only: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only consider currently selected elements."),
  region_min: vector3Schema
    .optional()
    .describe(
      "Region filter lower bound [x,y,z]. Keeps only elements whose position is >= this on every axis — cube center for cubes, origin for meshes. Groups are excluded when a region filter is set. Use with `region_max` to query a zone (e.g. a receiver bounding box)."
    ),
  region_max: vector3Schema
    .optional()
    .describe(
      "Region filter upper bound [x,y,z]. Keeps only elements whose position is <= this on every axis (cube center / mesh origin)."
    ),
  face_enabled: cubeFaceEnum
    .optional()
    .describe(
      "Keep only cubes whose given face (north/south/east/west/up/down) is enabled. Non-cube elements are excluded when set."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(200)
    .describe("Maximum number of results to return."),
});

export const moveToGroupParameters = z.object({
  ids: z
    .array(z.string())
    .min(1)
    .describe(
      "Element IDs or names to move (cubes, meshes, or groups). Reparents existing elements — does not duplicate."
    ),
  target_group: z
    .string()
    .describe(
      "Destination group UUID or name, or the literal \"root\" to move to the top level. The AI computes which elements belong where (e.g. from a `get_element_info` dump); this tool just performs the move."
    ),
});

export const selectAllOfTypeParameters = z.object({
  type: z
    .enum(["cube", "mesh", "group"])
    .describe("Element type to select."),
  add_to_selection: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, add to current selection. If false, replace selection."),
  parent_group: z
    .string()
    .optional()
    .describe(
      "UUID or name of a parent group. If provided, only descendants of this group are selected."
    ),
});

export const filterByMaterialParameters = z.object({
  texture: z
    .string()
    .describe("Texture ID, UUID or name to search for."),
  include_face_keys: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Include the list of cube face keys (e.g., 'north') that reference the texture."
    ),
});

export const getElementInfoParameters = z.object({
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "Specific element IDs or names (cubes, meshes, or groups). Takes precedence over `group` and `selected_only`."
    ),
  group: z
    .string()
    .optional()
    .describe(
      "UUID or name of a group — returns all of its descendant elements. Used when `ids` is omitted."
    ),
  selected_only: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Return only the currently selected elements. Used when both `ids` and `group` are omitted. If everything is omitted, the whole project is returned."
    ),
  include_groups: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Include group nodes (transform + child count) in broad scopes (group/selection/all). Groups named explicitly via `ids` are always included."
    ),
  include_faces: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "For cubes, include per-face data (uv, texture, rotation, tint, enabled). Set false for a lighter geometry-only dump."
    ),
  include_mesh_geometry: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "For meshes, include full vertices and faces. Off by default — meshes otherwise return counts + local bounding box only, since full vertex dumps can be large."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .default(1000)
    .describe("Maximum number of elements to return."),
});

export const addGroupParameters = z.object({
  name: z.string(),
  origin: vector3Schema,
  rotation: vector3Schema,
  parent: z.string().optional().default("root"),
  visibility: z.boolean().optional().default(true),
  autouv: autoUvEnum
    .optional()
    .default("0")
    .describe(
      "Auto UV setting. 0 = disabled, 1 = enabled, 2 = relative auto UV."
    ),
  selected: z.boolean().optional().default(false),
  shade: z.boolean().optional().default(false),
});

export const listOutlineParameters = z.object({
  include_cubes: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, include cubes as leaves. If false, return groups only."),
  include_meshes: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, include meshes as leaves. If false, omit meshes."),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(32)
    .optional()
    .default(32)
    .describe("Maximum tree depth to traverse. Use a small value to summarize large projects."),
});

export const duplicateElementParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to duplicate."),
  offset: vector3Schema.optional().default([0, 0, 0]),
  newName: z.string().optional(),
});

export const renameElementParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to rename."),
  new_name: z.string().describe("New name to assign."),
});

export const elementToolDocs: ToolSpec[] = [
  {
    name: "remove_element",
    description: "Removes the element with the given ID.",
    annotations: {
      title: "Remove Element",
      destructiveHint: true,
    },
    parameters: removeElementParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "add_group",
    description: "Adds a new group with the given name and options.",
    annotations: {
      title: "Add Group",
      destructiveHint: true,
    },
    parameters: addGroupParameters,
    status: STATUS_STABLE,
  },
  {
    name: "list_outline",
    description:
      "Returns the project outline as a hierarchical tree. Each node reports { name, uuid, type (cube|mesh|group), children? }. Groups contain child cubes, meshes, and sub-groups. Use `include_cubes=false` to get a group-only skeleton when you just need structure, or `max_depth` to bound very deep trees.",
    annotations: {
      title: "List Outline",
      readOnlyHint: true,
    },
    parameters: listOutlineParameters,
    status: STATUS_STABLE,
  },
  {
    name: "duplicate_element",
    description:
      "Duplicates a cube, mesh or group by ID or name.  You may offset the duplicate or assign a new name.",
    annotations: { title: "Duplicate Element", destructiveHint: true },
    parameters: duplicateElementParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "rename_element",
    description: "Renames a cube, mesh or group by ID or name.",
    annotations: { title: "Rename Element", destructiveHint: true },
    parameters: renameElementParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "find_elements_by_criteria",
    description:
      "Searches the current project for elements matching the given criteria. Supports name pattern matching (regex or substring), type filtering, scoping to a parent group, cube size ranges, and selection scope. Returns element metadata, never modifies state.",
    annotations: {
      title: "Find Elements by Criteria",
      readOnlyHint: true,
    },
    parameters: findElementsByCriteriaParameters,
    status: STATUS_STABLE,
  },
  {
    name: "select_all_of_type",
    description:
      "Selects all elements of the given type (cube, mesh, or group) in the current project. Optionally restrict to descendants of a parent group, or add to (rather than replace) the current selection.",
    annotations: {
      title: "Select All of Type",
      destructiveHint: true,
    },
    parameters: selectAllOfTypeParameters,
    status: STATUS_STABLE,
  },
  {
    name: "filter_by_material",
    description:
      "Returns all elements that reference the given texture. For cubes, includes the list of face keys (e.g., 'north', 'up') that use the texture. For meshes, returns the mesh if any face uses the texture.",
    annotations: {
      title: "Filter Elements by Material",
      readOnlyHint: true,
    },
    parameters: filterByMaterialParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_element_info",
    description:
      "Returns full structured data for elements as JSON. Cubes: from/to, computed size, origin, rotation, inflate, box-UV settings, visibility/shade, and (by default) per-face uv/texture/rotation/tint/enabled. Meshes: origin/rotation, vertex & face counts, local bounding box, and optionally full vertices/faces. Groups: transform + child count. Scope via `ids` (specific elements), `group` (its descendants), `selected_only`, or omit all for the whole project. Read-only. Pair with `list_outline` for the hierarchy, or `find_elements_by_criteria` to get IDs first. This is the structured-dump primitive for offline analysis — use instead of `risky_eval`.",
    annotations: {
      title: "Get Element Info",
      readOnlyHint: true,
    },
    parameters: getElementInfoParameters,
    status: STATUS_STABLE,
  },
  {
    name: "move_to_group",
    description:
      "Reparents existing elements (cubes, meshes, or groups) into a target group, or to the top level with `target_group: \"root\"`. The complement to `add_group` (which only creates empty groups) — this is how you organize a flat import (e.g. a Java model from `from_java_model`) into logical groups. Semantic grouping logic stays in the caller: compute which elements go where from a `get_element_info` dump, then issue the moves. Refuses to move a group into itself or its own descendant. Returns a JSON summary.",
    annotations: {
      title: "Move Elements to Group",
      destructiveHint: true,
    },
    parameters: moveToGroupParameters,
    status: STATUS_STABLE,
  },
];

interface IElementMatch {
  uuid: string;
  name: string;
  type: "cube" | "mesh" | "group";
  parent: string | null;
}

interface IFilterByMaterialMatch {
  uuid: string;
  name: string;
  type: "cube" | "mesh";
  faces?: string[];
}

function getElementType(el: unknown): "cube" | "mesh" | "group" | null {
  if (el instanceof Cube) return "cube";
  if (el instanceof Mesh) return "mesh";
  if (el instanceof Group) return "group";
  return null;
}

function getParentName(el: { parent?: unknown }): string | null {
  const parent = el.parent as { name?: string; uuid?: string } | undefined;
  if (!parent || typeof parent !== "object") return null;
  return parent.name ?? parent.uuid ?? null;
}

function isDescendantOf(el: { parent?: unknown }, targetGroup: Group): boolean {
  let current: { parent?: unknown } | undefined = el;
  while (current && current.parent && typeof current.parent === "object") {
    if (current.parent === targetGroup) return true;
    current = current.parent as { parent?: unknown };
  }
  return false;
}

function cubeSize(cube: Cube): [number, number, number] {
  return [
    cube.to[0] - cube.from[0],
    cube.to[1] - cube.from[1],
    cube.to[2] - cube.from[2],
  ];
}

function exceedsBounds(
  size: [number, number, number],
  min?: number[],
  max?: number[]
): boolean {
  if (min && size.some((v, i) => v < (min[i] ?? -Infinity))) return true;
  if (max && size.some((v, i) => v > (max[i] ?? Infinity))) return true;
  return false;
}

function cubeCenter(cube: Cube): [number, number, number] {
  return [
    (cube.from[0] + cube.to[0]) / 2,
    (cube.from[1] + cube.to[1]) / 2,
    (cube.from[2] + cube.to[2]) / 2,
  ];
}

function outsideRegion(
  point: [number, number, number],
  min?: number[],
  max?: number[]
): boolean {
  if (min && point.some((v, i) => v < (min[i] ?? -Infinity))) return true;
  if (max && point.some((v, i) => v > (max[i] ?? Infinity))) return true;
  return false;
}

const MAX_REGEX_PATTERN_LENGTH = 512;
// Heuristic: nested quantifiers like (a+)+, (.*)*, (a+|b)*, (foo){2,}+ are the
// classic catastrophic-backtracking shape. Reject quantifiers applied to a
// group whose body already contains a quantifier.
const CATASTROPHIC_BACKTRACK_HEURISTIC = /\([^)]*[+*?][^)]*\)\s*[+*?{]/;

function safeCompileRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    console.warn(
      `[MCP] find_elements_by_criteria: name_pattern rejected — exceeds ${MAX_REGEX_PATTERN_LENGTH} chars (got ${pattern.length}).`
    );
    return null;
  }
  if (CATASTROPHIC_BACKTRACK_HEURISTIC.test(pattern)) {
    console.warn(
      `[MCP] find_elements_by_criteria: name_pattern rejected — nested quantifiers risk catastrophic backtracking: ${pattern}`
    );
    return null;
  }
  try {
    return new RegExp(pattern);
  } catch (err) {
    console.warn(
      `[MCP] find_elements_by_criteria: name_pattern failed to compile, ignoring filter:`,
      err
    );
    return null;
  }
}

function faceTextureName(face: {
  texture?: unknown;
  getTexture?: () => { name?: string } | null;
}): string | null {
  if (!face.texture) return null;
  return face.getTexture?.()?.name ?? String(face.texture);
}

function serializeCube(cube: Cube, includeFaces: boolean): Record<string, unknown> {
  // @ts-ignore - Blockbench Cube has more props than the type declares
  const c = cube as any;
  const rec: Record<string, unknown> = {
    uuid: cube.uuid,
    name: cube.name,
    type: "cube",
    parent: getParentName(cube),
    from: cube.from,
    to: cube.to,
    size: cubeSize(cube),
    origin: cube.origin,
    rotation: cube.rotation,
    inflate: c.inflate ?? 0,
    box_uv: Boolean(c.box_uv),
    uv_offset: c.uv_offset ?? [0, 0],
    mirror_uv: Boolean(c.mirror_uv),
    visibility: c.visibility !== false,
    shade: c.shade !== false,
  };
  if (includeFaces) {
    const faces: Record<string, unknown> = {};
    for (const [key, face] of Object.entries(cube.faces ?? {})) {
      const f = face as any;
      faces[key] = {
        uv: f.uv,
        rotation: f.rotation ?? 0,
        tint: f.tint ?? -1,
        enabled: f.enabled !== false,
        texture: faceTextureName(f),
      };
    }
    rec.faces = faces;
  }
  return rec;
}

function serializeMesh(mesh: Mesh, includeGeometry: boolean): Record<string, unknown> {
  const m = mesh as any;
  const verts: Record<string, number[]> = m.vertices ?? {};
  const faces: Record<string, unknown> = m.faces ?? {};
  const vertexKeys = Object.keys(verts);

  let bbox: { from: number[]; to: number[] } | null = null;
  if (vertexKeys.length) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const k of vertexKeys) {
      const v = verts[k];
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
    bbox = { from: min, to: max };
  }

  const rec: Record<string, unknown> = {
    uuid: mesh.uuid,
    name: mesh.name,
    type: "mesh",
    parent: getParentName(mesh),
    origin: m.origin,
    rotation: m.rotation,
    vertex_count: vertexKeys.length,
    face_count: Object.keys(faces).length,
    bounding_box: bbox,
  };
  if (includeGeometry) {
    rec.vertices = verts;
    const faceOut: Record<string, unknown> = {};
    for (const [key, face] of Object.entries(faces)) {
      const f = face as any;
      faceOut[key] = {
        vertices: f.vertices,
        uv: f.uv,
        texture: faceTextureName(f),
      };
    }
    rec.faces = faceOut;
  }
  return rec;
}

function serializeGroup(group: Group): Record<string, unknown> {
  const g = group as any;
  return {
    uuid: group.uuid,
    name: group.name,
    type: "group",
    parent: getParentName(group),
    origin: g.origin,
    rotation: g.rotation,
    visibility: g.visibility !== false,
    children_count: (group.children ?? []).length,
  };
}

export function registerElementTools() {
  createTool(elementToolDocs[0].name, {
    ...elementToolDocs[0],
    async execute({ id }) {
      const element = findElementOrThrow(id);

      Undo.initEdit({
        elements: [],
        outliner: true,
        collections: [],
      });

      element.remove();

      Undo.finishEdit("Agent removed element");
      Canvas.updateAll();

      return `Removed element with ID ${id}`;
    },
  }, elementToolDocs[0].status);

  createTool(elementToolDocs[1].name, {
    ...elementToolDocs[1],
    async execute({
      name,
      origin,
      rotation,
      parent,
      visibility,
      autouv,
      selected,
      shade,
    }) {
      Undo.initEdit({
        elements: [],
        outliner: true,
        collections: [],
      });

      const group = new Group({
        name,
        origin,
        rotation,
        autouv: Number(autouv) as 0 | 1 | 2,
        visibility: Boolean(visibility),
        selected: Boolean(selected),
        shade: Boolean(shade),
      }).init();

      const parentGroup = parent === "root"
        ? "root"
        : // `@ts-expect-error` getAllGroups is a Blockbench global
          getAllGroups().find((g: Group) => g.name === parent || g.uuid === parent);
      group.addTo(parentGroup);

      Undo.finishEdit("Agent added group");
      Canvas.updateAll();

      return `Added group ${group.name} with ID ${group.uuid}`;
    },
  }, elementToolDocs[1].status);

  createTool(elementToolDocs[2].name, {
    ...elementToolDocs[2],
    async execute({ include_cubes, include_meshes, max_depth }) {
      interface IOutlineNode {
        name: string;
        uuid: string;
        type: "cube" | "mesh" | "group";
        children?: IOutlineNode[];
      }

      const truncated: string[] = [];

      const nodeFor = (el: unknown, depth: number): IOutlineNode | null => {
        if (el instanceof Group) {
          const node: IOutlineNode = {
            name: el.name,
            uuid: el.uuid,
            type: "group",
            children: [],
          };
          if (depth >= max_depth) {
            truncated.push(el.name);
            delete node.children;
            return node;
          }
          for (const child of el.children ?? []) {
            const childNode = nodeFor(child, depth + 1);
            if (childNode) node.children!.push(childNode);
          }
          return node;
        }
        if (el instanceof Cube) {
          if (!include_cubes) return null;
          return { name: el.name, uuid: el.uuid, type: "cube" };
        }
        if (el instanceof Mesh) {
          if (!include_meshes) return null;
          return { name: el.name, uuid: el.uuid, type: "mesh" };
        }
        return null;
      };

      const roots = Outliner.root
        .map((el) => nodeFor(el, 0))
        .filter((n): n is IOutlineNode => n !== null);

      const counts = {
        groups: Group.all.length,
        cubes: Cube.all.length,
        meshes: Mesh.all.length,
      };

      return JSON.stringify(
        {
          counts,
          truncated_at_max_depth: truncated.length ? truncated : undefined,
          roots,
        },
        null,
        2
      );
    },
  }, elementToolDocs[2].status);

  createTool(elementToolDocs[3].name, {
    ...elementToolDocs[3],
    async execute({ id, offset, newName }) {
      const element = findElementOrThrow(id);

      // Helper functions for each type; match patterns used in existing tools:contentReference[oaicite:5]{index=5}.
      function cloneCube(cube: Cube, parent: any) {
        const dupe = new Cube({
          name: newName || `${cube.name}_copy`,
          from: cube.from.map((v, i) => v + offset[i]),
          to: cube.to.map((v, i) => v + offset[i]),
          origin: cube.origin.map((v, i) => v + offset[i]),
          rotation: cube.rotation,
          autouv: cube.autouv,
          uv_offset: cube.uv_offset,
          mirror_uv: cube.mirror_uv,
          shade: cube.shade,
          inflate: cube.inflate,
          color: cube.color,
          visibility: cube.visibility,
        }).init();
        dupe.addTo(parent);
        return dupe;
      }

      function cloneGroup(group: Group, parent: any) {
        const dupeGroup = new Group({
          name: newName || `${group.name}_copy`,
          origin: group.origin.map((v, i) => v + offset[i]),
          rotation: group.rotation,
          autouv: group.autouv,
          selected: group.selected,
          shade: group.shade,
          visibility: group.visibility,
        }).init();
        dupeGroup.addTo(parent);
        group.children.forEach((child: any) => cloneElement(child, dupeGroup));
        return dupeGroup;
      }

      function cloneMesh(mesh: Mesh, parent: any) {
        const dupe = new Mesh({
          name: newName || `${mesh.name}_copy`,
          vertices: {},
          origin: mesh.origin.map((v, i) => v + offset[i]),
          rotation: mesh.rotation,
        }).init();
        const map: Record<string, any> = {};
        Object.entries(mesh.vertices).forEach(([key, coords]: [any, any]) => {
          map[key] = dupe.addVertices([
            coords[0] + offset[0],
            coords[1] + offset[1],
            coords[2] + offset[2],
          ])[0];
        });
        mesh.faces.forEach((face: any) => {
          dupe.addFaces(
            new MeshFace(dupe, {
              vertices: face.vertices.map((v: any) => map[v]),
              uv: face.uv,
            })
          );
        });
        dupe.addTo(parent);
        if ((mesh as any).material) dupe.applyTexture((mesh as any).material);
        return dupe;
      }

      function cloneElement(el: any, parent: any) {
        if (el instanceof Cube) return cloneCube(el, parent);
        if (el instanceof Group) return cloneGroup(el, parent);
        if (el instanceof Mesh) return cloneMesh(el, parent);
        throw new Error("Unsupported element type.");
      }

      Undo.initEdit({ elements: [], outliner: true, collections: [] });
      const dup = cloneElement(element, element.parent ?? Outliner);
      Undo.finishEdit("Agent duplicated element");
      Canvas.updateAll();
      return `Duplicated "${element.name}" as "${dup.name}" (ID: ${dup.uuid}).`;
    },
  }, elementToolDocs[3].status);

  /**
   * Rename an element.  Mirrors the simple property change seen in the existing tools,
   * using `extend` to apply the change and updating the editor.
   */
  createTool(elementToolDocs[4].name, {
    ...elementToolDocs[4],
    async execute({ id, new_name }) {
      const element = findElementOrThrow(id);
      Undo.initEdit({ elements: [element], outliner: true, collections: [] });
      element.extend({ name: new_name });
      Undo.finishEdit("Agent renamed element");
      Canvas.updateAll();
      return `Renamed element "${id}" to "${new_name}".`;
    },
  }, elementToolDocs[4].status);

  createTool(elementToolDocs[5].name, {
    ...elementToolDocs[5],
    async execute({
      name_pattern,
      name_contains,
      type,
      parent_group,
      min_size,
      max_size,
      selected_only,
      region_min,
      region_max,
      face_enabled,
      limit,
    }) {
      const regex = safeCompileRegex(name_pattern);
      const needle = name_contains?.toLowerCase() ?? null;
      const parentScope = parent_group
        // @ts-ignore - Group is a Blockbench global
        ? (Group.all.find((g: Group) => g.uuid === parent_group || g.name === parent_group) ?? null)
        : null;

      if (parent_group && !parentScope) {
        throw new Error(
          `Parent group "${parent_group}" not found. Use list_outline to see available groups.`
        );
      }

      const candidates: Array<Cube | Mesh | Group> = [
        ...(selected_only ? Cube.selected : Cube.all),
        ...(selected_only ? Mesh.selected : Mesh.all),
        ...(selected_only ? Group.all.filter((g: Group) => g.selected) : Group.all),
      ];

      const matches: IElementMatch[] = [];

      for (const el of candidates) {
        if (matches.length >= limit) break;

        const elType = getElementType(el);
        if (!elType) continue;
        if (type !== "any" && elType !== type) continue;
        if (regex && !regex.test(el.name)) continue;
        if (needle && !el.name.toLowerCase().includes(needle)) continue;
        if (parentScope && !isDescendantOf(el, parentScope)) continue;

        if (el instanceof Cube && (min_size || max_size)) {
          if (exceedsBounds(cubeSize(el), min_size, max_size)) continue;
        }

        if (region_min || region_max) {
          if (el instanceof Group) continue;
          const point =
            el instanceof Cube
              ? cubeCenter(el)
              : ((el as { origin: [number, number, number] }).origin);
          if (outsideRegion(point, region_min, region_max)) continue;
        }

        if (face_enabled) {
          if (!(el instanceof Cube)) continue;
          const face = (el.faces as Record<string, { enabled?: boolean }>)?.[
            face_enabled
          ];
          if (!face || face.enabled === false) continue;
        }

        matches.push({
          uuid: el.uuid,
          name: el.name,
          type: elType,
          parent: getParentName(el),
        });
      }

      return JSON.stringify(
        {
          count: matches.length,
          truncated: matches.length >= limit,
          matches,
        },
        null,
        2
      );
    },
  }, elementToolDocs[5].status);

  createTool(elementToolDocs[6].name, {
    ...elementToolDocs[6],
    async execute({ type, add_to_selection, parent_group }) {
      const parentScope = parent_group
        // @ts-ignore - Group is a Blockbench global
        ? (Group.all.find((g: Group) => g.uuid === parent_group || g.name === parent_group) ?? null)
        : null;

      if (parent_group && !parentScope) {
        throw new Error(
          `Parent group "${parent_group}" not found. Use list_outline to see available groups.`
        );
      }

      const pool: Array<Cube | Mesh | Group> = (() => {
        if (type === "cube") return [...Cube.all];
        if (type === "mesh") return [...Mesh.all];
        return [...Group.all];
      })();

      const targets = parentScope
        ? pool.filter((el) => isDescendantOf(el, parentScope))
        : pool;

      if (!add_to_selection) {
        // @ts-ignore - selected method available on element classes
        Cube.all.forEach((c: Cube) => c.selected && c.unselect?.());
        // @ts-ignore - selected method available on element classes
        Mesh.all.forEach((m: Mesh) => m.selected && m.unselect?.());
        Group.all.forEach((g: Group) => {
          if (g.selected) g.selected = false;
        });
      }

      for (const el of targets) {
        if (el instanceof Group) {
          el.selected = true;
          continue;
        }
        // @ts-ignore - select method available on outliner elements
        el.select?.({ shiftKey: true });
      }

      updateSelection();
      Canvas.updateAll();

      return JSON.stringify(
        {
          type,
          selected: targets.length,
          parent_group: parentScope?.name ?? null,
        },
        null,
        2
      );
    },
  }, elementToolDocs[6].status);

  createTool(elementToolDocs[7].name, {
    ...elementToolDocs[7],
    async execute({ texture, include_face_keys }) {
      const tex = findTextureOrThrow(texture);
      const matches: IFilterByMaterialMatch[] = [];

      for (const cube of Cube.all) {
        const faceKeys: string[] = [];
        for (const [key, face] of Object.entries(cube.faces ?? {})) {
          const faceTexId = (face as { texture?: unknown }).texture;
          if (faceTexId === tex.uuid || faceTexId === tex.id) {
            faceKeys.push(key);
          }
        }
        if (faceKeys.length > 0) {
          matches.push({
            uuid: cube.uuid,
            name: cube.name,
            type: "cube",
            ...(include_face_keys ? { faces: faceKeys } : {}),
          });
        }
      }

      for (const mesh of Mesh.all) {
        const faceKeys: string[] = [];
        for (const [key, face] of Object.entries(mesh.faces ?? {})) {
          const faceTexId = (face as { texture?: unknown }).texture;
          if (faceTexId === tex.uuid || faceTexId === tex.id) {
            faceKeys.push(key);
          }
        }
        if (faceKeys.length > 0) {
          matches.push({
            uuid: mesh.uuid,
            name: mesh.name,
            type: "mesh",
            ...(include_face_keys ? { faces: faceKeys } : {}),
          });
        }
      }

      return JSON.stringify(
        {
          texture: { uuid: tex.uuid, name: tex.name },
          count: matches.length,
          matches,
        },
        null,
        2
      );
    },
  }, elementToolDocs[7].status);

  createTool(elementToolDocs[8].name, {
    ...elementToolDocs[8],
    async execute({
      ids,
      group,
      selected_only,
      include_groups,
      include_faces,
      include_mesh_geometry,
      limit,
    }) {
      let scopeLabel: "ids" | "group" | "selection" | "all";
      let candidates: Array<Cube | Mesh | Group>;

      if (ids && ids.length) {
        scopeLabel = "ids";
        candidates = ids.map((id: string) => findElementOrThrow(id)) as Array<
          Cube | Mesh | Group
        >;
      } else if (group) {
        scopeLabel = "group";
        // @ts-ignore - Group is a Blockbench global
        const g = Group.all.find(
          (x: Group) => x.uuid === group || x.name === group
        );
        if (!g) {
          throw new Error(
            `Group "${group}" not found. Use list_outline to see available groups.`
          );
        }
        candidates = [
          ...Cube.all.filter((c: Cube) => isDescendantOf(c, g)),
          ...Mesh.all.filter((m: Mesh) => isDescendantOf(m, g)),
          ...(include_groups
            ? Group.all.filter((sg: Group) => sg !== g && isDescendantOf(sg, g))
            : []),
        ];
      } else if (selected_only) {
        scopeLabel = "selection";
        candidates = [
          ...Cube.selected,
          ...Mesh.selected,
          ...(include_groups
            ? Group.all.filter((g: Group) => g.selected)
            : []),
        ];
      } else {
        scopeLabel = "all";
        candidates = [
          ...Cube.all,
          ...Mesh.all,
          ...(include_groups ? Group.all : []),
        ];
      }

      const truncated = candidates.length > limit;
      const elements = candidates.slice(0, limit).map((el) => {
        if (el instanceof Cube) return serializeCube(el, include_faces);
        if (el instanceof Mesh) return serializeMesh(el, include_mesh_geometry);
        if (el instanceof Group) return serializeGroup(el);
        return {
          uuid: (el as { uuid?: string }).uuid,
          name: (el as { name?: string }).name,
          type: "unknown",
        };
      });

      return JSON.stringify(
        {
          scope: scopeLabel,
          count: elements.length,
          truncated,
          elements,
        },
        null,
        2
      );
    },
  }, elementToolDocs[8].status);

  createTool(elementToolDocs[9].name, {
    ...elementToolDocs[9],
    async execute({ ids, target_group }) {
      const toRoot = target_group === "root";
      // @ts-ignore - Group is a Blockbench global
      const target: Group | "root" | null = toRoot
        ? "root"
        : (Group.all.find(
            (g: Group) => g.uuid === target_group || g.name === target_group
          ) ?? null);

      if (!toRoot && !target) {
        throw new Error(
          `Target group "${target_group}" not found. Use list_outline to see available groups, or pass "root".`
        );
      }

      const elements = ids.map((id: string) => findElementOrThrow(id)) as Array<
        Cube | Mesh | Group
      >;

      // Cycle guard: don't move a group into itself or one of its descendants.
      if (!toRoot && target instanceof Group) {
        for (const el of elements) {
          if (el instanceof Group) {
            if (el === target) {
              throw new Error(`Cannot move group "${el.name}" into itself.`);
            }
            if (isDescendantOf(target, el)) {
              throw new Error(
                `Cannot move group "${el.name}" into its own descendant "${target.name}" — would create a cycle.`
              );
            }
          }
        }
      }

      Undo.initEdit({ elements: [], outliner: true, collections: [] });
      for (const el of elements) {
        // @ts-ignore - addTo accepts a Group or the "root" sentinel (per add_group)
        el.addTo(target);
      }
      Undo.finishEdit("Agent moved elements to group");
      Canvas.updateAll();

      return JSON.stringify(
        {
          moved: elements.length,
          target: toRoot ? "root" : (target as Group).name,
          items: elements.map((el) => ({
            uuid: el.uuid,
            name: el.name,
            type: getElementType(el),
          })),
        },
        null,
        2
      );
    },
  }, elementToolDocs[9].status);
}

/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";

// ============================================================================
// Selection-state read tool
//
// Closes the agent ↔ user handoff gap: when the user manually picks a face,
// vertex, or cube in Blockbench, the agent has had no way to read what's
// selected. `get_project_state` exposes the active mode but not the selection.
//
// This tool returns a comprehensive snapshot of the current selection across
// all relevant levels: outliner elements, mesh sub-element selections,
// active group, active animation. Read-only.
//
// Author: McMarius11 fork (asset-generator-blockbench)
// ============================================================================

export const getSelectionParameters = z.object({});

export const selectionToolDocs: ToolSpec[] = [
  {
    name: "get_selection",
    description:
      "Read the current Blockbench selection across all levels: outliner elements (cubes, meshes, groups, locators, null objects), mesh sub-selections (vertices/edges/faces per mesh), active group, active animation, current mode and tool. Read-only diagnostic for the agent-user handoff workflow ('paint the selected face red', 'extrude the picked edge').",
    annotations: {
      title: "Get Current Selection",
      destructiveHint: false,
      readOnlyHint: true,
    },
    parameters: getSelectionParameters,
    status: STATUS_STABLE,
  },
];

export function registerSelectionTools() {
  createTool(
    selectionToolDocs[0].name,
    {
      ...selectionToolDocs[0],
      async execute() {
        // @ts-ignore - Project is a Blockbench global
        if (!Project) {
          return JSON.stringify({ project_open: false }, null, 2);
        }

        // @ts-ignore - Project.selected_elements is OutlinerElement[]
        const elements: OutlinerElement[] = Project.selected_elements ?? [];

        // Bucket selected outliner elements by class.
        const buckets: Record<string, Array<{ name: string; uuid: string }>> = {
          cubes: [],
          meshes: [],
          groups: [],
          locators: [],
          null_objects: [],
          texture_meshes: [],
          armatures: [],
          armature_bones: [],
          other: [],
        };

        for (const el of elements) {
          const entry = { name: (el as any).name, uuid: (el as any).uuid };
          // @ts-ignore - constructor name disambiguates element type
          const tag = (el as any).constructor?.name ?? "other";
          switch (tag) {
            case "Cube":
              buckets.cubes.push(entry);
              break;
            case "Mesh":
              buckets.meshes.push(entry);
              break;
            case "Group":
              buckets.groups.push(entry);
              break;
            case "Locator":
              buckets.locators.push(entry);
              break;
            case "NullObject":
              buckets.null_objects.push(entry);
              break;
            case "TextureMesh":
              buckets.texture_meshes.push(entry);
              break;
            case "Armature":
              buckets.armatures.push(entry);
              break;
            case "ArmatureBone":
              buckets.armature_bones.push(entry);
              break;
            default:
              buckets.other.push({ ...entry, kind: tag } as any);
          }
        }

        // Mesh sub-element selections (vertices/edges/faces per mesh).
        // Keyed by mesh uuid → { vertices, edges, faces }.
        const meshSelection: Record<
          string,
          {
            mesh_name: string;
            vertices: string[];
            edges: Array<[string, string]>;
            faces: string[];
          }
        > = {};

        // @ts-ignore - Mesh is a Blockbench global
        if (typeof Mesh !== "undefined") {
          // @ts-ignore
          for (const m of Mesh.selected ?? []) {
            try {
              meshSelection[m.uuid] = {
                mesh_name: m.name,
                vertices:
                  typeof m.getSelectedVertices === "function"
                    ? m.getSelectedVertices(false).slice()
                    : [],
                edges:
                  typeof m.getSelectedEdges === "function"
                    ? m.getSelectedEdges(false).slice()
                    : [],
                faces:
                  typeof m.getSelectedFaces === "function"
                    ? m.getSelectedFaces(false).slice()
                    : [],
              };
            } catch {
              /* mesh sub-selection probe failed — skip silently */
            }
          }
        }

        // Active group (the one with the dotted outliner highlight).
        let active_group: { name: string; uuid: string } | null = null;
        // @ts-ignore
        if (Project.selected_group) {
          // @ts-ignore
          active_group = {
            // @ts-ignore
            name: Project.selected_group.name,
            // @ts-ignore
            uuid: Project.selected_group.uuid,
          };
        }

        // Active animation (per-project).
        let active_animation:
          | { name: string; uuid: string; loop: string; length: number }
          | null = null;
        // @ts-ignore - Animation is a Blockbench global
        if (typeof Animation !== "undefined" && (Animation as any).selected) {
          // @ts-ignore
          const a = (Animation as any).selected;
          active_animation = {
            name: a.name,
            uuid: a.uuid,
            loop: a.loop,
            length: a.length,
          };
        }

        // Current mode + tool.
        // @ts-ignore - Modes is a Blockbench global
        const current_mode =
          typeof Modes !== "undefined" && (Modes as any).selected
            ? (Modes as any).selected.id
            : null;
        // @ts-ignore - Toolbox is a Blockbench global
        const current_tool =
          typeof Toolbox !== "undefined" && (Toolbox as any).selected
            ? (Toolbox as any).selected.id
            : null;

        return JSON.stringify(
          {
            project_open: true,
            current_mode,
            current_tool,
            active_group,
            active_animation,
            elements: buckets,
            element_count: elements.length,
            mesh_selection: meshSelection,
          },
          null,
          2
        );
      },
    },
    selectionToolDocs[0].status
  );
}

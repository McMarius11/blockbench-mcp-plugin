/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { findMeshOrThrow, getMeshOrSelected } from "@/lib/util";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import {
  meshIdSchema,
  meshIdOptionalSchema,
  vector2Schema,
  uvMappingModeEnum,
  uvRotationAngleEnum,
  faceKeysOptionalSchema,
} from "@/lib/zodObjects";

// ============================================================================
// UV Tool Parameter Schemas
// ============================================================================

/** Parameters for setting mesh UV */
export const setMeshUvParametersSchema = z.object({
  mesh_id: meshIdSchema,
  face_key: z.string().describe("Face key to set UV for."),
  uv_mapping: z
    .record(
      z.string(), // vertex key
      vector2Schema // UV coordinates
    )
    .describe("UV coordinates for each vertex of the face."),
});

/** Parameters for auto UV mesh */
export const autoUvMeshParametersSchema = z.object({
  mesh_id: meshIdOptionalSchema,
  mode: uvMappingModeEnum
    .default("project")
    .describe(
      "UV mapping mode: project from view, unwrap, cylinder, or sphere mapping."
    ),
  faces: faceKeysOptionalSchema.describe(
    "Specific face keys to UV map. If not provided, maps all selected faces."
  ),
});

/** Parameters for rotating mesh UV */
export const rotateMeshUvParametersSchema = z.object({
  mesh_id: meshIdOptionalSchema,
  angle: uvRotationAngleEnum.default("90").describe("Rotation angle in degrees."),
  faces: faceKeysOptionalSchema.describe(
    "Specific face keys to rotate UV for. If not provided, rotates all selected faces."
  ),
});

/** Parameters for transforming a UV island */
export const uvIslandTransformParametersSchema = z.object({
  mesh_id: meshIdOptionalSchema,
  seed_face: z
    .string()
    .optional()
    .describe(
      "Face key whose UV island to transform. If omitted, the first selected face is used as seed; the island is expanded via MeshFace.getUVIsland()."
    ),
  translate: z
    .array(z.number())
    .length(2)
    .optional()
    .describe("UV translation [du, dv] in project pixel units."),
  scale: z
    .union([
      z.number(),
      z.array(z.number()).length(2),
    ])
    .optional()
    .describe(
      "Uniform scale factor or [scale_u, scale_v]. Applied around the island's UV centroid."
    ),
  rotate_degrees: z
    .number()
    .optional()
    .describe(
      "Rotation in degrees around the island's UV centroid (positive = counter-clockwise)."
    ),
});

// ============================================================================
// UV Tool Docs
// ============================================================================

export const uvToolDocs: ToolSpec[] = [
  {
    name: "set_mesh_uv",
    description: "Sets UV coordinates for mesh faces or vertices.",
    annotations: {
      title: "Set Mesh UV",
      destructiveHint: true,
    },
    parameters: setMeshUvParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "auto_uv_mesh",
    description: "Automatically generates UV mapping for selected mesh faces.",
    annotations: {
      title: "Auto UV Mesh",
      destructiveHint: true,
    },
    parameters: autoUvMeshParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "rotate_mesh_uv",
    description: "Rotates UV coordinates of selected mesh faces.",
    annotations: {
      title: "Rotate Mesh UV",
      destructiveHint: true,
    },
    parameters: rotateMeshUvParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "uv_island_transform",
    description:
      "Translate / scale / rotate an entire UV island (a connected set of faces sharing UV seams) on a mesh. Uses MeshFace.getUVIsland() to discover all faces in the island from a seed face. Combine multiple ops: translate is applied first, then scale, then rotate (all around the island's UV centroid). Useful for atlas repacking or fitting an unwrapped island to a specific texture region.",
    annotations: {
      title: "Transform UV Island",
      destructiveHint: true,
    },
    parameters: uvIslandTransformParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerUVTools() {
  createTool(
    uvToolDocs[0].name,
    {
      ...uvToolDocs[0],
      async execute({ mesh_id, face_key, uv_mapping }) {
        const mesh = findMeshOrThrow(mesh_id);

        Undo.initEdit({
          elements: [mesh],
          uv_only: true,
        });

        const face = mesh.faces[face_key];
        if (!face) {
          throw new Error(`Face with key "${face_key}" not found in mesh.`);
        }

        // Set UV coordinates for each vertex
        Object.entries(uv_mapping).forEach(([vkey, uv]) => {
          if (face.vertices.includes(vkey)) {
            face.uv[vkey] = uv;
          }
        });

        mesh.preview_controller.updateUV(mesh);
        UVEditor.loadData();

        Undo.finishEdit("Set mesh UV");

        return `Set UV mapping for face "${face_key}" of mesh "${mesh.name}"`;
      },
    },
    uvToolDocs[0].status
  );

  createTool(
    uvToolDocs[1].name,
    {
      ...uvToolDocs[1],
      async execute({ mesh_id, mode, faces }) {
        const mesh = getMeshOrSelected(mesh_id);

        Undo.initEdit({
          elements: [mesh],
          uv_only: true,
        });

        const selectedFaces = faces || UVEditor.getSelectedFaces(mesh);

        if (mode === "project") {
          // Use project from view
          BarItems.uv_project_from_view.click();
        } else {
          // Manual UV mapping based on mode
          selectedFaces.forEach((fkey) => {
            const face = mesh.faces[fkey];
            if (!face) return;

            if (mode === "unwrap") {
              // Simple planar unwrap
              UVEditor.setAutoSize(null, true, [fkey]);
            } else if (mode === "cylinder") {
              // Cylindrical mapping
              const vertices = face.getSortedVertices();
              vertices.forEach((vkey, i) => {
                const vertex = mesh.vertices[vkey];
                const angle = Math.atan2(vertex[0], vertex[2]);
                const u =
                  ((angle + Math.PI) / (2 * Math.PI)) * Project.texture_width;
                const v = ((vertex[1] + 8) / 16) * Project.texture_height;
                face.uv[vkey] = [u, v];
              });
            } else if (mode === "sphere") {
              // Spherical mapping
              const vertices = face.getSortedVertices();
              vertices.forEach((vkey) => {
                const vertex = mesh.vertices[vkey];
                const length = Math.sqrt(
                  vertex[0] ** 2 + vertex[1] ** 2 + vertex[2] ** 2
                );
                const theta = Math.acos(vertex[1] / length);
                const phi = Math.atan2(vertex[0], vertex[2]);
                const u =
                  ((phi + Math.PI) / (2 * Math.PI)) * Project.texture_width;
                const v = (theta / Math.PI) * Project.texture_height;
                face.uv[vkey] = [u, v];
              });
            }
          });
        }

        mesh.preview_controller.updateUV(mesh);
        UVEditor.loadData();

        Undo.finishEdit("Auto UV mesh");

        return `Applied ${mode} UV mapping to ${selectedFaces.length} faces of mesh "${mesh.name}"`;
      },
    },
    uvToolDocs[1].status
  );

  createTool(
    uvToolDocs[2].name,
    {
      ...uvToolDocs[2],
      async execute({ mesh_id, angle, faces }) {
        const mesh = getMeshOrSelected(mesh_id);

        Undo.initEdit({
          elements: [mesh],
          uv_only: true,
        });

        // Set the face selection before rotating so UVEditor.rotate
        // operates on the caller-specified faces instead of whatever
        // happens to be selected in the viewport.
        if (faces && faces.length > 0) {
          const sel = mesh.getSelectedFaces(true);
          sel.length = 0;
          sel.push(...faces);
        }

        const rotation = parseInt(angle);
        UVEditor.rotate(rotation);

        Undo.finishEdit("Rotate mesh UV");

        const affected = faces ?? mesh.getSelectedFaces();
        return `Rotated UV by ${angle} degrees for ${affected.length} faces of mesh "${mesh.name}"`;
      },
    },
    uvToolDocs[2].status
  );

  // ---- uv_island_transform ----
  createTool(
    uvToolDocs[3].name,
    {
      ...uvToolDocs[3],
      async execute({
        mesh_id,
        seed_face,
        translate,
        scale,
        rotate_degrees,
      }: {
        mesh_id?: string;
        seed_face?: string;
        translate?: [number, number];
        scale?: number | [number, number];
        rotate_degrees?: number;
      }) {
        if (
          translate === undefined &&
          scale === undefined &&
          rotate_degrees === undefined
        ) {
          throw new Error(
            "Provide at least one of translate / scale / rotate_degrees."
          );
        }

        const mesh = getMeshOrSelected(mesh_id);

        // Resolve seed face: explicit > first selected > first face overall.
        let seed = seed_face;
        if (!seed) {
          const sel =
            typeof mesh.getSelectedFaces === "function"
              ? mesh.getSelectedFaces(false)
              : [];
          seed = sel[0];
        }
        if (!seed) {
          seed = Object.keys(mesh.faces)[0];
        }
        if (!seed || !mesh.faces[seed]) {
          throw new Error(
            `No usable seed face on mesh "${mesh.name}" — pass seed_face or select a face first.`
          );
        }

        const seedFace: any = mesh.faces[seed];
        const islandKeys: string[] =
          typeof seedFace.getUVIsland === "function"
            ? seedFace.getUVIsland()
            : [seed];
        if (!islandKeys.length) {
          throw new Error(`Empty UV island for seed face "${seed}".`);
        }

        Undo.initEdit({ elements: [mesh], uv_only: true });

        // Collect every (faceKey, vertexKey) pair in the island and gather
        // the centroid of their current UV positions for scale/rotate ops.
        const pairs: Array<{ fkey: string; vkey: string }> = [];
        let cx = 0;
        let cy = 0;
        let n = 0;
        for (const fkey of islandKeys) {
          const face: any = mesh.faces[fkey];
          if (!face) continue;
          for (const vkey of Object.keys(face.uv ?? {})) {
            const uv = face.uv[vkey];
            if (!Array.isArray(uv) || uv.length < 2) continue;
            cx += uv[0];
            cy += uv[1];
            n++;
            pairs.push({ fkey, vkey });
          }
        }
        if (n === 0) {
          Undo.finishEdit("UV island transform (noop)");
          return `UV island for seed "${seed}" had no UV vertices.`;
        }
        cx /= n;
        cy /= n;

        const sx = typeof scale === "number" ? scale : scale?.[0] ?? 1;
        const sy = typeof scale === "number" ? scale : scale?.[1] ?? 1;
        const tx = translate?.[0] ?? 0;
        const ty = translate?.[1] ?? 0;
        const theta = ((rotate_degrees ?? 0) * Math.PI) / 180;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        for (const { fkey, vkey } of pairs) {
          const face: any = mesh.faces[fkey];
          const uv = face.uv[vkey] as number[];
          // Apply translate first, then scale around centroid, then rotate.
          let u = uv[0] + tx;
          let v = uv[1] + ty;
          u = (u - cx) * sx + cx;
          v = (v - cy) * sy + cy;
          if (rotate_degrees) {
            const ru = (u - cx) * cosT - (v - cy) * sinT + cx;
            const rv = (u - cx) * sinT + (v - cy) * cosT + cy;
            u = ru;
            v = rv;
          }
          face.uv[vkey] = [u, v];
        }

        // @ts-ignore - Mesh.preview_controller / UVEditor are Blockbench globals
        if (typeof (mesh as any).preview_controller?.updateUV === "function") {
          // @ts-ignore
          (mesh as any).preview_controller.updateUV(mesh);
        }
        // @ts-ignore
        if (typeof (UVEditor as any)?.loadData === "function") {
          // @ts-ignore
          (UVEditor as any).loadData();
        }

        Undo.finishEdit("UV island transform");

        const opsDesc = [
          translate ? `translate=[${tx}, ${ty}]` : null,
          scale !== undefined
            ? `scale=${sx === sy ? sx : `[${sx}, ${sy}]`}`
            : null,
          rotate_degrees ? `rotate=${rotate_degrees}°` : null,
        ]
          .filter(Boolean)
          .join(", ");

        return `Transformed UV island (${islandKeys.length} faces, ${n} verts) of mesh "${mesh.name}": ${opsDesc}.`;
      },
    },
    uvToolDocs[3].status
  );
}

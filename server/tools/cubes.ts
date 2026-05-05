/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { cubeSchema } from "@/lib/zodObjects";
import { STATUS_STABLE } from "@/lib/constants";
import { getProjectTexture } from "@/lib/util";

const cubeFaceEnum = z.enum(["north", "south", "east", "west", "up", "down"]);

export const placeCubeParameters = z.object({
  elements: z.array(cubeSchema).min(1).describe("Array of cubes to place."),
  texture: z
    .string()
    .optional()
    .describe("Texture ID or name to apply to the cube."),
  group: z
    .string()
    .optional()
    .describe("Group/bone to which the cube belongs."),
  faces: z
    .union([
      z
        .array(z.enum(["north", "south", "east", "west", "up", "down"]))
        .describe("Array of faces to apply the texture to."),
      z
        .boolean()
        .optional()
        .describe(
          "Whether to apply the texture to all faces. Set to `true` to enable auto UV mapping."
        ),
      z
        .array(
          z.object({
            face: z
              .enum(["north", "south", "east", "west", "up", "down"])
              .describe("Face to apply the texture to."),
            uv: z
              .array(z.number()).length(4)
              .describe("Custom UV mapping for the face."),
          })
        )
        .describe("Array of faces with custom UV mapping."),
    ])
    .optional()
    .default(true)
    .describe(
      "Faces to apply the texture to. Set to `true` to enable auto UV mapping."
    ),
});

export const modifyCubeParameters = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "ID or name of the cube to modify. Defaults to selected, which could be more than one."
    ),
  name: z.string().optional().describe("New name of the cube."),
  origin: z
    .array(z.number()).length(3)
    .optional()
    .describe("Pivot point of the cube."),
  from: z
    .array(z.number()).length(3)
    .optional()
    .describe("Starting point of the cube."),
  to: z
    .array(z.number()).length(3)
    .optional()
    .describe("Ending point of the cube."),
  rotation: z
    .array(z.number()).length(3)
    .optional()
    .describe("Rotation of the cube."),
  autouv: z
    .enum(["0", "1", "2"])
    .optional()
    .describe(
      "Auto UV setting. 0 = disabled, 1 = enabled, 2 = relative auto UV."
    ),
  uv_offset: z
    .array(z.number()).length(2)
    .optional()
    .describe("UV offset for the texture."),
  mirror_uv: z.boolean().optional().describe("Whether to mirror the UVs."),
  shade: z
    .boolean()
    .optional()
    .describe("Whether to apply shading to the cube."),
  inflate: z.number().optional().describe("Inflation amount for the cube."),
  color: z
    .number()
    .optional()
    .describe("Single digit to represent a color from a palette."),
  visibility: z
    .boolean()
    .optional()
    .describe("Whether the cube is visible or not."),
});

export const modifyCubeUvParameters = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "ID or name of the cube to modify. Defaults to selected (single cube)."
    ),
  faces: z
    .array(
      z.object({
        face: cubeFaceEnum.describe(
          "Cube face to update: north / south / east / west / up / down."
        ),
        uv: z
          .array(z.number())
          .length(4)
          .optional()
          .describe(
            "UV rectangle in project pixel coordinates [u1, v1, u2, v2]."
          ),
        rotation: z
          .union([
            z.literal(0),
            z.literal(90),
            z.literal(180),
            z.literal(270),
          ])
          .optional()
          .describe("Face UV rotation in degrees (0/90/180/270)."),
        texture: z
          .string()
          .optional()
          .describe(
            "Optional texture id/name to assign to this face. Pass an empty string to clear."
          ),
        enabled: z
          .boolean()
          .optional()
          .describe("Whether this face is rendered. Default true."),
        tint: z
          .number()
          .optional()
          .describe("Bedrock-style face tint index (-1 disables)."),
      })
    )
    .min(1)
    .describe("Per-face UV / rotation / texture overrides to apply."),
});

export const cubeToolDocs: ToolSpec[] = [
  {
    name: "place_cube",
    description:
      "Places a cube of the given size at the specified position. Texture and group are optional.",
    annotations: {
      title: "Place Cube",
      destructiveHint: true,
    },
    parameters: placeCubeParameters,
    status: STATUS_STABLE,
  },
  {
    name: "modify_cube",
    description:
      "Modifies the cube with the given ID. Auto UV setting: saved as an integer, where 0 means disabled, 1 means enabled, and 2 means relative auto UV (cube position affects UV)",
    annotations: {
      title: "Modify Cube",
      destructiveHint: true,
    },
    parameters: modifyCubeParameters,
    status: STATUS_STABLE,
  },
  {
    name: "modify_cube_uv",
    description:
      "Edit per-face UV / rotation / texture / tint on an existing cube. Complements `place_cube` (which only accepts face UVs at creation time) and `modify_cube` (which exposes only box-UV / autouv / uv_offset). UV coordinates are in the project's pixel space (texture_width × texture_height) — match `set_project_resolution`. For tile-kit / atlas-packed cube models.",
    annotations: {
      title: "Modify Cube Face UV",
      destructiveHint: true,
    },
    parameters: modifyCubeUvParameters,
    status: STATUS_STABLE,
  },
];

export function registerCubesTools() {
createTool(cubeToolDocs[0].name, {
  ...cubeToolDocs[0],
  async execute({ elements, texture, faces, group }) {
    Undo.initEdit({
      elements: [],
      outliner: true,
      collections: [],
    });
    const total = elements.length;

    const projectTexture = texture
      ? getProjectTexture(texture)
      : Texture.getDefault();

    if (!projectTexture) {
      throw new Error(`No texture found for "${texture}".`);
    }

    // @ts-expect-error Blockbench global utility available at runtime
    const groups = getAllGroups();
    const outlinerGroup = group === "root"
      ? "root"
      : groups.find((g: any) => g.name === group || g.uuid === group) ?? "root";

    const autouv =
      faces === true ||
      (Array.isArray(faces) &&
        faces.every((face) => typeof face === "string"));

    const cubes = elements.map((element: Cube) => {
      const cube = new Cube({
        autouv: autouv ? 1 : 0,
        name: element.name,
        from: element.from as [number, number, number],
        to: element.to as [number, number, number],
        origin: element.origin as [number, number, number],
        rotation: element.rotation as [number, number, number],
      }).init();

      cube.addTo(outlinerGroup);

      if (!autouv && Array.isArray(faces)) {
        faces.forEach(({ face, uv }) => {
          cube.faces[face].extend({
            uv: uv as [number, number, number, number],
          });
        });
      } else {
        cube.applyTexture(
          projectTexture,
          faces !== false ? faces : undefined
        );
        cube.mapAutoUV();
      }

      return cube;
    });

    Undo.finishEdit("Agent placed cubes");
    Canvas.updateAll();

    return await Promise.resolve(
      JSON.stringify(
        cubes.map((cube: Cube) => `Added cube ${cube.name} with ID ${cube.uuid}`)
      )
    );
  },
}, cubeToolDocs[0].status);

createTool(cubeToolDocs[1].name, {
  ...cubeToolDocs[1],
  async execute({
    id,
    name,
    origin,
    from,
    to,
    rotation,
    uv_offset,
    autouv,
    mirror_uv,
    shade,
    inflate,
    color,
    visibility,
  }) {
    let cubes: Cube[];
    if (id) {
      cubes = (Cube.all ?? []).filter((el: Cube) => el.uuid === id || el.name === id);
      if (!cubes.length) {
        throw new Error(`Cube with ID "${id}" not found. Use the list_outline tool to see available cubes.`);
      }
    } else {
      cubes = Cube.selected;
      if (!cubes.length) {
        throw new Error("No cube selected and no id provided. Select a cube or provide an id.");
      }
    }

    Undo.initEdit({
      elements: Array.isArray(cubes) ? cubes : [cubes],
      outliner: true,
      collections: [],
    });

    cubes.forEach((cube) => {
      const cubeOrigin: [number, number, number] = (origin ?? cube.origin) as [number, number, number];
      const cubeFrom: [number, number, number] = (from ?? cube.from) as [number, number, number];
      const cubeTo: [number, number, number] = (to ?? cube.to) as [number, number, number];
      const cubeRotation: [number, number, number] = (rotation ?? cube.rotation) as [number, number, number];
      const cubeUVOffset: [number, number] = (uv_offset ?? cube.uv_offset) as [number, number];

      cube.extend({
        name: name ?? cube.name,
        origin: cubeOrigin,
        from: cubeFrom,
        to: cubeTo,
        rotation: cubeRotation,
        uv_offset: cubeUVOffset,
        autouv: autouv ? (Number(autouv) as 0 | 1 | 2) : cube.autouv,
        mirror_uv: Boolean(mirror_uv ?? cube.mirror_uv),
        inflate: inflate ?? cube.inflate,
        color: color ?? cube.color,
        visibility: visibility ?? cube.visibility,
        shade: shade ?? cube.shade,
      });
    });

    Undo.finishEdit("Agent modified cubes");
    Canvas.updateAll();

    return `Modified cubes ${cubes
      .map((cube) => cube.name)
      .join(", ")} with IDs ${cubes.map((cube) => cube.uuid).join(", ")}`;
  },
}, cubeToolDocs[1].status);

createTool(cubeToolDocs[2].name, {
  ...cubeToolDocs[2],
  async execute({ id, faces }) {
    let cube: Cube | undefined;
    if (id) {
      cube = (Cube.all ?? []).find(
        (c: Cube) => c.uuid === id || c.name === id
      );
      if (!cube) {
        throw new Error(
          `Cube "${id}" not found. Use list_outline to see available cubes.`
        );
      }
    } else {
      cube = Cube.selected[0];
      if (!cube) {
        throw new Error(
          "No cube selected and no id provided. Select a cube or pass an id."
        );
      }
    }

    Undo.initEdit({
      elements: [cube],
      uv_only: true,
      collections: [],
    });

    const updated: string[] = [];
    for (const spec of faces) {
      const cubeFace = cube.faces[spec.face];
      if (!cubeFace) {
        throw new Error(
          `Cube "${cube.name}" has no face "${spec.face}".`
        );
      }
      const patch: Record<string, any> = {};
      if (spec.uv !== undefined) patch.uv = spec.uv;
      if (spec.rotation !== undefined) patch.rotation = spec.rotation;
      if (spec.tint !== undefined) patch.tint = spec.tint;
      if (spec.enabled !== undefined) patch.enabled = spec.enabled;
      if (spec.texture !== undefined) {
        if (spec.texture === "") {
          patch.texture = null;
        } else {
          const tex = getProjectTexture(spec.texture);
          if (!tex) {
            throw new Error(
              `Texture "${spec.texture}" not found. Use list_textures.`
            );
          }
          // Blockbench accepts the Texture instance via face.extend({texture}).
          patch.texture = tex;
        }
      }
      cubeFace.extend(patch);
      updated.push(spec.face);
    }

    Undo.finishEdit("Agent modified cube face UV");
    Canvas.updateAll();

    return `Updated faces [${updated.join(", ")}] on cube "${cube.name}" (UUID: ${cube.uuid}).`;
  },
}, cubeToolDocs[2].status);
}

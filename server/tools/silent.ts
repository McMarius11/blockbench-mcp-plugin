/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";

// ============================================================================
// Silent I/O + workflow tools
//
// Added to close gaps the upstream MCP plugin has against Blockbench's
// own action surface — primarily the popup-blocking dialog problem with
// `save_project` / `export_gltf`, plus a handful of state operations
// that previously required `risky_eval`.
//
// Author: McMarius11 fork (asset-generator-blockbench)
// ============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the Node fs module via Blockbench's permission-aware native loader. */
function getFs(): any {
  // @ts-ignore - requireNativeModule is a Blockbench global
  return requireNativeModule("fs");
}

function ensureProject(): void {
  if (!Project) throw new Error("No project is open.");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const savePathParameters = z.object({
  path: z
    .string()
    .describe(
      "Absolute filesystem path to write to. Parent directory must exist."
    ),
  compressed: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to compress the .bbmodel with LZUTF8 (Blockbench's default). Set false for plain JSON."
    ),
});

export const exportGltfPathParameters = z.object({
  path: z
    .string()
    .describe("Absolute filesystem path to write the .glb / .gltf to."),
  embed_textures: z
    .boolean()
    .optional()
    .default(true)
    .describe("Embed texture data inline in the glTF (recommended for Godot)."),
  animations: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include animations in the export."),
});

export const setProjectResolutionParameters = z.object({
  width: z
    .number()
    .min(16)
    .max(4096)
    .describe("Project's texture_width — controls the UV coordinate space."),
  height: z
    .number()
    .min(16)
    .max(4096)
    .describe("Project's texture_height — controls the UV coordinate space."),
});

export const deleteTextureParameters = z.object({
  id: z
    .string()
    .describe("Texture UUID, name, or numeric id."),
});

export const switchToTabParameters = z.object({
  tab: z
    .enum(["edit", "paint", "animate", "display"])
    .describe(
      "Blockbench tab/mode to switch to. Use 'edit' before glTF export to avoid animation pose-baking bugs."
    ),
});

// ---------------------------------------------------------------------------
// Tool docs
// ---------------------------------------------------------------------------

export const silentToolDocs: ToolSpec[] = [
  {
    name: "save_project_silent",
    description:
      "Save the current project as .bbmodel to a specific path WITHOUT showing the OS-native save dialog. Replaces `trigger_action(save_project)` for non-interactive workflows.",
    annotations: {
      title: "Save Project Silently",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: savePathParameters,
    status: STATUS_STABLE,
  },
  {
    name: "export_gltf_silent",
    description:
      "Export the current project as glTF/GLB to a specific path WITHOUT a dialog. Replaces `trigger_action(export_gltf)` for non-interactive workflows.",
    annotations: {
      title: "Export glTF Silently",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: exportGltfPathParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "force_backup_now",
    description:
      "Force Blockbench to write a backup .bbmodel to its auto-save folder immediately. Useful when the agent needs the latest state but the 10-minute auto-save hasn't fired yet.",
    annotations: {
      title: "Force Backup Now",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: z.object({}),
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "set_project_resolution",
    description:
      "Set the project's texture_width and texture_height. UV coordinates passed to `place_cube(faces[].uv)` are interpreted in this coordinate space — set this to match your texture/atlas pixel size BEFORE placing cubes with explicit UVs.",
    annotations: {
      title: "Set Project Resolution",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: setProjectResolutionParameters,
    status: STATUS_STABLE,
  },
  {
    name: "delete_texture",
    description:
      "Remove a texture from the project. Useful for cleaning up orphan textures before export.",
    annotations: {
      title: "Delete Texture",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: deleteTextureParameters,
    status: STATUS_STABLE,
  },
  {
    name: "switch_to_tab",
    description:
      "Switch the Blockbench mode tab (edit / paint / animate / display). Use this to switch back to 'edit' before exporting glTF, working around Blockbench bug #2224 where exporting from animate-tab bakes the current scrub frame into the rest pose.",
    annotations: {
      title: "Switch Mode Tab",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: switchToTabParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_project_state",
    description:
      "Return the current project's metadata: name, format, save path, texture resolution, element/texture/animation counts, current tab. Useful for diagnostics.",
    annotations: {
      title: "Get Project State",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: z.object({}),
    status: STATUS_STABLE,
  },
];

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSilentTools() {
  // ---- save_project_silent ----
  createTool(
    silentToolDocs[0].name,
    {
      ...silentToolDocs[0],
      async execute({ path, compressed }: { path: string; compressed: boolean }) {
        ensureProject();
        const fs = getFs();

        // Use Blockbench's project codec to serialize current state
        // @ts-ignore - Codecs is a Blockbench global
        const codec = Codecs.project;
        if (!codec || typeof codec.compile !== "function") {
          throw new Error("Blockbench project codec not available.");
        }
        let content = codec.compile({ raw: false });

        // Apply LZUTF8 compression matching Blockbench's default save format
        if (compressed) {
          // @ts-ignore - LZUTF8 is bundled into Blockbench
          if (typeof LZUTF8 !== "undefined") {
            // @ts-ignore
            const compressedBody = LZUTF8.compress(content, {
              outputEncoding: "StorageBinaryString",
            });
            content = "<lz>" + compressedBody;
          } else {
            console.warn("[MCP] LZUTF8 not found, writing plain JSON.");
          }
        }

        fs.writeFileSync(path, content);

        // Update project state so subsequent Ctrl+S knows where to go
        // @ts-ignore - Project is a Blockbench global
        if (Project) {
          // @ts-ignore
          Project.save_path = path;
          // @ts-ignore
          Project.saved = true;
        }

        return `Saved project silently to ${path} (${content.length} bytes, ${compressed ? "compressed" : "plain"}).`;
      },
    },
    silentToolDocs[0].status
  );

  // ---- export_gltf_silent ----
  createTool(
    silentToolDocs[1].name,
    {
      ...silentToolDocs[1],
      async execute({
        path,
        embed_textures,
        animations,
      }: {
        path: string;
        embed_textures: boolean;
        animations: boolean;
      }) {
        ensureProject();
        const fs = getFs();

        // Find the gltf codec — Blockbench registers it under different IDs across versions
        // @ts-ignore - Codecs is a Blockbench global
        const codec =
          (typeof Codecs !== "undefined" &&
            (Codecs.gltf || Codecs.gltf_2 || Codecs["gltf 2"])) ||
          // fallback: search all codecs for one whose extensions include gltf/glb
          // @ts-ignore
          (typeof Codecs !== "undefined"
            ? Object.values(Codecs).find(
                (c: any) =>
                  c?.extension &&
                  (c.extension === "glb" || c.extension === "gltf")
              )
            : null);

        if (!codec) {
          throw new Error(
            "glTF codec not available in this Blockbench version."
          );
        }

        const options: any = {
          embed_textures: !!embed_textures,
          animations: !!animations,
        };

        const content =
          typeof codec.compile === "function"
            ? codec.compile(options)
            : null;

        if (content === null || content === undefined) {
          throw new Error("glTF compile returned no content.");
        }

        // GLB is binary (Buffer); GLTF is JSON string
        if (Buffer.isBuffer(content)) {
          fs.writeFileSync(path, content);
        } else {
          fs.writeFileSync(path, content, "utf-8");
        }

        return `Exported glTF silently to ${path} (${
          Buffer.isBuffer(content) ? content.length : content.length
        } bytes).`;
      },
    },
    silentToolDocs[1].status
  );

  // ---- force_backup_now ----
  createTool(
    silentToolDocs[2].name,
    {
      ...silentToolDocs[2],
      async execute() {
        ensureProject();
        // Blockbench has an internal AutoSave / Backup mechanism — try common entry points
        // @ts-ignore
        if (typeof BarItems !== "undefined" && BarItems.save_recovery_data) {
          // @ts-ignore
          BarItems.save_recovery_data.click();
          return "Triggered save_recovery_data action.";
        }
        // @ts-ignore
        if (typeof saveRecoveryData === "function") {
          // @ts-ignore
          saveRecoveryData();
          return "Called saveRecoveryData() directly.";
        }
        // @ts-ignore
        if (typeof AutoSave !== "undefined" && typeof AutoSave.saveBackup === "function") {
          // @ts-ignore
          AutoSave.saveBackup();
          return "Called AutoSave.saveBackup().";
        }
        throw new Error(
          "No backup mechanism found in this Blockbench version. Try `save_project_silent` to a known path instead."
        );
      },
    },
    silentToolDocs[2].status
  );

  // ---- set_project_resolution ----
  createTool(
    silentToolDocs[3].name,
    {
      ...silentToolDocs[3],
      async execute({ width, height }: { width: number; height: number }) {
        ensureProject();
        // @ts-ignore
        Project!.texture_width = width;
        // @ts-ignore
        Project!.texture_height = height;
        // @ts-ignore - update all UV mappings to the new resolution
        if (typeof Canvas !== "undefined" && typeof Canvas.updateAllUVs === "function") {
          // @ts-ignore
          Canvas.updateAllUVs();
        }
        return `Set project resolution to ${width}×${height}.`;
      },
    },
    silentToolDocs[3].status
  );

  // ---- delete_texture ----
  createTool(
    silentToolDocs[4].name,
    {
      ...silentToolDocs[4],
      async execute({ id }: { id: string }) {
        ensureProject();
        // @ts-ignore - Texture is a Blockbench global
        const tex = Texture.all.find(
          (t: any) =>
            t.uuid === id || t.name === id || String(t.id) === id || t.name + ".png" === id
        );
        if (!tex) throw new Error(`Texture not found: ${id}`);
        const removedName = tex.name;
        tex.remove(false); // false = no confirm prompt
        return `Deleted texture "${removedName}".`;
      },
    },
    silentToolDocs[4].status
  );

  // ---- switch_to_tab ----
  createTool(
    silentToolDocs[5].name,
    {
      ...silentToolDocs[5],
      async execute({ tab }: { tab: "edit" | "paint" | "animate" | "display" }) {
        // @ts-ignore - Modes is a Blockbench global
        if (typeof Modes === "undefined" || !Modes.options || !Modes.options[tab]) {
          throw new Error(`Mode '${tab}' not available.`);
        }
        // @ts-ignore
        Modes.options[tab].select();
        return `Switched to ${tab} tab.`;
      },
    },
    silentToolDocs[5].status
  );

  // ---- get_project_state ----
  createTool(
    silentToolDocs[6].name,
    {
      ...silentToolDocs[6],
      async execute() {
        // @ts-ignore
        if (!Project) {
          return JSON.stringify({ open: false });
        }
        // @ts-ignore
        const cubes = Cube.all.length;
        // @ts-ignore
        const meshes = typeof Mesh !== "undefined" ? Mesh.all.length : 0;
        // @ts-ignore
        const textures = Texture.all.map((t: any) => ({
          name: t.name,
          uuid: t.uuid,
          width: t.width,
          height: t.height,
        }));
        // @ts-ignore
        const animations =
          typeof Animation !== "undefined" && Animation.all
            ? // @ts-ignore
              Animation.all.map((a: any) => ({
                name: a.name,
                length: a.length,
                loop: a.loop,
              }))
            : [];

        // @ts-ignore
        const currentMode =
          typeof Modes !== "undefined" && Modes.selected
            ? // @ts-ignore
              Modes.selected.id
            : null;

        return JSON.stringify(
          {
            open: true,
            // @ts-ignore
            name: Project.name,
            // @ts-ignore
            uuid: Project.uuid,
            // @ts-ignore
            format: Project.format?.id || null,
            // @ts-ignore
            save_path: Project.save_path || null,
            // @ts-ignore
            texture_width: Project.texture_width,
            // @ts-ignore
            texture_height: Project.texture_height,
            cubes,
            meshes,
            textures,
            animations,
            current_tab: currentMode,
          },
          null,
          2
        );
      },
    },
    silentToolDocs[6].status
  );
}

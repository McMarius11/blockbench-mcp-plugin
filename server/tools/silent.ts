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
    .default(false)
    .describe(
      "Legacy LZUTF8 compression. Modern Blockbench (5.x) writes .bbmodel as plain JSON — leave false unless you specifically need the legacy `<lz>`-prefixed format. If true and LZUTF8 is unavailable in the running Blockbench, the call throws (no silent fallback)."
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
  require_edit_tab: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Guard against Blockbench bug #2224: exporting glTF from the Animate " +
        "tab bakes the current timeline scrub frame into the armature rest " +
        "pose, silently corrupting the runtime rig. When true (default) and " +
        "the active tab is not 'edit', the export auto-switches to the edit " +
        "tab first and reports `switched_from` in the response. Set false to " +
        "export from whatever tab is active (only do this if you know the " +
        "timeline is at the rest frame)."
    ),
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

export const openProjectFileParameters = z.object({
  path: z
    .string()
    .describe(
      "Absolute filesystem path to a .bbmodel file. Loads it as the active project, replacing any currently open project's contents."
    ),
});

export const exportTextureToPngParameters = z.object({
  texture_id: z
    .string()
    .describe("Texture UUID, name, or numeric id to export."),
  path: z
    .string()
    .describe(
      "Absolute filesystem path to write the PNG to. Parent directory must exist."
    ),
});

export const installPluginFromPathParameters = z.object({
  path: z
    .string()
    .describe(
      "Absolute filesystem path to the plugin's compiled .js file (e.g. the fork's dist/mcp.js). The plugin is registered with source='file' so future Blockbench restarts won't auto-overwrite it from a URL source."
    ),
  plugin_id: z
    .string()
    .optional()
    .describe(
      "Optional plugin id. If omitted, derived from the filename (e.g. 'mcp.js' → 'mcp'). For replacing the MCP plugin itself, pass 'mcp' or omit."
    ),
});

export const switchToTabParameters = z.object({
  tab: z
    .enum(["edit", "paint", "animate", "display", "pose"])
    .describe(
      "Blockbench tab/mode to switch to. Use 'edit' before glTF export to avoid animation pose-baking bugs. 'pose' is only available for formats that opt into pose_mode (e.g. armature-rigged formats)."
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Re-select the tab even if it is already active. By default the switch " +
        "is idempotent: if the requested tab is already active the call is a " +
        "no-op and returns `changed: false`, so callers can skip redundant UI " +
        "churn without tracking tab state themselves."
    ),
});

export const getCurrentTabParameters = z.object({});

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
      "Export the current project as glTF/GLB to a specific path WITHOUT a dialog. Replaces `trigger_action(export_gltf)` for non-interactive workflows. Convenience wrapper over the glTF codec with typed `embed_textures` / `animations` options; for arbitrary formats use the general `export_model` tool.",
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
      "Switch the Blockbench mode tab (edit / paint / animate / display). Use this to switch back to 'edit' before exporting glTF, working around Blockbench bug #2224 where exporting from animate-tab bakes the current scrub frame into the rest pose. Idempotent by default: a no-op returning `changed: false` when the tab is already active (pass `force: true` to re-select regardless). Pair with `get_current_tab` to avoid redundant switches in multi-phase builds.",
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
  {
    name: "open_project_file",
    description:
      "Load an existing .bbmodel from disk into the running Blockbench instance, replacing the currently open project. Mirror of `save_project_silent` — handles both LZUTF8-compressed and plain-JSON .bbmodel files. Use this to iterate on previously saved assets without manual File→Open.",
    annotations: {
      title: "Open Project File",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: openProjectFileParameters,
    status: STATUS_STABLE,
  },
  {
    name: "export_texture_to_png",
    description:
      "Write a single project texture to disk as a standalone PNG. Reads the texture's composited canvas (so layered textures are flattened on export). Use this to bake an in-Blockbench atlas back out to disk for Godot import.",
    annotations: {
      title: "Export Texture to PNG",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: exportTextureToPngParameters,
    status: STATUS_STABLE,
  },
  {
    name: "install_plugin_from_path",
    description:
      "Install or replace a Blockbench plugin from a local .js file with source='file'. Survives restarts (unlike URL-source which auto-redownloads). Use to hot-swap fork builds without UI clicks: after `bun run build`, call this with the dist/mcp.js path. CAVEAT: replacing the running MCP plugin causes a brief MCP server disconnect (~200 ms-1 s) — reconnect via /mcp afterwards.",
    annotations: {
      title: "Install Plugin From Path",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: installPluginFromPathParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_current_tab",
    description:
      "Return the currently active Blockbench mode tab (edit / paint / animate / display / pose) as `{ tab }`. Lets automated multi-phase builds read tab state and skip redundant `switch_to_tab` calls (which reload UI state). Lighter than `get_project_state` when you only need the tab.",
    annotations: {
      title: "Get Current Tab",
      destructiveHint: false,
      openWorldHint: false,
    },
    parameters: getCurrentTabParameters,
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

        // Use Blockbench's project codec to serialize current state.
        // @ts-ignore - Codecs is a Blockbench global
        const codec = Codecs.project;
        if (!codec || typeof codec.compile !== "function") {
          throw new Error("Blockbench project codec not available.");
        }
        let content = codec.compile({ raw: false });
        let actuallyCompressed = false;

        // Optional legacy LZUTF8 compression. Modern Blockbench (5.x) writes
        // .bbmodel as plain JSON — this branch is for backward compatibility
        // with older versions or specific tooling that expects the `<lz>`
        // prefix. We throw on missing LZUTF8 instead of silently falling
        // through, so the caller knows their `compressed: true` request
        // didn't produce what they asked for.
        if (compressed) {
          // @ts-ignore - LZUTF8 used to be bundled into Blockbench
          if (typeof LZUTF8 !== "undefined") {
            // @ts-ignore
            const compressedBody = LZUTF8.compress(content, {
              outputEncoding: "StorageBinaryString",
            });
            content = "<lz>" + compressedBody;
            actuallyCompressed = true;
          } else {
            throw new Error(
              "compressed=true requested but LZUTF8 is not available in this Blockbench version. Modern Blockbench writes plain JSON — call with compressed=false (the default)."
            );
          }
        }

        fs.writeFileSync(path, content);

        // Update project state so subsequent Ctrl+S writes back to this file.
        // @ts-ignore - Project is a Blockbench global
        if (Project) {
          // @ts-ignore
          Project.save_path = path;
          // @ts-ignore
          Project.saved = true;
        }

        return `Saved project silently to ${path} (${content.length} bytes, ${actuallyCompressed ? "LZUTF8-compressed" : "plain JSON"}).`;
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
        require_edit_tab,
      }: {
        path: string;
        embed_textures: boolean;
        animations: boolean;
        require_edit_tab: boolean;
      }) {
        ensureProject();
        const fs = getFs();

        // Guard against Blockbench bug #2224: exporting glTF while the Animate
        // (or any non-edit) tab is active bakes the current timeline scrub
        // frame into the armature rest pose, silently corrupting the runtime
        // rig. Auto-correct by switching to the edit tab before compiling.
        let switchedFrom: string | null = null;
        const currentTab: string | null =
          // @ts-ignore - Modes is a Blockbench global; selected is a Mode
          typeof Modes !== "undefined" && Modes.selected ? (Modes.selected as any).id : null;
        if (require_edit_tab && currentTab && currentTab !== "edit") {
          // @ts-ignore
          if (Modes.options && Modes.options.edit) {
            // @ts-ignore
            Modes.options.edit.select();
            switchedFrom = currentTab;
          }
        }

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

        let content =
          typeof codec.compile === "function"
            ? codec.compile(options)
            : null;

        if (content === null || content === undefined) {
          throw new Error("glTF compile returned no content.");
        }

        // In modern Blockbench (5.x+) `codec.compile` may be async and return a Promise.
        if (content && typeof (content as any).then === "function") {
          content = await content;
        }

        // GLB is binary (Buffer); GLTF is JSON string
        if (Buffer.isBuffer(content)) {
          fs.writeFileSync(path, content);
        } else {
          fs.writeFileSync(path, content, "utf-8");
        }

        const sizeNote = `${
          Buffer.isBuffer(content) ? content.length : content.length
        } bytes`;
        return switchedFrom
          ? `Exported glTF silently to ${path} (${sizeNote}). Auto-switched from '${switchedFrom}' to 'edit' tab first to avoid Blockbench #2224 rest-pose baking.`
          : `Exported glTF silently to ${path} (${sizeNote}).`;
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
      async execute({
        tab,
        force,
      }: {
        tab: "edit" | "paint" | "animate" | "display" | "pose";
        force: boolean;
      }) {
        // @ts-ignore - Modes is a Blockbench global
        if (typeof Modes === "undefined" || !Modes.options || !Modes.options[tab]) {
          throw new Error(`Mode '${tab}' not available.`);
        }
        // @ts-ignore - Modes.selected is the active Mode
        const current: string | null = Modes.selected ? (Modes.selected as any).id : null;
        if (current === tab && !force) {
          return JSON.stringify({ tab, changed: false });
        }
        // @ts-ignore
        Modes.options[tab].select();
        return JSON.stringify({ tab, changed: true, previous: current });
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

  // ---- open_project_file ----
  createTool(
    silentToolDocs[7].name,
    {
      ...silentToolDocs[7],
      async execute({ path }: { path: string }) {
        const fs = getFs();
        if (!fs.existsSync(path)) {
          throw new Error(`File not found: ${path}`);
        }

        // .bbmodel is text: either plain JSON or "<lz>"-prefixed LZUTF8.
        let content: string = fs.readFileSync(path, "utf-8");

        if (content.startsWith("<lz>")) {
          // @ts-ignore - LZUTF8 is bundled into Blockbench
          if (typeof LZUTF8 === "undefined") {
            throw new Error(
              "File is LZUTF8-compressed but LZUTF8 is not available in this Blockbench version."
            );
          }
          // @ts-ignore
          content = LZUTF8.decompress(content.substring(4), {
            inputEncoding: "StorageBinaryString",
          });
        }

        let model: any;
        try {
          model = JSON.parse(content);
        } catch (e: any) {
          throw new Error(
            `Failed to parse JSON from ${path}: ${e?.message ?? e}`
          );
        }

        const formatId: string | undefined = model?.meta?.model_format;
        if (!formatId) {
          throw new Error(
            `File missing meta.model_format — not a valid .bbmodel.`
          );
        }

        // @ts-ignore - Formats is a Blockbench global
        const format = Formats[formatId];
        if (!format) {
          throw new Error(
            `Unknown model format "${formatId}" — not registered in this Blockbench version.`
          );
        }

        // Create a fresh project slot for this format. This sets Project to a
        // new ModelProject; the codec.load() below populates it from `model`.
        // @ts-ignore - newProject is a Blockbench global
        newProject(format);

        // @ts-ignore - format.codec is the format-specific load handler
        const codec = format.codec || Codecs.project;
        if (typeof codec.load !== "function") {
          throw new Error(
            `Codec for format "${formatId}" exposes no load() method.`
          );
        }

        // Synthesize a FileResult-like object — Blockbench's load() typically
        // reads .path / .name from this for save-back resolution.
        const file = {
          path,
          name: path.split(/[\/\\]/).pop() ?? "loaded.bbmodel",
          content,
        };

        // @ts-ignore
        codec.load(model, file, { import_to_current_project: false });

        // @ts-ignore - Project is a Blockbench global
        if (Project) {
          // @ts-ignore
          Project.save_path = path;
          // @ts-ignore
          Project.saved = true;
        }

        // @ts-ignore
        const cubes = typeof Cube !== "undefined" ? Cube.all.length : 0;
        // @ts-ignore
        const meshes = typeof Mesh !== "undefined" ? Mesh.all.length : 0;
        // @ts-ignore
        const textures = typeof Texture !== "undefined" ? Texture.all.length : 0;

        return `Opened project from ${path}: "${
          // @ts-ignore
          Project?.name ?? "unnamed"
        }" (format=${formatId}, ${cubes} cubes, ${meshes} meshes, ${textures} textures).`;
      },
    },
    silentToolDocs[7].status
  );

  // ---- export_texture_to_png ----
  createTool(
    silentToolDocs[8].name,
    {
      ...silentToolDocs[8],
      async execute({ texture_id, path }: { texture_id: string; path: string }) {
        ensureProject();
        const fs = getFs();

        // @ts-ignore - Texture is a Blockbench global
        const tex = Texture.all.find(
          (t: any) =>
            t.uuid === texture_id ||
            t.name === texture_id ||
            String(t.id) === texture_id ||
            t.name + ".png" === texture_id
        );
        if (!tex) {
          throw new Error(
            `Texture "${texture_id}" not found. Use list_textures to see available textures.`
          );
        }

        // texture.canvas is the composited source-of-truth (flattens layers).
        const canvas: HTMLCanvasElement | undefined = tex.canvas;
        if (!canvas || typeof canvas.toDataURL !== "function") {
          throw new Error(
            `Texture "${tex.name}" has no canvas data — cannot export.`
          );
        }

        const dataUrl: string = canvas.toDataURL("image/png");
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        fs.writeFileSync(path, buffer);

        return `Exported texture "${tex.name}" (${canvas.width}×${canvas.height}) to ${path} (${buffer.length} bytes).`;
      },
    },
    silentToolDocs[8].status
  );

  // ---- install_plugin_from_path ----
  createTool(
    silentToolDocs[9].name,
    {
      ...silentToolDocs[9],
      async execute({
        path,
        plugin_id,
      }: {
        path: string;
        plugin_id?: string;
      }) {
        const fs = getFs();
        if (!fs.existsSync(path)) {
          throw new Error(`Plugin file not found: ${path}`);
        }

        // Derive plugin id from filename if not provided.
        const filename = path.split(/[\/\\]/).pop() ?? "";
        if (!filename.endsWith(".js")) {
          throw new Error(`Path must point to a .js file: ${path}`);
        }
        const id = plugin_id ?? filename.replace(/\.js$/, "");

        // Pre-validate that we won't trash an unrelated plugin: the slot
        // Plugins.registered[id] must be empty OR be the same plugin we're
        // replacing (matching source/path or already a file-source plugin).
        // @ts-ignore - Plugins is a Blockbench global
        const existing: any = (Plugins as any)?.registered?.[id];
        if (
          existing &&
          existing.source &&
          existing.source !== "file" &&
          existing.source !== "url"
        ) {
          throw new Error(
            `Plugin id "${id}" is already loaded with source="${existing.source}" — refusing to replace. Pass a different plugin_id or uninstall manually first.`
          );
        }

        // Defer the actual install so the MCP response is sent before we
        // tear down the running plugin (which would kill the HTTP socket).
        //
        // Why 250ms is safe: the MCP framework completes the response after
        // our `return` statement (the Express-like layer serializes and
        // pushes to the TCP socket synchronously in the same microtask).
        // For loopback HTTP that flush takes <1ms — we're 2-3 orders of
        // magnitude clear of any plausible serialization delay. Closures
        // on Blockbench globals (Plugin, Plugins, fs, StateMemory,
        // requireNativeModule) survive plugin unload, so the swap completes
        // even though "this" instance is mid-replacement.
        setTimeout(() => {
          try {
            const content: string = fs.readFileSync(path, {
              encoding: "utf-8",
            });
            if (typeof content !== "string" || content.length < 20) {
              throw new Error(`Plugin file is empty or unreadable: ${path}`);
            }

            // @ts-ignore
            let target: any = (Plugins as any)?.registered?.[id];

            if (target) {
              // Same-id replacement: unload (fires onunload — tears down our
              // MCP server) but keep the registered slot. The new code's
              // `Plugin.register(id, {...})` will mutate this instance via
              // extend() and call runOnLoad() to bring it back up.
              try {
                if (typeof target.unload === "function") target.unload();
              } catch (e) {
                console.warn(
                  "[install_plugin_from_path] unload threw (continuing):",
                  e
                );
              }
            } else {
              // First-time install: construct a fresh Plugin and seat it in
              // Plugins.registered[id] before evaluating the new code, so
              // the trailing Plugin.register call finds it.
              // @ts-ignore - Plugin is a Blockbench global
              target = new Plugin(id);
              // @ts-ignore
              if ((Plugins as any).all && !(Plugins as any).all.includes(target)) {
                // @ts-ignore
                (Plugins as any).all.push(target);
              }
            }

            // Mark source + path BEFORE eval so onload/oninstall can read them.
            target.source = "file";
            target.path = path;
            target.tags = Array.isArray(target.tags) ? target.tags : [];
            if (!target.tags.includes("Local")) target.tags.push("Local");

            // @ts-ignore
            (Plugins as any).registered[id] = target;

            // Replicate Blockbench's private #runCode: scoped Function with
            // sourceURL annotation so DevTools can attribute errors to the
            // plugin file.
            const sourceURL = `\n//# sourceURL=PLUGINS/(Plugin):${id}.js`;
            // @ts-ignore - requireNativeModule is a Blockbench global
            const reqNative =
              typeof requireNativeModule !== "undefined"
                ? requireNativeModule
                : undefined;
            // The new bundle ends with `Plugin.register(id, {...})` which will
            // call target.extend(data) (re-binding onload/onunload/etc via
            // Merge.function) and then target.runOnLoad() — restarting MCP.
            const fn = new Function(
              "requireNativeModule",
              "require",
              content + sourceURL
            );
            fn(reqNative, reqNative);

            // Mark installed and persist via StateMemory (Blockbench's
            // localStorage wrapper). Replicates the relevant parts of the
            // private #remember() method.
            target.installed = true;
            // @ts-ignore
            const installedList: any[] = (Plugins as any).installed;
            if (Array.isArray(installedList)) {
              let entry = installedList.find((p: any) => p?.id === id);
              const already = !!entry;
              if (!entry) entry = {};
              entry.id = id;
              entry.version = target.version;
              entry.path = path;
              entry.source = "file";
              if (target.disabled) entry.disabled = true;
              else delete entry.disabled;
              if (!already) installedList.push(entry);
            }
            // @ts-ignore - StateMemory is a Blockbench global
            if (
              typeof StateMemory !== "undefined" &&
              typeof (StateMemory as any).save === "function"
            ) {
              // @ts-ignore
              (StateMemory as any).save("installed_plugins");
            }

            // @ts-ignore - Plugins.sort exists on the registry
            if (typeof (Plugins as any).sort === "function") {
              // @ts-ignore
              (Plugins as any).sort();
            }

            console.log(
              `[install_plugin_from_path] swapped plugin "${id}" → ${path}`
            );
          } catch (e: any) {
            console.error(
              "[install_plugin_from_path] install failed:",
              e?.stack || e
            );
          }
        }, 250);

        return `Scheduled install of plugin "${id}" from ${path} (source=file). MCP server will disconnect briefly while reloading — reconnect via /mcp after ~1-2s.`;
      },
    },
    silentToolDocs[9].status
  );

  // ---- get_current_tab ----
  createTool(
    silentToolDocs[10].name,
    {
      ...silentToolDocs[10],
      async execute() {
        const tab =
          // @ts-ignore - Modes is a Blockbench global; selected is a Mode
          typeof Modes !== "undefined" && Modes.selected ? (Modes.selected as any).id : null;
        return JSON.stringify({ tab });
      },
    },
    silentToolDocs[10].status
  );
}

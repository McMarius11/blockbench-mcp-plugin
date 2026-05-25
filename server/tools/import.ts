/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { captureAppScreenshot } from "@/lib/util";
import { STATUS_STABLE } from "@/lib/constants";
import { classifyModelSource, assertJavaModelShape } from "@/lib/java-model";

export const fromGeoJsonParameters = z.object({
  geojson: z
    .string()
    .describe(
      "Path to the GeoJSON file or data URL, or the GeoJSON string itself."
    ),
});

export const fromJavaModelParameters = z.object({
  model: z
    .string()
    .describe(
      "A Minecraft Java model as an inline JSON string, an http(s) URL, or an absolute filesystem path to a .json file (e.g. a mod's `models/item/*.json`). Raw element models — top-level `elements` with from/to/faces, like Hardt's Guns viewmodels — import directly. Models that only reference a `parent` import what they contain, but the parent's geometry is NOT resolved unless those assets are present."
    ),
  import_to_current_project: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "false (default): open the model in a NEW Java Block/Item project tab, mirroring File > Import. true: add the model's elements into the currently open project as a new group (a project must already be open; the current project's name/export settings are left untouched)."
    ),
  ignore_textures: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "false (default): import the model's `textures` block as usual. true: drop the `textures` block before import so the codec never tries to load texture files. Use this for geometry-only reference analysis, and to avoid Blockbench's blocking \"Invalid Path\" dialog when a model references texture paths with spaces/uppercase (illegal in Minecraft Java, common in mod source models). Geometry is unaffected."
    ),
  assets_root: z
    .string()
    .optional()
    .describe(
      "Absolute path to the resource pack's `assets/<namespace>` folder (e.g. `/path/pack/assets/minecraft`). Namespaced texture refs like `item/foo` then resolve to `<assets_root>/textures/item/foo.png`. Fixes OptiFine CIT (and other non-standard model locations) where Blockbench otherwise looks beside the model file and reports \"File Not Found\". If omitted and the model is loaded from a filesystem path containing `/optifine/` or `/cit/`, the assets root is auto-derived from the `/assets/<namespace>/` segment of that path. Ignored when `ignore_textures` is true."
    ),
});

export const importToolDocs: ToolSpec[] = [
  {
    name: "from_geo_json",
    description: "Imports a model from a GeoJSON file.",
    annotations: {
      title: "Import GeoJSON",
      destructiveHint: true,
    },
    parameters: fromGeoJsonParameters,
    status: STATUS_STABLE,
  },
  {
    name: "from_java_model",
    description:
      "Imports a raw Minecraft Java block/item model (.json with `elements`) programmatically — no file dialog. Accepts inline JSON, an http(s) URL, or a filesystem path. Returns a JSON summary (project name, format, element/cube counts). Set `ignore_textures: true` for geometry-only analysis. For OptiFine CIT / resource-pack models whose textures live under `assets/<ns>/textures/` (so Blockbench reports \"File Not Found\"), pass `assets_root` (or rely on auto-derivation from optifine/cit paths) to resolve textures correctly. Wraps the `java_block` codec; for Bedrock geometry use `from_geo_json` instead.",
    annotations: {
      title: "Import Java Model",
      destructiveHint: true,
    },
    parameters: fromJavaModelParameters,
    status: STATUS_STABLE,
  },
];

export function registerImportTools() {
  createTool(importToolDocs[0].name, {
    ...importToolDocs[0],
    async execute({ geojson }) {
      // If input looks like JSON, use it directly
      if (!geojson.startsWith("{") && !geojson.startsWith("[")) {
        let parsed: URL;
        try {
          parsed = new URL(geojson);
        } catch {
          throw new Error(
            `Invalid URL or file path: "${geojson}". Expected a URL (http/https) or inline GeoJSON.`
          );
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(
            `Unsupported protocol "${parsed.protocol}". Only http: and https: URLs are allowed.`
          );
        }

        const hostname = parsed.hostname.toLowerCase();
        const blockedPatterns: Array<RegExp> = []; // TODO: Add patterns for private IPs, localhost, etc. if needed

        if (blockedPatterns.some((p) => p.test(hostname))) {
          throw new Error(
            `Blocked request to address "${hostname}".`
          );
        }

        const res = await fetch(parsed.href);
        if (!res.ok) {
          throw new Error(
            `Failed to fetch GeoJSON from "${parsed.href}": ${res.status} ${res.statusText}`
          );
        }
        geojson = await res.text();
      }
      // Parse the GeoJSON string
      if (typeof geojson !== "string") {
        throw new Error("Invalid GeoJSON input. Expected a string.");
      }

      Codecs.bedrock.parse!(JSON.parse(geojson), "");

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          captureAppScreenshot().then(resolve).catch(reject);
        }, 3000);
      });
    },
  }, importToolDocs[0].status);

  createTool(importToolDocs[1].name, {
    ...importToolDocs[1],
    async execute({ model, import_to_current_project, ignore_textures, assets_root }) {
      const source = classifyModelSource(model);

      let jsonText: string;
      let modelPath = "";
      if (source.kind === "inline") {
        jsonText = source.value;
      } else if (source.kind === "url") {
        const res = await fetch(source.value);
        if (!res.ok) {
          throw new Error(
            `Failed to fetch Java model from "${source.value}": ${res.status} ${res.statusText}`
          );
        }
        jsonText = await res.text();
      } else {
        // @ts-ignore - requireNativeModule is a Blockbench global
        const fs: any = requireNativeModule("fs");
        if (!fs.existsSync(source.value)) {
          throw new Error(`File not found: "${source.value}".`);
        }
        jsonText = fs.readFileSync(source.value, "utf-8");
        modelPath = source.value;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        throw new Error(
          `Invalid JSON in Java model: ${e instanceof Error ? e.message : e}`
        );
      }
      assertJavaModelShape(parsed);

      // Strip textures before handing off to the codec. Its parse() calls
      // Texture.fromJavaLink() for every entry, which pops Blockbench's blocking
      // "Invalid Path" dialog when a texture path has spaces/uppercase (illegal
      // in MC Java, common in mod source models). We also drop the per-face
      // `texture` refs, otherwise the codec creates a blank placeholder texture
      // for each dangling "#n" reference. Geometry (from/to/faces/uv) is untouched.
      let texturesIgnored = 0;
      if (ignore_textures) {
        const modelObj = parsed as {
          textures?: Record<string, unknown>;
          elements?: Array<{ faces?: Record<string, { texture?: unknown }> }>;
        };
        if (modelObj.textures && typeof modelObj.textures === "object") {
          texturesIgnored = Object.keys(modelObj.textures).length;
          delete modelObj.textures;
        }
        if (Array.isArray(modelObj.elements)) {
          for (const el of modelObj.elements) {
            if (el?.faces && typeof el.faces === "object") {
              for (const face of Object.values(el.faces)) {
                if (face && typeof face === "object") {
                  delete (face as { texture?: unknown }).texture;
                }
              }
            }
          }
        }
      }

      if (import_to_current_project && typeof Project !== "undefined" && !Project) {
        throw new Error(
          "import_to_current_project is true but no project is open."
        );
      }

      // @ts-ignore - Codecs is a Blockbench global
      const codec = Codecs.java_block;
      if (!codec || typeof codec.load !== "function") {
        throw new Error(
          "Java Block/Item codec not available in this Blockbench version."
        );
      }

      // Texture resolution base. Blockbench resolves a model's namespaced
      // texture refs ("item/foo") relative to the model file, but for OptiFine
      // CIT (or any model not directly under assets/<ns>/models/) that lands in
      // the wrong folder → "File Not Found". Passing the codec a synthesized
      // standard `<assets_root>/models/<name>.json` path makes refs resolve to
      // `<assets_root>/textures/...`, where the files actually live.
      const basename =
        (modelPath || "model").split(/[\/\\]/).pop()!.replace(/\.json$/i, "") ||
        "model";

      let effectiveAssetsRoot: string | null = assets_root ?? null;
      if (
        !effectiveAssetsRoot &&
        source.kind === "path" &&
        /[\/\\](optifine|cit)[\/\\]/i.test(modelPath)
      ) {
        const m = modelPath.match(/^(.*[\/\\]assets[\/\\][^\/\\]+)[\/\\]/);
        if (m) effectiveAssetsRoot = m[1];
      }

      let codecPath = modelPath;
      let textureAssetsRoot: string | null = null;
      if (effectiveAssetsRoot && !ignore_textures) {
        codecPath = `${effectiveAssetsRoot}/models/${basename}.json`;
        textureAssetsRoot = effectiveAssetsRoot;
      }

      // codec.load() runs setupProject(java_block) for a fresh tab (when not
      // importing to current), then parse(). `no_file: true` skips the
      // recent-project / Project.name / export_path side effects. We force it
      // when importing to current (don't clobber), when there's no real file,
      // or when we synthesized a texture-resolution path (don't set export_path
      // to a path the model isn't actually saved at). The texture path is still
      // passed to parse() via `path`, so texture references resolve.
      const hasRealFile = source.kind === "path";
      const synthesizedPath = codecPath !== modelPath;
      const noFile = import_to_current_project || !hasRealFile || synthesizedPath;
      codec.load(
        parsed,
        { path: codecPath },
        { import_to_current_project, no_file: noFile }
      );

      // We skipped name-setting above (no_file) but synthesized a path for a
      // fresh tab from a real file — give the project the real model's name.
      if (
        synthesizedPath &&
        !import_to_current_project &&
        typeof Project !== "undefined" &&
        Project
      ) {
        Project.name = basename;
      }

      // @ts-ignore - Outliner / Cube are Blockbench globals
      const root: unknown[] =
        typeof Outliner !== "undefined" && Outliner.root ? Outliner.root : [];
      const cubeCount = root.filter(
        // @ts-ignore - Cube is a Blockbench global
        (e) => typeof Cube !== "undefined" && e instanceof Cube
      ).length;

      return JSON.stringify({
        imported: true,
        import_to_current_project,
        source: source.kind,
        // @ts-ignore - Project / Format are Blockbench globals
        project_name: typeof Project !== "undefined" && Project ? Project.name : null,
        // @ts-ignore
        format: typeof Format !== "undefined" && Format ? Format.id : null,
        top_level_element_count: root.length,
        cube_count: cubeCount,
        textures_ignored: texturesIgnored,
        texture_assets_root: textureAssetsRoot,
      });
    },
  }, importToolDocs[1].status);
}

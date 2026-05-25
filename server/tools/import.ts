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
      "Imports a raw Minecraft Java block/item model (.json with `elements`) programmatically — no file dialog. Accepts inline JSON, an http(s) URL, or a filesystem path. Returns a JSON summary (project name, format, element/cube counts). Wraps the `java_block` codec; for Bedrock geometry use `from_geo_json` instead.",
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
    async execute({ model, import_to_current_project }) {
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

      // codec.load() runs setupProject(java_block) for a fresh tab (when not
      // importing to current), then parse(). `no_file: true` skips the
      // recent-project / Project.name / export_path side effects — we set those
      // ourselves only for a brand-new tab backed by a real file, and never
      // clobber the current project when importing into it. The texture path
      // is still passed to parse() via `path`, so texture references resolve
      // regardless of no_file.
      const hasRealFile = source.kind === "path";
      const noFile = import_to_current_project || !hasRealFile;
      codec.load(
        parsed,
        { path: modelPath },
        { import_to_current_project, no_file: noFile }
      );

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
      });
    },
  }, importToolDocs[1].status);
}

/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import {
  captureScreenshot,
  captureScreenshotAdvanced,
  captureAppScreenshot,
  applyCameraView,
  snapshotCamera,
  restoreCamera,
  renderPreviewToDataUrl,
  writePngDataUrl,
  buildSilhouetteMask,
  ensureDir,
  joinPath,
  ORTHO_VIEW_NAMES,
  VIEW_PRESET_IDS,
} from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { vector3Schema, projectionEnum } from "@/lib/zodObjects";

const viewNameEnum = z.enum(Object.keys(VIEW_PRESET_IDS) as [string, ...string[]]);

export const captureScreenshotParameters = z.object({
  project: z.string().optional().describe("Project name or UUID."),
  width: z
    .number()
    .int()
    .min(16)
    .max(8192)
    .optional()
    .describe("Output width in pixels. Defaults to the live viewport width. Requires `height`."),
  height: z
    .number()
    .int()
    .min(16)
    .max(8192)
    .optional()
    .describe("Output height in pixels. Defaults to the live viewport height. Requires `width`."),
  background: z
    .string()
    .optional()
    .describe(
      'Background for the frame: "transparent" (requires an alpha-capable renderer) or a hex color like "#000000" / "#808080". Defaults to the current viewport background.'
    ),
  return_format: z
    .enum(["base64", "file"])
    .optional()
    .default("base64")
    .describe('"base64" returns the image inline (default). "file" writes a PNG to `path` and returns a text summary.'),
  path: z
    .string()
    .optional()
    .describe('Absolute output path — required when return_format="file".'),
});

export const captureAppScreenshotParameters = z.object({});

export const setCameraAngleParameters = z.object({
  position: vector3Schema.describe("Camera position."),
  target: vector3Schema.optional().describe("Camera target position."),
  rotation: vector3Schema.optional().describe("Camera rotation."),
  projection: projectionEnum.describe("Camera projection type."),
  zoom: z
    .number()
    .positive()
    .optional()
    .describe(
      "Camera zoom factor (>1 zooms in, <1 zooms out). When omitted, the " +
        "current zoom is PRESERVED across the angle change — previously every " +
        "call silently reset zoom to default (issue #3). Pass an explicit " +
        "value for reproducible framing (e.g. 0.18 for humanoid full-body)."
    ),
});

export const captureOrthoSetParameters = z.object({
  out_dir: z
    .string()
    .describe("Absolute directory to write the labeled PNGs into (created if missing)."),
  views: z
    .array(viewNameEnum)
    .optional()
    .describe(
      "Views to capture, each written as `<view>.png`. Defaults to the full " +
        "8-view set (front/back/left/right/top/bottom/3q_front/3q_rear). " +
        "Accepts compass aliases (north/south/east/west) too."
    ),
  size: z
    .number()
    .int()
    .min(16)
    .max(8192)
    .optional()
    .default(512)
    .describe("Square pixel size of each rendered view."),
  zoom: z
    .number()
    .positive()
    .optional()
    .describe(
      "Explicit camera zoom held constant across every view (e.g. 0.18 for a " +
        "humanoid full-body). When omitted, the current zoom is preserved — it " +
        "is NOT reset per view."
    ),
  target: vector3Schema
    .optional()
    .describe("Camera look-at point shared by all views (defaults to each preset's target)."),
  background: z
    .string()
    .optional()
    .describe('"transparent" or a hex color like "#000000". Defaults to the viewport background.'),
});

export const exportSilhouetteMaskParameters = z.object({
  out_path: z
    .string()
    .describe("Absolute path to write the silhouette mask PNG to."),
  view: viewNameEnum
    .optional()
    .default("front")
    .describe("View to render the silhouette from. Defaults to front."),
  size: z
    .number()
    .int()
    .min(16)
    .max(4096)
    .optional()
    .default(512)
    .describe("Square pixel size of the mask."),
  zoom: z
    .number()
    .positive()
    .optional()
    .describe("Explicit camera zoom (preserves current zoom when omitted)."),
  target: vector3Schema.optional().describe("Camera look-at point."),
  threshold: z
    .number()
    .min(0)
    .max(255)
    .optional()
    .default(8)
    .describe("Alpha cutoff (0–255) above which a pixel counts as foreground."),
});

export const cameraToolDocs: ToolSpec[] = [
  {
    name: "capture_screenshot",
    description:
      "Returns the 3D preview as a PNG image. UI/gizmos are never included (preview canvas only). Options: `width`/`height` for a fixed output resolution (reproducible QA frames; both required together), `background` (\"transparent\" or a hex color) to avoid theme-dependent backdrops, and `return_format` \"file\" to write the PNG to `path` instead of returning it inline. The live viewport is restored after capture.",
    annotations: {
      title: "Capture Screenshot",
      readOnlyHint: true,
    },
    parameters: captureScreenshotParameters,
    status: STATUS_STABLE,
  },
  {
    name: "capture_app_screenshot",
    description: "Returns the image data of the Blockbench app.",
    annotations: {
      title: "Capture App Screenshot",
      readOnlyHint: true,
    },
    parameters: captureAppScreenshotParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_camera_angle",
    description: "Sets the camera angle to the specified value.",
    annotations: {
      title: "Set Camera Angle",
      destructiveHint: true,
    },
    parameters: setCameraAngleParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "capture_ortho_set",
    description:
      "Render a labeled set of orthographic/iso views of the model to PNG " +
      "files in ONE call — the multi-angle QA sheet without N separate " +
      "set_camera_angle + capture_screenshot round-trips (each of which is a " +
      "failure point, and set_camera_angle resets zoom). Zoom is held constant " +
      "across all views internally. Writes `<view>.png` per requested view and " +
      "returns `{ paths, count }`. The live camera is restored afterwards.",
    annotations: {
      title: "Capture Ortho Set",
      readOnlyHint: true,
    },
    parameters: captureOrthoSetParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "export_silhouette_mask",
    description:
      "Render the model from one view as a pure black/white silhouette mask " +
      "(foreground = white, background = black) and write it to a PNG — ready " +
      "for a direct IoU comparison against a reference silhouette without any " +
      "manual offline render+diff. Uses a transparent-background render and " +
      "thresholds on alpha. Returns `{ path, view, size, foreground, coverage }`.",
    annotations: {
      title: "Export Silhouette Mask",
      readOnlyHint: true,
    },
    parameters: exportSilhouetteMaskParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerCameraTools() {
  createTool(cameraToolDocs[0].name, {
    ...cameraToolDocs[0],
    async execute({ project, width, height, background, return_format, path }) {
      // Plain path when no advanced options are requested — keeps the fast,
      // well-tested capture for the common case.
      if (!width && !height && !background && return_format === "base64") {
        return captureScreenshot(project);
      }
      if ((width && !height) || (height && !width)) {
        throw new Error("`width` and `height` must be provided together.");
      }
      // Ensure the requested project is the active one before capturing.
      if (project) {
        const p = ModelProject.all.find(
          (x) => x.name === project || x.uuid === project
        );
        if (p && !p.selected) p.select();
      }
      return captureScreenshotAdvanced({ width, height, background, return_format, path });
    },
  }, cameraToolDocs[0].status);

  createTool(cameraToolDocs[1].name, {
    ...cameraToolDocs[1],
    async execute() {
      return captureAppScreenshot();
    },
  }, cameraToolDocs[1].status);

  createTool(cameraToolDocs[2].name, {
    ...cameraToolDocs[2],
    async execute(angle: {
      position: number[];
      target?: number[];
      rotation?: number[];
      projection: string;
      zoom?: number;
    }) {
      const preview = Preview.selected;

      if (!preview) {
        throw new Error("No preview found in the Blockbench editor.");
      }

      // Snapshot zoom before loading the preset. `loadAnglePreset` resets the
      // camera zoom to its default when the preset carries no `zoom`, which
      // dropped QA framing on every angle change (issue #3). Each projection
      // has its own camera, so snapshot/restore them independently.
      // @ts-ignore - camPers/camOrtho exist on Preview but aren't fully typed
      const persZoomBefore: number | undefined = preview.camPers?.zoom;
      // @ts-ignore
      const orthoZoomBefore: number | undefined = preview.camOrtho?.zoom;

      const { zoom, ...preset } = angle;

      // @ts-expect-error Angle CAN be loaded like this
      preview.loadAnglePreset(preset);

      // Explicit zoom wins; otherwise restore the pre-call zoom so the angle
      // change is zoom-neutral.
      const persZoom = zoom ?? persZoomBefore;
      const orthoZoom = zoom ?? orthoZoomBefore;
      // @ts-ignore
      if (preview.camPers && typeof persZoom === "number") {
        // @ts-ignore
        preview.camPers.zoom = persZoom;
        // @ts-ignore
        preview.camPers.updateProjectionMatrix();
      }
      // @ts-ignore
      if (preview.camOrtho && typeof orthoZoom === "number") {
        // @ts-ignore
        preview.camOrtho.zoom = orthoZoom;
        // @ts-ignore
        preview.camOrtho.updateProjectionMatrix();
      }
      // @ts-ignore - keep ortho grid / scene scale in sync with the new zoom
      preview.controls?.updateSceneScale?.();

      return captureScreenshot();
    },
  }, cameraToolDocs[2].status);

  // ---- capture_ortho_set ----
  createTool(cameraToolDocs[3].name, {
    ...cameraToolDocs[3],
    async execute({ out_dir, views, size, zoom, target, background }) {
      if (!Project) throw new Error("No project is open.");
      const dir = ensureDir(out_dir);
      const viewList: string[] = views && views.length ? views : ORTHO_VIEW_NAMES;

      const snap = snapshotCamera();
      const paths: Record<string, string> = {};
      try {
        for (const view of viewList) {
          applyCameraView(view, { target, zoom });
          const dataUrl = renderPreviewToDataUrl({ size, background });
          const filePath = joinPath(dir, `${view}.png`);
          writePngDataUrl(dataUrl, filePath);
          paths[view] = filePath;
        }
      } finally {
        restoreCamera(snap);
      }

      return JSON.stringify({ paths, count: Object.keys(paths).length });
    },
  }, cameraToolDocs[3].status);

  // ---- export_silhouette_mask ----
  createTool(cameraToolDocs[4].name, {
    ...cameraToolDocs[4],
    async execute({ out_path, view, size, zoom, target, threshold }) {
      if (!Project) throw new Error("No project is open.");

      const snap = snapshotCamera();
      let rendered: string;
      try {
        applyCameraView(view, { target, zoom });
        // Transparent background so the alpha channel is the silhouette.
        rendered = renderPreviewToDataUrl({ size, background: "transparent" });
      } finally {
        restoreCamera(snap);
      }

      const mask = await buildSilhouetteMask(rendered, threshold);
      writePngDataUrl(mask.dataUrl, out_path);

      return JSON.stringify({
        path: out_path,
        view,
        size,
        foreground: mask.foreground,
        coverage: mask.total ? mask.foreground / mask.total : 0,
      });
    },
  }, cameraToolDocs[4].status);
}

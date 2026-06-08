/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import {
  captureScreenshot,
  captureScreenshotAdvanced,
  captureAppScreenshot,
} from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { vector3Schema, projectionEnum } from "@/lib/zodObjects";

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
}

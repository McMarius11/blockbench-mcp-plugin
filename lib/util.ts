/**
 * Helper function to create properly formatted image content for MCP responses.
 * Handles data URLs, base64 strings, and objects with url property.
 *
 * @param dataOrOptions - Image data as base64/data URL string, or object with { url: string }
 * @param mimeType - MIME type of the image (e.g., 'image/png', 'image/jpeg')
 * @returns Formatted MCP tool result with image content
 */
export function imageContent(
  dataOrOptions: string | { url: string },
  mimeType: string = "image/png"
): { content: Array<{ type: "image"; data: string; mimeType: string }> } {
  // Handle object with url property
  const data = typeof dataOrOptions === "string" ? dataOrOptions : dataOrOptions.url;
  let base64Data = data;

  // If it's a data URL, extract the base64 part
  if (data.startsWith("data:")) {
    const matches = data.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1] || mimeType;
      base64Data = matches[2];
    }
  }

  return {
    content: [
      {
        type: "image" as const,
        data: base64Data,
        mimeType,
      },
    ],
  };
}

export function fixCircularReferences<
  T extends Record<string, any>,
  K extends keyof T,
  V extends T[K]
>(o: T): (k: K, v: V) => V | string {
  const weirdTypes = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    BigInt64Array,
    BigUint64Array,
    //Float16Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    // SharedArrayBuffer,
    DataView,
  ];

  const defs = new Map();

  return function (k: K, v: V): V | string {
    if (k && (v as unknown) === o)
      return "[" + (k as string) + " is the same as original object]";
    if (v === undefined) return undefined as V;
    if (v === null) return null as V;
    const weirdType = weirdTypes.find((t) => (v as unknown) instanceof t);
    if (weirdType) return weirdType.toString();
    if (typeof v == "function") {
      return v.toString();
    }
    if (v && typeof v == "object") {
      const def = defs.get(v);
      if (def)
        return "[" + (k as string) + " is the same as " + (def as string) + "]";
      defs.set(v, k);
    }
    return v;
  };
}

export function getProjectTexture(id: string): Texture | null {
  const texture = (Project?.textures ?? Texture.all).find(
    ({ id: textureId, name, uuid }) =>
      textureId === id || name === id || uuid === id
  );

  return texture || null;
}

/**
 * Programmatically sets a BarItems slider/widget's value, tolerating the API
 * drift between Blockbench versions where some items expose `.set(n)`,
 * `.change(n)`, or only allow `.value = n`. Prior to this helper, calls like
 * `BarItems.slider_brush_size.set(n)` crashed hollow-shape drawing with
 * `… .set is not a function` on current Blockbench builds.
 */
export function setBarItemValue(id: string, value: unknown): void {
  // @ts-ignore - BarItems is a Blockbench global
  const item = BarItems?.[id];
  if (!item) return;
  if (typeof item.set === "function") {
    try {
      item.set(value);
      return;
    } catch {
      // Fall through to direct assignment for widgets whose runtime method
      // signatures drifted from the public type surface.
    }
  }
  if ("value" in item) {
    item.value = value;
    if (typeof item.update === "function") item.update();
    return;
  }
  if (typeof item.change === "function") {
    try {
      item.change(value);
    } catch {
      // Best-effort UI setting; callers should not fail because Blockbench
      // changed an optional widget mutator signature.
    }
  }
}

/**
 * Resolves a texture reference and activates it in the panel so that paint
 * tools, which historically act on `Texture.selected` regardless of their
 * `texture_id` argument, target the intended texture.
 *
 * If `id` is omitted, the currently selected texture is used as-is. Throws an
 * actionable error when the reference cannot be resolved.
 */
export function getAndActivateTexture(id?: string): Texture {
  if (!id) {
    const active = Texture.selected ?? Texture.getDefault();
    if (!active) {
      throw new Error(
        "No texture available. Use create_texture first, or pass texture_id explicitly."
      );
    }
    if (Texture.selected?.uuid !== active.uuid) {
      active.select();
    }
    return active;
  }

  const texture = getProjectTexture(id);
  if (!texture) {
    throw new Error(
      `Texture "${id}" not found. Use the list_textures tool to see available textures.`
    );
  }
  // Blockbench paint tools operate on Texture.selected, so activating the
  // requested texture is the only reliable way to make texture_id behave like
  // a real scope argument.
  if (Texture.selected?.uuid !== texture.uuid) {
    texture.select();
  }
  return texture;
}

// ============================================================================
// Lookup Helpers with Actionable Error Messages
// ============================================================================

/**
 * Finds a group/bone by name and throws an actionable error if not found.
 * @param name - The name of the group/bone to find
 * @returns The found Group
 * @throws Error with suggestion to use list_outline
 */
export function findGroupOrThrow(name: string): Group {
  // @ts-ignore - Group is globally available in Blockbench
  const group = Group.all.find((g: Group) => g.name === name);
  if (!group) {
    throw new Error(
      `Bone/group "${name}" not found. Use the list_outline tool to see available groups and bones.`
    );
  }
  return group;
}

/**
 * Finds a mesh by ID or name and throws an actionable error if not found.
 * @param id - The UUID or name of the mesh to find
 * @returns The found Mesh
 * @throws Error with suggestion to use list_outline
 */
export function findMeshOrThrow(id: string): Mesh {
  // @ts-ignore - Mesh is globally available in Blockbench
  const mesh = Mesh.all.find((m: Mesh) => m.uuid === id || m.name === id);
  if (!mesh) {
    throw new Error(
      `Mesh "${id}" not found. Use the list_outline tool to see available meshes.`
    );
  }
  return mesh;
}

/**
 * Finds an element (cube, mesh, group) by ID or name and throws an actionable error if not found.
 * @param id - The UUID or name of the element to find
 * @returns The found OutlinerElement
 * @throws Error with suggestion to use list_outline
 */
export function findElementOrThrow(id: string): OutlinerElement {
  const element = Outliner.elements.find(
    (el: OutlinerElement) => el.uuid === id || el.name === id
  ) || Group.all.find((g: Group) => g.uuid === id || g.name === id);
  if (!element) {
    throw new Error(
      `Element "${id}" not found. Use the list_outline tool to see available elements.`
    );
  }
  return element;
}

/**
 * Finds a texture by ID, name, or UUID and throws an actionable error if not found.
 * @param id - The ID, name, or UUID of the texture to find
 * @returns The found Texture
 * @throws Error with suggestion to use list_textures
 */
export function findTextureOrThrow(id: string): Texture {
  const texture = getProjectTexture(id);
  if (!texture) {
    throw new Error(
      `Texture "${id}" not found. Use the list_textures tool to see available textures.`
    );
  }
  return texture;
}

/**
 * Helper to find a TextureGroup by name or UUID
 */
export function findTextureGroupOrThrow(id: string): TextureGroup {
  // @ts-ignore - TextureGroup is globally available in Blockbench
  const group = TextureGroup.all.find(
    (g: TextureGroup) => g.uuid === id || g.name === id
  );
  if (!group) {
    throw new Error(
      `Material/texture group "${id}" not found. Use the list_materials tool to see available materials.`
    );
  }
  return group;
}

/**
 * Helper to get texture info for a PBR channel
 */
export function getChannelTextureInfo(textures: Texture[], channel: string) {
  const tex = textures.find((t: Texture) => t.pbr_channel === channel);
  return tex
    ? { name: tex.name, uuid: tex.uuid, hasTexture: true }
    : { hasTexture: false };
}

/**
 * Gets a mesh by ID or returns the selected mesh if no ID provided.
 * Throws an actionable error if no mesh is found.
 * @param meshId - Optional mesh UUID or name
 * @returns The found or selected Mesh
 * @throws Error with suggestion to use list_outline
 */
export function getMeshOrSelected(meshId?: string): Mesh {
  if (meshId) {
    return findMeshOrThrow(meshId);
  }
  // @ts-ignore - Mesh is globally available in Blockbench
  const selected = Mesh.selected[0];
  if (!selected) {
    throw new Error(
      "No mesh selected and no mesh_id provided. Select a mesh or provide a mesh_id. Use the list_outline tool to see available meshes."
    );
  }
  return selected;
}

/**
 * Captures a screenshot of the 3D preview canvas.
 * Uses Blockbench's native rendering pipeline for accurate capture.
 */
export function captureScreenshot(project?: string) {
  let selectedProject = Project;

  if (!selectedProject || project !== undefined) {
    selectedProject = ModelProject.all.find(
      (p) => p.name === project || p.uuid === project || p.selected
    );
  }

  if (!selectedProject) {
    throw new Error("No project found in the Blockbench editor.");
  }

  // Select the project if needed
  if (!selectedProject.selected) {
    selectedProject.select();
  }

  // @ts-ignore - Preview is globally available in Blockbench
  const preview = Preview.selected;
  if (!preview) {
    throw new Error("No preview available for the selected project.");
  }

  // Capture the preview canvas using Blockbench's native approach
  // Canvas.withoutGizmos temporarily hides gizmos, executes the callback, then restores them
  let dataUrl: string | undefined;
  // @ts-ignore - Canvas is globally available in Blockbench
  Canvas.withoutGizmos(() => {
    preview.render();
    dataUrl = preview.canvas.toDataURL();
  });

  if (!dataUrl) {
    throw new Error("Failed to capture preview screenshot.");
  }

  return imageContent(dataUrl, "image/png");
}

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  /** "transparent" or a hex color like "#000000" / "#808080". */
  background?: string;
  /** "base64" (default, returns image content) or "file" (writes PNG to `path`). */
  return_format?: "base64" | "file";
  path?: string;
}

/**
 * Renders the 3D preview to a PNG with optional size/background overrides and
 * either returns it as MCP image content or writes it to disk. The live
 * renderer state (size, clear color/alpha) is always restored in a finally
 * block so the editor view is left untouched.
 */
export function captureScreenshotAdvanced(opts: ScreenshotOptions) {
  // @ts-ignore - Preview is a Blockbench global
  const preview = Preview.selected;
  if (!preview) {
    throw new Error("No preview available for the selected project.");
  }
  const renderer = preview.renderer as {
    getSize: (t: unknown) => { x: number; y: number };
    setSize: (w: number, h: number, updateStyle?: boolean) => void;
    getClearColor: (t: unknown) => unknown;
    getClearAlpha: () => number;
    setClearColor: (c: unknown, a: number) => void;
  };
  const canvas = preview.canvas as HTMLCanvasElement;

  // @ts-ignore - THREE is a Blockbench runtime global
  const prevSize = renderer.getSize(new THREE.Vector2());
  // @ts-ignore
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const cam = preview.camera as { isPerspectiveCamera?: boolean; aspect?: number; updateProjectionMatrix?: () => void };

  let dataUrl: string | undefined;
  try {
    if (opts.background === "transparent") {
      renderer.setClearColor(prevColor, 0);
    } else if (opts.background && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(opts.background)) {
      // @ts-ignore
      renderer.setClearColor(new THREE.Color(opts.background), 1);
    }

    if (opts.width && opts.height) {
      renderer.setSize(opts.width, opts.height, false);
      if (cam.isPerspectiveCamera) {
        cam.aspect = opts.width / opts.height;
        cam.updateProjectionMatrix?.();
      }
    }

    // @ts-ignore - Canvas is a Blockbench global; hide gizmos for a clean frame
    Canvas.withoutGizmos(() => {
      preview.render();
      dataUrl = canvas.toDataURL("image/png");
    });
  } finally {
    // Restore live renderer state regardless of success.
    renderer.setSize(prevSize.x, prevSize.y, false);
    if (cam.isPerspectiveCamera) {
      cam.aspect = prevSize.x / prevSize.y;
      cam.updateProjectionMatrix?.();
    }
    renderer.setClearColor(prevColor, prevAlpha);
    // @ts-ignore - recompute from the DOM so the editor view is pixel-correct
    preview.resize?.();
    preview.render();
  }

  if (!dataUrl) {
    throw new Error("Failed to capture preview screenshot.");
  }

  if (opts.return_format === "file") {
    if (!opts.path) {
      throw new Error('return_format="file" requires a `path`.');
    }
    // @ts-ignore - requireNativeModule is a Blockbench global (v5 native API)
    const fs = requireNativeModule("fs");
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    // @ts-ignore - Buffer is available via the Node bridge
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(opts.path, buffer);
    return `Saved screenshot (${opts.width ?? prevSize.x}×${opts.height ?? prevSize.y}) to ${opts.path} (${buffer.length} bytes).`;
  }

  return imageContent(dataUrl, "image/png");
}

// ============================================================================
// Multi-view capture helpers (camera presets, off-screen render, compositing)
//
// Shared by capture_ortho_set / export_silhouette_mask (camera.ts) and
// capture_anim_contact_sheet (animation.ts). All of these drive Blockbench's
// live Preview camera, so they live next to captureScreenshot rather than in a
// pure lib.
// ============================================================================

/**
 * Friendly view name → Blockbench `DefaultCameraPresets` id. Blockbench itself
 * names its locked ortho angles by compass direction; this map adds the
 * front/back/left/right aliases that callers expect. Convention: the model's
 * FRONT faces north (−Z), matching the common Blockbench entity workflow.
 */
export const VIEW_PRESET_IDS: Record<string, string> = {
  front: "north",
  back: "south",
  left: "west",
  right: "east",
  top: "top",
  bottom: "bottom",
  north: "north",
  south: "south",
  east: "east",
  west: "west",
  "3q_front": "isometric_right",
  "3q_rear": "isometric_left",
  isometric_right: "isometric_right",
  isometric_left: "isometric_left",
};

export const ORTHO_VIEW_NAMES = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "3q_front",
  "3q_rear",
];

interface CameraSnapshot {
  pos: number[];
  target: number[];
  projection: "orthographic" | "perspective";
  persZoom?: number;
  orthoZoom?: number;
}

function getSelectedPreview(): any {
  // @ts-ignore - Preview is a Blockbench global
  const preview = Preview.selected;
  if (!preview) {
    throw new Error("No preview available for the selected project.");
  }
  return preview;
}

/** Capture the current camera state so a batch of view changes can restore it. */
export function snapshotCamera(): CameraSnapshot {
  const preview = getSelectedPreview();
  return {
    pos: preview.camera.position.toArray(),
    target: preview.controls.target.toArray(),
    projection: preview.camera === preview.camOrtho ? "orthographic" : "perspective",
    persZoom: preview.camPers?.zoom,
    orthoZoom: preview.camOrtho?.zoom,
  };
}

/** Restore a camera state captured with {@link snapshotCamera}. */
export function restoreCamera(snap: CameraSnapshot): void {
  const preview = getSelectedPreview();
  preview.loadAnglePreset({
    projection: snap.projection,
    position: snap.pos,
    target: snap.target,
  });
  if (preview.camPers && typeof snap.persZoom === "number") {
    preview.camPers.zoom = snap.persZoom;
    preview.camPers.updateProjectionMatrix();
  }
  if (preview.camOrtho && typeof snap.orthoZoom === "number") {
    preview.camOrtho.zoom = snap.orthoZoom;
    preview.camOrtho.updateProjectionMatrix();
  }
  preview.controls?.updateSceneScale?.();
  preview.render();
}

/**
 * Point the live preview camera at a named view. Zoom is preserved across the
 * angle change unless an explicit `zoom` is given (mirrors set_camera_angle's
 * issue-#3 fix). `target` overrides the preset's look-at point.
 */
export function applyCameraView(
  view: string,
  opts: { target?: number[]; zoom?: number } = {}
): void {
  const preview = getSelectedPreview();
  const presetId = VIEW_PRESET_IDS[view];
  if (!presetId) {
    throw new Error(
      `Unknown view "${view}". Valid views: ${Object.keys(VIEW_PRESET_IDS).join(", ")}.`
    );
  }
  // @ts-ignore - DefaultCameraPresets is a Blockbench global
  const src = DefaultCameraPresets.find((p: any) => p.id === presetId);
  if (!src) {
    throw new Error(`Camera preset "${presetId}" not found in this Blockbench version.`);
  }

  const persZoomBefore: number | undefined = preview.camPers?.zoom;
  const orthoZoomBefore: number | undefined = preview.camOrtho?.zoom;

  preview.loadAnglePreset({
    projection: src.projection,
    position: src.position,
    target: opts.target ?? src.target,
    locked_angle: src.locked_angle,
  });

  const persZoom = opts.zoom ?? persZoomBefore;
  const orthoZoom = opts.zoom ?? orthoZoomBefore;
  if (preview.camPers && typeof persZoom === "number") {
    preview.camPers.zoom = persZoom;
    preview.camPers.updateProjectionMatrix();
  }
  if (preview.camOrtho && typeof orthoZoom === "number") {
    preview.camOrtho.zoom = orthoZoom;
    preview.camOrtho.updateProjectionMatrix();
  }
  preview.controls?.updateSceneScale?.();
}

/**
 * Render the current preview camera to a PNG data-URL at an optional square
 * size / background, restoring the live renderer state afterwards. Like
 * captureScreenshotAdvanced but returns the raw data-URL for in-process
 * compositing (contact sheets, silhouette masks) instead of MCP image content.
 */
export function renderPreviewToDataUrl(
  opts: { size?: number; background?: string } = {}
): string {
  const preview = getSelectedPreview();
  const renderer = preview.renderer;
  const canvas = preview.canvas as HTMLCanvasElement;
  // @ts-ignore - THREE is a Blockbench runtime global
  const prevSize = renderer.getSize(new THREE.Vector2());
  // @ts-ignore
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const cam = preview.camera;

  let dataUrl: string | undefined;
  try {
    if (opts.background === "transparent") {
      renderer.setClearColor(prevColor, 0);
    } else if (opts.background && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(opts.background)) {
      // @ts-ignore
      renderer.setClearColor(new THREE.Color(opts.background), 1);
    }
    if (opts.size) {
      renderer.setSize(opts.size, opts.size, false);
      if (cam.isPerspectiveCamera) {
        cam.aspect = 1;
        cam.updateProjectionMatrix?.();
      }
    }
    // @ts-ignore - Canvas is a Blockbench global; hide gizmos for a clean frame
    Canvas.withoutGizmos(() => {
      preview.render();
      dataUrl = canvas.toDataURL("image/png");
    });
  } finally {
    renderer.setSize(prevSize.x, prevSize.y, false);
    if (cam.isPerspectiveCamera) {
      cam.aspect = prevSize.x / prevSize.y;
      cam.updateProjectionMatrix?.();
    }
    renderer.setClearColor(prevColor, prevAlpha);
    preview.resize?.();
    preview.render();
  }

  if (!dataUrl) {
    throw new Error("Failed to render preview frame.");
  }
  return dataUrl;
}

/** Write a PNG data-URL to an absolute path. Returns the byte length written. */
export function writePngDataUrl(dataUrl: string, path: string): number {
  // @ts-ignore - requireNativeModule is a Blockbench global (v5 native API)
  const fs: any = requireNativeModule("fs");
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  // @ts-ignore - Buffer is available via the Node bridge
  const buffer = Buffer.from(base64, "base64");
  fs.writeFileSync(path, buffer);
  return buffer.length;
}

/** Ensure a directory exists (recursive), returning the normalized path. */
export function ensureDir(dir: string): string {
  // @ts-ignore - requireNativeModule is a Blockbench global
  const fs: any = requireNativeModule("fs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir.replace(/[\/\\]+$/, "");
}

/** Join a directory and filename with a forward slash (Blockbench is path-agnostic). */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\/\\]+$/, "")}/${name}`;
}

interface ContactCell {
  dataUrl: string;
  row: number;
  col: number;
}

/**
 * Composite a grid of PNG data-URL cells into one contact-sheet PNG data-URL
 * using an off-screen 2D canvas. Async because each cell loads through an
 * <img>. Returns the combined data-URL.
 */
export function compositeContactSheet(
  cells: ContactCell[],
  cols: number,
  rows: number,
  cell: number,
  background: string = "#000000"
): Promise<string> {
  // @ts-ignore - document is available in the Electron renderer
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("2D canvas context unavailable for contact sheet."));
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return Promise.all(
    cells.map(
      (c) =>
        new Promise<void>((resolve) => {
          // @ts-ignore - Image is a renderer global
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, c.col * cell, c.row * cell, cell, cell);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = c.dataUrl;
        })
    )
  ).then(() => canvas.toDataURL("image/png"));
}

/**
 * Convert a rendered (transparent-background) PNG data-URL into a binary
 * silhouette mask: foreground (alpha > threshold) → white, background → black.
 * Returns the mask data-URL plus pixel coverage stats. Async (loads via <img>).
 */
export function buildSilhouetteMask(
  dataUrl: string,
  threshold: number = 8
): Promise<{ dataUrl: string; foreground: number; total: number }> {
  return new Promise((resolve, reject) => {
    // @ts-ignore - Image is a renderer global
    const img = new Image();
    img.onerror = () => reject(new Error("Failed to load rendered frame for masking."));
    img.onload = () => {
      // @ts-ignore - document is a renderer global
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2D canvas context unavailable for silhouette mask."));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      let foreground = 0;
      for (let i = 0; i < px.length; i += 4) {
        const fg = px[i + 3] > threshold;
        if (fg) foreground++;
        px[i] = px[i + 1] = px[i + 2] = fg ? 255 : 0;
        px[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      resolve({
        dataUrl: canvas.toDataURL("image/png"),
        foreground,
        total: canvas.width * canvas.height,
      });
    };
    img.src = dataUrl;
  });
}

/**
 * Captures a screenshot of the entire Blockbench application window.
 * Uses Electron's native capturePage API through Blockbench's Screencam.
 * Only available when running as a desktop application.
 */
export async function captureAppScreenshot(): Promise<ReturnType<typeof imageContent>> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    // Add a timeout in case the callback is never called
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("App screenshot timed out after 5 seconds."));
      }
    }, 5000);

    // Use Blockbench's native Screencam.fullScreen which uses Electron's capturePage
    // @ts-ignore - Screencam is globally available in Blockbench
    Screencam.fullScreen({}, (dataUrl: string) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        if (dataUrl) {
          resolve(imageContent(dataUrl, "image/png"));
        } else {
          reject(
            new Error("Failed to capture app screenshot - no data returned.")
          );
        }
      }
    });
  });
}

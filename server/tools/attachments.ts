/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { vector3Schema } from "@/lib/zodObjects";

// ============================================================================
// Attachment-point tools — Locator and NullObject
//
// Locators are first-class outliner elements used as attachment points
// (muzzle_flash, ejection_port, foot_step_origin) — they translate to
// Marker3D-equivalent nodes in glTF/Godot consumers.
//
// NullObjects are invisible rigging nodes used primarily as IK targets
// for hand/foot constraints. Together they cover the "named coordinate
// frame" pipeline gap that previously required risky_eval.
//
// Author: McMarius11 fork (asset-generator-blockbench)
// ============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureProject(): void {
  // @ts-ignore - Project is a Blockbench global
  if (!Project) throw new Error("No project is open.");
}

/**
 * Resolve a parent group reference to a Group instance or "root".
 * Accepts UUIDs, names, or the literal string "root".
 */
function resolveParent(parent: string | undefined): Group | "root" {
  if (!parent || parent === "root") return "root";
  // @ts-ignore - getAllGroups is a Blockbench global utility
  const groups = getAllGroups();
  const found = groups.find(
    (g: Group) => g.name === parent || g.uuid === parent
  );
  if (!found) {
    throw new Error(
      `Parent group "${parent}" not found. Use list_outline to see available groups, or pass "root".`
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createLocatorParameters = z.object({
  name: z
    .string()
    .describe(
      "Locator name. Conventionally lowercase_snake_case (e.g. 'muzzle_flash', 'ejection_port'). Becomes the node name in glTF export."
    ),
  position: vector3Schema.describe(
    "Locator position [x, y, z] in project coordinates."
  ),
  parent: z
    .string()
    .optional()
    .default("root")
    .describe(
      "Parent group/bone UUID or name. Defaults to 'root'. For viewmodel attachments pass the relevant bone (e.g. 'wpn_barrel')."
    ),
});

export const createNullObjectParameters = z.object({
  name: z
    .string()
    .describe(
      "NullObject name. Conventionally describes the IK role (e.g. 'ik_target_hand_l', 'ik_target_foot_r')."
    ),
  position: vector3Schema.describe(
    "NullObject position [x, y, z] in project coordinates."
  ),
  parent: z
    .string()
    .optional()
    .default("root")
    .describe(
      "Parent group/bone UUID or name. Defaults to 'root'."
    ),
  ik_target: z
    .string()
    .optional()
    .describe(
      "Optional UUID/name of the bone this NullObject should serve as IK target for. Wires the IK chain endpoint."
    ),
  lock_ik_target_rotation: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, the IK target's rotation is locked to its rest orientation (free chain otherwise)."
    ),
});

// ---------------------------------------------------------------------------
// Tool docs
// ---------------------------------------------------------------------------

export const attachmentToolDocs: ToolSpec[] = [
  {
    name: "create_locator",
    description:
      "Create a Locator (named attachment point) in the outliner. Locators export as named nodes in glTF and become Marker3D-equivalents in Godot — use them for muzzle points, ejection ports, footstep origins, particle origins, audio emitters, etc.",
    annotations: {
      title: "Create Locator",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: createLocatorParameters,
    status: STATUS_STABLE,
  },
  {
    name: "create_null_object",
    description:
      "Create a NullObject (invisible rigging node) in the outliner. Primary use is as an IK target for hand/foot constraints on rigged characters. Pass `ik_target` to wire it to a bone's IK chain.",
    annotations: {
      title: "Create Null Object",
      destructiveHint: true,
      openWorldHint: false,
    },
    parameters: createNullObjectParameters,
    status: STATUS_STABLE,
  },
];

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAttachmentTools() {
  // ---- create_locator ----
  createTool(
    attachmentToolDocs[0].name,
    {
      ...attachmentToolDocs[0],
      async execute({
        name,
        position,
        parent,
      }: {
        name: string;
        position: [number, number, number];
        parent: string;
      }) {
        ensureProject();
        const parentRef = resolveParent(parent);

        Undo.initEdit({ elements: [], outliner: true, collections: [] });

        // @ts-ignore - Locator is a Blockbench global; constructor takes
        // Partial<LocatorOptions> with `from` for position.
        const locator = new Locator({ name, from: position }).init();
        locator.addTo(parentRef);

        Undo.finishEdit("Agent created locator");
        Canvas.updateAll();

        return `Created locator "${locator.name}" at [${position.join(", ")}] under ${
          parentRef === "root" ? "root" : `"${(parentRef as Group).name}"`
        } (UUID: ${locator.uuid}).`;
      },
    },
    attachmentToolDocs[0].status
  );

  // ---- create_null_object ----
  createTool(
    attachmentToolDocs[1].name,
    {
      ...attachmentToolDocs[1],
      async execute({
        name,
        position,
        parent,
        ik_target,
        lock_ik_target_rotation,
      }: {
        name: string;
        position: [number, number, number];
        parent: string;
        ik_target?: string;
        lock_ik_target_rotation: boolean;
      }) {
        ensureProject();
        const parentRef = resolveParent(parent);

        Undo.initEdit({ elements: [], outliner: true, collections: [] });

        // @ts-ignore - NullObject is a Blockbench global; constructor takes
        // Partial<NullObjectOptions>.
        const nullObj = new NullObject({
          name,
          position,
          ik_target: ik_target ?? "",
          lock_ik_target_rotation: Boolean(lock_ik_target_rotation),
        }).init();
        nullObj.addTo(parentRef);

        Undo.finishEdit("Agent created null object");
        Canvas.updateAll();

        const ikNote = ik_target
          ? ` (IK target: "${ik_target}"${
              lock_ik_target_rotation ? ", rotation locked" : ""
            })`
          : "";

        return `Created null object "${nullObj.name}" at [${position.join(", ")}] under ${
          parentRef === "root" ? "root" : `"${(parentRef as Group).name}"`
        }${ikNote} (UUID: ${nullObj.uuid}).`;
      },
    },
    attachmentToolDocs[1].status
  );
}

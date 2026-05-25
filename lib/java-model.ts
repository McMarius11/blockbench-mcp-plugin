/**
 * Pure helpers for the `from_java_model` import tool — no Blockbench runtime
 * globals, so they can be unit-tested with `bun test` (see java-model.test.ts).
 * The Blockbench-coupled work (codec.load, fs, fetch) lives in
 * server/tools/import.ts.
 */

export type ModelSourceKind = "inline" | "url" | "path";

export interface ModelSource {
  kind: ModelSourceKind;
  /** inline → the JSON text; url → the href; path → the filesystem path. */
  value: string;
}

/**
 * Classify a model input string as inline JSON, an http(s) URL, or a local
 * filesystem path. Mirrors the three ways a user might hand us a Java model:
 * pasted JSON, a download link, or a path into a resource/mod pack.
 *
 * - Starts with `{` or `[` → inline JSON.
 * - Parses as an http:/https: URL → url.
 * - Parses as a file: URL → path (from its pathname).
 * - Anything else (absolute/relative OS paths, Windows drive paths) → path.
 */
export function classifyModelSource(input: string): ModelSource {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Empty model input.");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { kind: "inline", value: trimmed };
  }

  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }

  if (url && (url.protocol === "http:" || url.protocol === "https:")) {
    return { kind: "url", value: url.href };
  }
  if (url && url.protocol === "file:") {
    return { kind: "path", value: decodeURIComponent(url.pathname) };
  }

  return { kind: "path", value: trimmed };
}

/**
 * Validate that a parsed object looks like a Minecraft Java model. Blockbench's
 * java_block codec silently pops a UI message box and bails when none of these
 * keys are present — an MCP client never sees that dialog, so we throw a real
 * error instead. Matches the codec's own guard
 * (`!model.elements && !model.parent && !model.display && !model.textures`).
 */
export function assertJavaModelShape(
  obj: unknown
): asserts obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("Java model must be a JSON object.");
  }
  const o = obj as Record<string, unknown>;
  if (
    !("elements" in o) &&
    !("parent" in o) &&
    !("display" in o) &&
    !("textures" in o)
  ) {
    throw new Error(
      'Not a Java model: object has none of "elements", "parent", "display", or "textures".'
    );
  }
}

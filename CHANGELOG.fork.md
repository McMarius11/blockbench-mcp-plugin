# Fork changelog

Tracks additions made on top of upstream [`jasonjgardner/blockbench-mcp-plugin`](https://github.com/jasonjgardner/blockbench-mcp-plugin) by the `mcmarius/extensions` branch.

Upstream changes are NOT logged here — see upstream `CHANGELOG.md` (if present) or `git log upstream/main`.

---

## [unreleased] — 2026-06-08 — maintainer issue batch (#2–#16)

Addresses the issue batch filed from the Asset Generator Blockbench pipeline (own fork issues #2–#16). All items verified live against Blockbench 5.1.x and covered by smoke group `[17/17]` + 14 new `bun test` units.

### Fixed — P0/P2 tool bugs (`server/tools/animation.ts`, `camera.ts`, `project.ts`, `ui.ts`)

- **`create_animation` rotation X/Y inversion (#2)** — the tool writes a Bedrock-format animation (`1.8.0`) and loads it via `Animator.loadFile`, whose parser negates the X/Y rotation components on import (left-handed convention). Rotations were therefore stored mirrored on X/Y (Z correct), producing wrong poses unless the caller pre-flipped (the pipeline's `_spec_rot`). Now pre-negates X/Y so callers pass plain **visual-euler degrees** that round-trip 1:1 — consistent with `manage_keyframes` (native `createKeyframe`, never inverted). Live-verified `[0,45,0]`, `[30,0,0]`, `[0,0,-20]` all store 1:1. `_spec_rot` workarounds can be removed downstream.
- **`set_camera_angle` resets `camera.zoom` (#3)** — `loadAnglePreset` drops zoom when the preset carries none, breaking multi-view QA framing. Now snapshots per-projection zoom (`camPers`/`camOrtho`) and restores it (zoom-neutral angle change), plus a new optional `zoom` param for reproducible framing. `get_project_info` gains a `camera` block (projection/zoom/position/target) so zoom is queryable without `risky_eval`.
- **`risky_eval` rejected comments (#4)** — a Zod refine blocked `//` and `/* */` (and `https://` in strings). Relaxed to only reject `console.*` calls (whose output isn't captured); the runtime never stripped anything. Comments now pass through.

### Added — bulk inspection & query tools (`server/tools/element.ts`)

- **`export_model_structure(scope, group?, include_animations?, include_faces?, max_elements?)`** — one-shot JSON dump of project + groups + elements (+ optional animation summary), replacing dozens of `get_element_info` roundtrips; the natural `before`/`after` input to `compare_models` (#5).
- **`get_bounding_box(target, group_id?, coordinate_space?)`** — aggregated `{min,max,center,extents}` for selection/group/project/visible, in `world` (THREE `Box3`, rotation-aware — for auto-framing) or `local` space (#6).
- **`get_element_statistics(scope, group?)`** — totals, cube-count-by-texture, size histogram, triangle estimate (cubes = 2/enabled-face, meshes fan-triangulated), cubes-per-group (#12).
- **`highlight_elements(ids, duration_ms?, clear_previous?)`** — non-destructive viewport highlight via selection, with optional timed flash + prior-selection restore (#10).
- **`group_by_criteria(group_name, parent_group?, …filters, limit?)`** — match (name/type/region/texture) then move into a NEW group in one step; the write-side companion to `find_elements_by_criteria` (#11).
- **`find_elements_by_criteria` extended (#9)** — added `texture_name`/`texture_uuid` (face-texture match), `bbox_overlaps` (cube from/to box intersects a region, not just the center), and `name_prefix`/`name_suffix`.

### Added — animation sampling (`server/tools/animation.ts`)

- **`get_bone_transforms_at_time(animation_id?, time, bones?)`** — interpolated per-bone position/rotation(°)/scale at a time, via `BoneAnimator.interpolate` at `Timeline.time`; read-only (cursor restored). For numeric anim QA (loop-pop, rest-pose checks) without screenshot heuristics. Same 1:1 rotation convention as `create_animation` (#7).

### Added — model diff & UV QA (`server/tools/analysis.ts`, `lib/model-analysis.ts`, `lib/model-analysis.test.ts`)

- **`compare_models(before, after?)`** — diffs two `export_model_structure` dumps (or `before` vs the current project) by UUID: added / removed / renamed / reparented elements and groups, plus per-face UV changes. Pure `diffModelStructure` in `lib/` (#13).
- **`find_uv_overlaps` / `uv_island_list` / `uv_density_per_face`** — UV QA over cube face rects + mesh per-vertex UV bounds, bucketed per texture (overlaps across different atlases are ignored). Pure `findUvOverlaps` / `listUvIslands` / `uvDensityPerFace` in `lib/` (#14).
- **`lib/model-analysis.ts`** — Blockbench-free algorithms (structural diff + UV rect math); **`lib/model-analysis.test.ts`** — 14 `bun test` units.

### Changed — extended `capture_screenshot` (`server/tools/camera.ts`, `lib/util.ts`)

- **`capture_screenshot(width?, height?, background?, return_format?, path?)`** — fixed output resolution, `transparent`/hex background, and `return_format: "file"` (writes PNG to `path`) for reproducible QA frames / contact sheets. Live renderer state (size + clear color/alpha) is restored in a `finally` block. The no-option path still uses the fast original capture (#8).

### Docs

- `create_animation` description now states rotation units (degrees), Euler order (XYZ), local space, and the 1:1 convention (#15). `place_cube` `group` param documented as a single top-level destination applied to all cubes, with reparenting guidance (#16).

---

## [unreleased] — 2026-05-25

### Changed — `from_java_model` gains `assets_root` (correct CIT / resource-pack texture resolution) (`server/tools/import.ts`)

- **`from_java_model(..., assets_root?)`** — fixes textures showing "File Not Found" on OptiFine CIT (and other non-`models/`-located) models. Blockbench resolves a model's namespaced texture refs (`item/foo`) relative to the model file, but for a CIT model at `assets/<ns>/optifine/cit/.../x.json` that lands in the wrong folder. When `assets_root` (the `assets/<ns>` folder) is given — or auto-derived from a filesystem path containing `/optifine/` or `/cit/` — the tool passes the codec a synthesized `<assets_root>/models/<name>.json` path so refs resolve to `<assets_root>/textures/...`, where the files actually live. Verified live against the real Hardt's Guns pack: a 96-cube model imported with both textures (incl. the space-named `anvil 1.png`) loading `error=0`. `no_file` is forced when synthesizing so `Project.export_path` isn't set to the synthetic path; the project name is set from the real model basename. Result JSON adds `texture_assets_root`. Smoke group `[16/16]` (CIT model + real PNG under `assets/.../textures/`, auto-derive + explicit). Standard models already under `assets/<ns>/models/` are unaffected.

### Changed — `from_java_model` gains `ignore_textures` (`server/tools/import.ts`)

- **`from_java_model(..., ignore_textures?)`** — when `true`, drops the model's `textures` block **and** per-face `texture` refs before handing off to the codec. The java_block codec's `parse()` calls `Texture.fromJavaLink()` for each texture, which pops Blockbench's **blocking "Invalid Path" dialog** when a texture path contains spaces/uppercase (illegal in MC Java, common in mod source models like Hardt's Guns) — a real problem for dialog-free agentic import. Stripping the refs also prevents the codec from creating blank placeholder textures for dangling `"#n"` references, so a geometry-only import lands 0 textures. Default `false` (unchanged behaviour). Result JSON now includes `textures_ignored`. Verified live (0 textures, no dialog, with the exact `item/coal block` + `item/anvil 1` paths) + smoke group `[15/15]`.

### Added — `move_to_group` reparenting + `find_elements_by_criteria` region/face filters (`server/tools/element.ts`)

- **`move_to_group(ids, target_group)`** — reparents existing cubes/meshes/groups into a target group, or to the top level with `target_group: "root"`. The complement to `add_group` (which only creates empty groups); together they turn a flat `from_java_model` import into an organized outliner. Wraps `OutlinerElement.addTo`. Refuses to move a group into itself or its own descendant (cycle guard). Semantic grouping (which element → which zone) stays in the caller, computed from a `get_element_info` dump — the plugin only performs the move. **STABLE** (verified live + smoke group [14/14]).
- **`find_elements_by_criteria` extended** — added `region_min`/`region_max` (keep only elements whose cube center / mesh origin lies within the zone box; groups excluded when set) and `face_enabled` (keep only cubes whose given face north/south/east/west/up/down is enabled), on top of the upstream name/type/parent/size filters. Closes the remaining gaps in the "find_elements" feature request (positional/region queries + face-state queries) without a new tool.

### Added — `get_element_info` structured element dump (`server/tools/element.ts`)

- **`get_element_info(ids?, group?, selected_only?, include_groups?, include_faces?, include_mesh_geometry?, limit?)`** — read-only structured JSON for elements; the read counterpart to `modify_cube`. Cubes return from/to, computed size, origin, rotation, inflate, box-UV settings, visibility/shade, and (by default) per-face uv/texture/rotation/tint/enabled. Meshes return transform, vertex/face counts, local bounding box, and optionally full vertices/faces (`include_mesh_geometry`, off by default). Groups return transform + child count. Scope precedence: `ids` → `group` (descendants) → `selected_only` → whole project. Designed for offline analysis of imported reference models (e.g. Hardt's Guns via `from_java_model`) — replaces ad-hoc `risky_eval`. Subsumes the "export_model_structure" feature request: a whole-project dump pairs with `list_outline` (hierarchy); statistics / bounding-box / model-diff are then trivial post-processing in Python on the dump rather than separate tools. The existing upstream `find_elements_by_criteria` already covers most of the "find_elements" request (name/type/parent/size filters); this fills its missing companion — full per-element data, which `find_elements_by_criteria` does not return. **STABLE** (verified live + smoke group [13/13]). Reuses the running codec's face-texture resolution pattern (`face.getTexture()?.name`).

### Added — programmatic Minecraft Java model import (`server/tools/import.ts`, `lib/java-model.ts`, `lib/java-model.test.ts`)

- **`from_java_model(model, import_to_current_project?)`** — imports a raw Java block/item model (`.json` with top-level `elements`/`from`/`to`/`faces`, e.g. mod viewmodels like Hardt's Guns) without the File > Import OS dialog. Wraps `Codecs.java_block.load`, which runs `setupProject(java_block)` + `parse` internally. `model` accepts inline JSON, an `http(s)` URL, or a filesystem path (closes the gap in the upstream `from_geo_json`, whose docstring claims "file path" but only fetches `http(s)`). Default opens a new project tab; `import_to_current_project: true` merges into the open project. Passes `no_file: true` when importing into the current project (or when there's no real file backing the model) so the codec's `Project.name`/`export_path`/recent-project side effects never clobber the open project — the texture path is still forwarded to `parse` so texture references resolve. Returns a JSON summary instead of `from_geo_json`'s 3 s screenshot. **STABLE** (verified live against Blockbench 5.x via the running codec). **API symbol:** `Codecs.java_block.load(model, {path}, {import_to_current_project, no_file})`.
- **`lib/java-model.ts`** — pure, Blockbench-free helpers: `classifyModelSource` (inline JSON vs `http(s)` URL vs filesystem path, incl. `file:` URLs and Windows drive paths) and `assertJavaModelShape` (mirrors the codec's `elements`/`parent`/`display`/`textures` guard, but throws a real error instead of the silent UI message box the codec shows — which an MCP client can't see).
- **`lib/java-model.test.ts`** — 18 unit tests via `bun test` covering source classification and shape validation.
- **`scripts/smoke_test.py`** — group `[12/12]` exercises inline-JSON-into-new-tab, real-`.json`-file-into-current-project, and both validation error paths.

---

## [unreleased] — 2026-05-17

### Changed — session inactivity timeout 5min → 60min (`lib/sessions.ts`)

`DEFAULT_INACTIVITY_TIMEOUT_MS` bumped from `5 * 60 * 1000` (5 minutes) to `60 * 60 * 1000` (60 minutes).

Rationale: agentic-coding workflows (Claude Code in particular) regularly have multi-minute stretches with no BB activity while the AI runs Python build scripts, validators, file edits, or external tools. The previous 5min default produced frequent `Session expired or not found. Please reconnect.` errors mid-session, forcing the user to manually `/mcp` reconnect even though Blockbench was still open. Sixty minutes is generous enough for any reasonable batch of non-BB work while still cleaning up genuinely-orphaned sessions (e.g. from a crashed/closed Blockbench) within an hour.

Override via `SessionManager.configure({ inactivityTimeoutMs })` at the `createNetServer` call site if a different value is needed.

---

## [unreleased] — 2026-05-05

### Added — pure-function extraction + unit tests + perf + edge-case coverage (`lib/mesh-analysis.ts`, `lib/mesh-analysis.test.ts`)

Quality pass closing the remaining caveats from the in-session audit:

- **`lib/mesh-analysis.ts`** — extracted the topology / geometry algorithms from `inspect_mesh_geometry` and the `select_mesh_elements` topology branch into a pure-function module: `triangleArea`, `faceArea`, `edgeKey`, `faceEdges`, `buildEdgeAdjacency`, `findBoundaryEdges`, `findNonManifoldEdges`, `findDuplicateVertices`, `findUnusedVertices`, `boundingBox`, `connectedFaces`. Zero Blockbench coupling — testable without a running editor.
- **`lib/mesh-analysis.test.ts`** — 34 unit tests via `bun test` covering the extracted algorithms (right triangles, collinear points, manifold/non-manifold detection, spatial-hash duplicate detection across cell boundaries, BFS connected-component traversal, disconnected-component isolation). Run: `bun test`. Total ~140ms.
- **Spatial-hash duplicate-vertex detection** — `findDuplicateVertices` rewritten from O(n²) pairwise compare to uniform-grid spatial hash with O(n) average complexity. Each vertex is bucketed into `floor(coord/2ε)` cells; pairs are only compared within same/neighbouring cells (3×3×3 neighbourhood). Caps at 50 reported pairs (was the previous limit, preserved). For typical retro PSX meshes (<1000 verts) the runtime drops from milliseconds to microseconds; for dense meshes (>10K verts) it's the difference between "instant" and "noticeable hang".
- **Edge-case test coverage** — smoke test #11 verifies paths with spaces (`dir with spaces/spaced asset.bbmodel`), unicode element names (`münze_münzposition`), and unicode filenames (`tëxtür_ünïcödé.png`). Catches encoding/quoting issues before they bite real asset workflows.
- **`install_plugin_from_path` timing comment** — documented why the 250ms setTimeout is safe (HTTP response flush is microseconds for loopback TCP, 2-3 orders of magnitude clear of the delay), so future readers don't worry about a phantom race.

### Added — mesh inspection + smoke test (`server/tools/mesh.ts`, `scripts/smoke_test.py`)

- `inspect_mesh_geometry(mesh_id?, epsilon?)` — read-only geometry inspector. Returns vertex / face / edge counts, bounding box, and an issues report: non-manifold edges (>2 faces sharing one edge), boundary edges (1 face — open seams), zero-area faces (collapsed/degenerate), duplicate vertices (within `epsilon`), unused vertices (no face references). `is_clean: boolean` summary. Use before glTF export to catch problems that would cause Godot import errors. **STABLE**.
- `scripts/smoke_test.py` — Python smoke test that hits the running MCP server, walks through 15 fork-only tools across 9 test groups (registration, project setup, silent IO, attachments, cube edit, mesh creation, topology selection, animation CRUD, save/reload round-trip), and asserts expected results. Run with `python3 scripts/smoke_test.py`. Protects against regressions when rebasing on upstream — full pass in ~1 s.

### Changed

- `select_mesh_elements`: full refactor to use Blockbench's official `mesh.getSelected{Vertices,Edges,Faces}(true)` writable-reference API instead of direct `Project.mesh_selection[uuid]` access. All array writes converted to in-place mutation (via `setArr` helper) — reassigning a writable ref returned by Blockbench's API doesn't propagate back to the engine. This is the strictly-correct selection access pattern.
- **Known limitation (Blockbench-internal, not fixable from MCP side)**: mesh selection state is wiped between separate MCP HTTP requests. Specifically: a call that sets `selection.faces` returns the correct count at end of execution, but the next MCP request reads the selection as empty. Verified across multiple approaches (direct `Project.mesh_selection` write, `getSelectedFaces(true)` in-place mutation, `mesh.select()` positioning before/after the writes). Affects `topology='connected'` when used without explicit `elements` seeds — the description now mandates explicit seeds. `topology='boundary'` and `topology='inverse'` are unaffected (they don't depend on prior selection). `topology='connected'` with explicit seeds works correctly.
- `README.md`: rewritten Quick reference table covering all 30+ fork-only tools (was stale at "23 additional tools" header). Detailed sections expanded for new categories: hot-swap, attachment points, cube/mesh editing, UV/animation, selection inspection.

- `select_mesh_elements` gained a `topology` parameter (face mode only): `connected` (BFS through shared-edge adjacency from current selection or `elements` seeds), `boundary` (faces with at least one unshared edge — open mesh borders), `inverse` (all faces NOT currently selected). Closes the last gap-analysis "Consider"-tier item that had real pipeline value (mesh cleanup workflow, finding open seams). Verified on closed sphere (boundary=0) and open quad (boundary=1).
- `install_plugin_from_path` promoted from EXPERIMENTAL to STABLE — has been the daily hot-swap mechanism for fork builds, no failures observed.
- `modify_cube` and `modify_cube_uv` descriptions sharpened to make the split clear: `modify_cube` = geometry + box-UV (whole-cube), `modify_cube_uv` = per-face UV / rotation / texture / tint / enabled. Helps future agents pick the right tool on first try.

### Fixed

- `place_mesh` now actually creates faces. The `meshSchema` in `lib/zodObjects.ts` exposed `vertices` but had no `faces` field; the `place_mesh` execute called `mesh.addVertices(...)` per vertex but never `mesh.addFaces(...)`, so every created mesh had loose vertices and no surface (rendered as nothing). Schema now accepts `faces: [{ vertices: [int], uv?: { "<idx>": [u,v] } }]` referencing vertices by 0-based index; execute resolves indices to vkeys via the `addVertices` return value and calls `mesh.addFaces(new MeshFace(mesh, {...}))` per face. Return message now includes `(N verts, M faces)` for verification.
- `save_project_silent` no longer silently writes plain JSON when LZUTF8 is unavailable. Default for `compressed` is now `false` (matching modern Blockbench 5.x which writes `.bbmodel` as plain JSON). With `compressed: true`, if LZUTF8 isn't a global (Blockbench dropped it in newer versions), the call now throws a clear error instead of silently falling through. Return message reports `plain JSON` vs `LZUTF8-compressed` accurately.

### Added — selection state, cube face UV, mesh normals, animation CRUD, UV islands (`server/tools/selection.ts` new, 5 tools)

Closes the remaining "Recommend / Consider" items from the gap-analysis audit (open_project_file, export_texture_to_png, locators, hot-swap shipped earlier — these are the next-tier follow-ups).

- `get_selection()` — read the current Blockbench selection across all levels: outliner elements bucketed by type (cubes, meshes, groups, locators, null objects, texture meshes, armatures, bones), per-mesh sub-selections (selected vertices/edges/faces via `mesh.getSelectedVertices/Edges/Faces`), active group, active animation (`Animation.selected`), current mode (`Modes.selected.id`), current tool (`Toolbox.selected.id`). Read-only. Closes the agent ↔ user handoff gap — "paint the selected face" / "extrude the picked edge" workflows. **STABLE**.
- `modify_cube_uv(id, faces[])` — edit per-face UV / rotation / texture / tint / enabled on an existing cube via `cubeFace.extend({uv, rotation, texture, tint, enabled})`. Complements `place_cube` (face UV at creation only) and `modify_cube` (only box-UV / autouv / uv_offset). UV coords in project pixel space. For tile-kit / atlas-packed cube models. **STABLE**.
- `flip_mesh_normals(mesh_id?, faces?)` — flip face normals by reversing vertex order via `MeshFace.invert()`. Targets explicit face keys, current selection, or the whole mesh. Useful after extrudes go inside-out, when imported geometry has wrong winding, or for inverted-shell effects. **STABLE**.
- `manage_animations(action, animation_id?, ...)` — animation lifecycle CRUD: `list` / `delete` / `rename` / `set_loop` (once/loop/hold via `Animation.setLoop`) / `set_length` (`Animation.setLength`) / `select`. Flexible name lookup handles the Bedrock/free-format auto-prefix (`animation.idle` matches `idle`). Complements the existing `create_animation` and `manage_keyframes`. **STABLE**.
- `uv_island_transform(mesh_id?, seed_face?, translate?, scale?, rotate_degrees?)` — transform an entire UV island as a unit. Discovers the island via `MeshFace.getUVIsland()` from a seed face (explicit > first selected > first overall). Composes translate → scale → rotate around the island's UV centroid. For atlas repacking and fitting unwrapped islands to specific texture regions. **EXPERIMENTAL**.

### Changed

- `server/tools.ts` — registered new `registerSelectionTools` entry point.

### Added — file I/O + attachment points + plugin hot-swap (`server/tools/silent.ts` +3, `server/tools/attachments.ts` new, 5 tools)

- `open_project_file(path)` — load an existing `.bbmodel` from disk into the running Blockbench instance. Handles both LZUTF8-compressed (`<lz>`-prefix) and plain-JSON files; resolves the format via `Formats[model.meta.model_format]`, calls `newProject(format)` to seat a fresh project slot, then `format.codec.load(model, file)` to populate it. Sets `Project.save_path` so subsequent Ctrl+S writes back to the same file. Closes the "fork is create-only" gap — every iteration on existing assets previously needed manual File→Open. **STABLE**.
- `export_texture_to_png(texture_id, path)` — write a single project `Texture` to disk as a standalone PNG via `texture.canvas.toDataURL("image/png")` → `Buffer.from(base64, "base64")` → `fs.writeFileSync`. Composites texture layers automatically (the canvas is the source-of-truth in Blockbench 4.9+). **STABLE**.
- `create_locator(name, position, parent?)` — first-class `Locator` element creation via `new Locator({name, from: position}).init().addTo(group)`. Locators export as named nodes in glTF and become `Marker3D`-equivalents in Godot — pipeline-required for muzzle points, ejection ports, footstep origins, particle/audio emitter mounts. **STABLE**.
- `create_null_object(name, position, parent?, ik_target?, lock_ik_target_rotation?)` — first-class `NullObject` element via `new NullObject({name, position, ik_target, lock_ik_target_rotation}).init().addTo(group)`. Drives IK targets for hand/foot constraints on rigged characters. **STABLE**.
- `install_plugin_from_path(path, plugin_id?)` — hot-swap the running MCP plugin (or any plugin by id) from a local `.js` file with `source: "file"`, surviving Blockbench restarts (no URL re-download). Replicates Blockbench's private `Plugin.#runCode` mechanism (`new Function('requireNativeModule', 'require', code + '\n//# sourceURL=...')`) so the bundle's trailing `Plugin.register(id, {...})` call mutates the existing `Plugins.registered[id]` instance via `extend()` and re-runs `onload`. Persists the new path/source via direct mutation of `Plugins.installed` + `StateMemory.save("installed_plugins")`. Defers actual install via `setTimeout(..., 250)` so the MCP response flushes before the running plugin tears itself down. Closes the chicken-and-egg in iterative fork development — `bun run build` → call this tool → MCP server reconnects in ~200 ms, no UI clicks. **EXPERIMENTAL**.

### Changed

- `server/tools/silent.ts` — `switch_to_tab` enum extended with `"pose"`. Pose-mode is format-conditional (only formats with `pose_mode: true` accept it); the existing `Modes.options[tab].select()` path throws a clear error for formats that don't.
- `server/tools.ts` — registered new `registerAttachmentTools` entry point alongside the existing module entry points.

### Added — silent IO tools (`server/tools/silent.ts`, 7 tools)

- `save_project_silent(path, compressed?)` — direct `.bbmodel` write. Uses `Codecs.project.compile()` + `LZUTF8.compress(content, {outputEncoding: "StorageBinaryString"})` to produce on-disk format byte-identical to upstream `save_project`. Status: **STABLE**.
- `export_gltf_silent(path, embed_textures?, animations?)` — direct glTF/GLB write. Status: **EXPERIMENTAL** (codec discovery varies by Blockbench version).
- `force_backup_now()` — trigger immediate auto-save backup. Status: **EXPERIMENTAL**.
- `set_project_resolution(width, height)` — sets `Project.texture_width` / `texture_height`. Critical for atlas-based UV workflows. Status: **STABLE**.
- `delete_texture(id)` — programmatic texture removal (UUID/name/numeric id). Status: **STABLE**.
- `switch_to_tab(tab)` — switch edit/paint/animate/display via `Modes.options[tab].select()`. Useful for switching back to Edit tab before glTF export (Blockbench bug #2224 workaround). Status: **STABLE**.
- `get_project_state()` — diagnostic JSON of project metadata. Status: **STABLE**.

### Added — workflow extras (`server/tools/workflow_extra.ts`, 16 tools)

**Symmetry & pivots:**
- `mirror_elements(axis, element_ids?, duplicate?)` — mirror across world axis with optional duplication. **STABLE**.
- `set_origin(element_id, origin)` — set pivot to explicit `[x,y,z]` or symbolic `geometry_center` / `world_origin` / `parent_group`. **STABLE**.

**History:**
- `undo(steps?)` / `redo(steps?)` — programmatic history navigation. **STABLE**.

**I/O:**
- `convert_project(format)` — switch project format. **EXPERIMENTAL**.
- `add_reference_image(path, position?, scale?, axis?)` — backdrop image. **EXPERIMENTAL**.

**Mesh ops** (all **EXPERIMENTAL** — depend on `BarItems.<action>.click()` patterns):
- `mesh_bevel_edge(mesh_id, edge_keys, width?)`
- `mesh_inset_face(mesh_id, face_keys, inset?)`
- `mesh_loop_cut(mesh_id, face_key, cuts?)`

**Layout:**
- `align_elements(element_ids, axis, mode)` — min/center/max alignment. **STABLE**.
- `distribute_elements(element_ids, axis)` — even spacing. **STABLE**.

**Outliner:**
- `set_group_visibility(group_id, visible)` — **STABLE**.
- `lock_group(group_id, locked)` — **STABLE**.

**Selection & settings:**
- `select_by_pattern(pattern, type?)` — regex match on element names. **STABLE**.
- `read_setting(key)` — read a Blockbench setting. **STABLE**.
- `write_setting(key, value)` — change theme, autosave_interval, etc. **STABLE**.

### Changed

- `server/tools.ts` — registered the two new module entry points (`registerSilentTools`, `registerWorkflowExtraTools`) in the registration list. No upstream tools removed or modified.
- `README.md` — replaced with fork-specific README. Upstream README preserved at `README.upstream.md`.

### Files added

```
server/tools/silent.ts          (~470 LOC)
server/tools/workflow_extra.ts  (~740 LOC)
README.md                       (fork README, replacing upstream)
README.upstream.md              (preserved upstream README)
CHANGELOG.fork.md               (this file)
```

### Build artifacts

`dist/mcp.js` produced by `bun run build` is a single ~568 KB minified bundle containing both upstream and fork tools. Not committed (gitignore'd in upstream).

### Compatibility

- **Blockbench**: tested on 5.1.4. Should work on 5.0+ for STABLE tools; EXPERIMENTAL tools may need adjustment per version.
- **MCP SDK**: 1.25.3 (matches upstream `package.json`).
- **Bun**: 1.x (matches upstream `package.json`).

### Sync history

Initial fork branch created from upstream `main` at commit [`afb30be`](https://github.com/jasonjgardner/blockbench-mcp-plugin/commit/afb30be) ("Merge pull request #36 from jasonjgardner/jasonjgardner-patch-1", 2026-02-22) on 2026-05-05. As of this entry, this is also `upstream/main` HEAD — no upstream rebases needed yet.

To check whether we've fallen behind upstream:

```bash
git fetch upstream
git log --oneline upstream/main..mcmarius/extensions   # our commits not yet upstreamed
git log --oneline mcmarius/extensions..upstream/main   # upstream commits we'd need to rebase onto
```

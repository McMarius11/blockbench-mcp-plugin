# Blockbench MCP — McMarius11 fork

Fork of [`jasonjgardner/blockbench-mcp-plugin`](https://github.com/jasonjgardner/blockbench-mcp-plugin) with **30+ additional tools** that close gaps in the upstream MCP coverage. Built for AI-driven 3D asset pipelines (e.g. [`asset-generator-blockbench`](https://github.com/McMarius11/asset-generator-blockbench)).

> Original upstream README is preserved at [`README.upstream.md`](./README.upstream.md). License (GPL-3.0-only) is unchanged.
>
> Known limitations and deferred items are tracked in [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

## Quick reference — fork-only tools

| Category | Tools |
|---|---|
| **File I/O (silent)** | `save_project_silent`, `export_gltf_silent` (Edit-tab guard), `force_backup_now`, `open_project_file`, `export_texture_to_png`, `set_project_resolution`, `delete_texture`, `switch_to_tab` (idempotent), `get_current_tab`, `get_project_state` |
| **Plugin lifecycle** | `install_plugin_from_path` |
| **Outliner & attachment points** | `create_locator`, `create_null_object`, `add_reference_image` |
| **Symmetry & pivots** | `mirror_elements`, `set_origin` |
| **Cube editing** | `modify_cube_uv` |
| **Mesh editing** | `flip_mesh_normals`, `inspect_mesh_geometry`, `mesh_bevel_edge`, `mesh_inset_face`, `mesh_loop_cut`, `select_mesh_elements` (extended with topology modes connected/boundary/inverse) |
| **UV editing** | `uv_island_transform` |
| **Animation** | `manage_animations`, `get_bone_transforms_at_time`, `read_animation_keyframes` |
| **Selection inspection** | `get_selection` |
| **Element inspection & organization** | `get_element_info`, `move_to_group`, `export_model_structure`, `get_bounding_box`, `get_element_statistics`, `highlight_elements`, `group_by_criteria` (+ `find_elements_by_criteria` region/face/texture/bbox/prefix filters) |
| **Model analysis & UV QA** | `compare_models`, `validate_rig`, `find_uv_overlaps`, `uv_island_list`, `uv_density_per_face` |
| **Cube placement (upstream, extended)** | `place_cube` (per-element `parent` for one-call rigged hierarchies) |
| **Camera (upstream, extended)** | `capture_screenshot` (+ `width`/`height`/`background`/`return_format`), `set_camera_angle` (preserves `zoom` + accepts explicit `zoom`) |
| **Project I/O** | `convert_project` |
| **Model import** | `from_java_model` |
| **Layout** | `align_elements`, `distribute_elements`, `set_group_visibility`, `lock_group` |
| **Selection / settings** | `select_by_pattern`, `read_setting`, `write_setting` |

## What this fork adds (detail)

The upstream plugin exposes most of Blockbench's modeling/animation API — but a few common operations either trigger OS-native dialogs the agent can't auto-confirm (the `save_project` popup), or aren't reachable at all without `risky_eval`. This fork ships them as proper MCP tools.

### Silent IO (no popup)

| Tool | Purpose |
|---|---|
| `save_project_silent(path, compressed?)` | Direct `.bbmodel` write via `Codecs.project.compile()`, updates `Project.save_path`. Default writes plain JSON (modern Blockbench 5.x format); opt in to legacy LZUTF8 with `compressed: true` |
| `export_gltf_silent(path, embed_textures?, animations?, require_edit_tab?)` | Direct `.glb`/`.gltf` write, no dialog. `require_edit_tab` (default true) auto-switches to the Edit tab before compiling and reports `switched_from` — guards Blockbench [#2224](https://github.com/JannisX11/blockbench/issues/2224) (Animate-tab export bakes the scrub frame into the rest pose). Set false to opt out |
| `open_project_file(path)` | Load existing `.bbmodel` from disk into the running instance — handles both `<lz>`-prefixed LZUTF8 and plain-JSON files; format-aware via `Formats[model.meta.model_format]` |
| `export_texture_to_png(texture_id, path)` | Write a single project texture to disk as PNG via `texture.canvas.toDataURL` (composites layers automatically) |
| `force_backup_now()` | Trigger an immediate auto-save backup |
| `set_project_resolution(width, height)` | Set `texture_width`/`texture_height` (UV coordinate space) |
| `delete_texture(id)` | Remove orphan textures programmatically |
| `switch_to_tab(tab, force?)` | Switch `edit`/`paint`/`animate`/`display`/`pose` modes. Idempotent: returns `{ tab, changed: false }` when already on the target (no UI churn); `force: true` re-selects regardless |
| `get_current_tab()` | Return the active mode tab as `{ tab }` — lightweight readback so multi-phase builds skip redundant `switch_to_tab` calls |
| `get_project_state()` | Diagnostic JSON: name, format, save_path, texture sizes, counts, current mode |

### Model import

| Tool | Purpose |
|---|---|
| `from_java_model(model, import_to_current_project?, ignore_textures?, assets_root?)` | Import a raw Minecraft **Java** block/item model (`.json` with top-level `elements`, e.g. mod viewmodels like Hardt's Guns) without the File > Import dialog. `model` accepts inline JSON, an `http(s)` URL, or a filesystem path; wraps `Codecs.java_block.load`. Default opens a new Java Block/Item project tab; `import_to_current_project: true` merges the elements into the open project (its name/export settings are preserved). `ignore_textures: true` drops the model's textures (block + per-face refs) — for geometry-only analysis. `assets_root` (or auto-derived from `optifine`/`cit` paths) resolves namespaced texture refs (`item/foo`) to `<assets_root>/textures/item/foo.png`, fixing the "File Not Found" Blockbench hits on OptiFine CIT / resource-pack models. Returns a JSON summary (project name, format, element/cube counts, `textures_ignored`, `texture_assets_root`). For Bedrock geometry use the upstream `from_geo_json` instead |

### Plugin hot-swap

| Tool | Purpose |
|---|---|
| `install_plugin_from_path(path, plugin_id?)` | Install/replace a Blockbench plugin from a local `.js` file with `source: "file"`. Replicates Blockbench's private `Plugin.#runCode` (`new Function(...)`) so the new bundle's `Plugin.register(id, {...})` mutates the existing instance via `extend()` and re-runs `onload`. Persists via direct `StateMemory.save("installed_plugins")`. **Closes the iterative-fork-development loop**: `bun run build` → call this tool → MCP server reconnects in ~200 ms, no UI clicks |

### Attachment points

| Tool | Purpose |
|---|---|
| `create_locator(name, position, parent?)` | First-class `Locator` element creation. Locators export as named glTF nodes / `Marker3D` in Godot — for muzzle points, ejection ports, footstep origins |
| `create_null_object(name, position, parent?, ik_target?, lock_ik_target_rotation?)` | First-class `NullObject` element. Drives IK targets for hand/foot constraints |
| `add_reference_image(path, position?, scale?, axis?)` | Backdrop image for matching concept art |

### Cube / mesh editing

| Tool | Purpose |
|---|---|
| `place_cube` (upstream + extended) | Each entry in `elements[]` may carry its own `parent` (group/bone name or uuid), so a single call parents a whole humanoid body to different bones via `Cube.addTo`. The top-level `group` becomes the batch default for elements without a `parent`. Replaces the per-cube reparent `risky_eval`. Parented cubes keep their authored world position and rotate correctly around the parent bone's origin — no coordinate rebasing needed |
| `modify_cube_uv(id, faces[])` | Per-face UV / rotation / texture binding / tint / enabled on existing cubes (complements `place_cube` which only sets face UVs at creation) |
| `flip_mesh_normals(mesh_id?, faces?)` | Flip face normal direction by reversing vertex order via `MeshFace.invert()`. Useful after extrudes go inside-out |
| `inspect_mesh_geometry(mesh_id?, epsilon?)` | Read-only geometry inspector: vertex/face/edge counts, bounding box, non-manifold edges, boundary edges, zero-area faces, duplicate vertices, unused vertices. Use before glTF export to catch issues that would break Godot import |
| `select_mesh_elements` (upstream + extended) | Now supports `topology` parameter: `connected` (BFS from current selection or `elements` seeds), `boundary` (faces with unshared edges), `inverse` (faces NOT currently selected) |

### UV / animation

| Tool | Purpose |
|---|---|
| `uv_island_transform(mesh_id?, seed_face?, translate?, scale?, rotate_degrees?)` | Translate / scale / rotate an entire UV island (discovered via `MeshFace.getUVIsland()`) around its centroid. For atlas repacking |
| `manage_animations(action, animation_id?, ...)` | Animation lifecycle CRUD: `list`, `delete`, `rename`, `set_loop` (once/loop/hold), `set_length`, `select`. Flexible name lookup handles auto-prefixed names like `animation.idle` |
| `get_bone_transforms_at_time(animation_id?, time, bones?)` | Sample interpolated bone transforms (position, rotation in **degrees**, scale) at a given time via `BoneAnimator.interpolate` — numeric animation QA without screenshot heuristics. Read-only (the timeline cursor is restored). For loop-pop checks (t=0 vs t=length) and rest-pose verification. Same 1:1 visual-euler rotation convention as `create_animation` |
| `read_animation_keyframes(animation_id?, bones?, channels?, time?, time_range?)` | Read back the **raw authored** keyframes (rotation°/position/scale) per bone — not interpolated samples. Values round-trip 1:1 with `create_animation` (post-#2 fix), so this is the tool for screenshot-free rotation regression. Filter by bone, channel, exact `time`, or `time_range`. Read-only |

### Selection inspection

| Tool | Purpose |
|---|---|
| `get_selection()` | Read current selection across all levels: outliner elements bucketed by class, mesh sub-selections (vertices/edges/faces per mesh), active group, active animation, current mode/tool. Closes the agent ↔ user handoff gap |

### Element inspection & organization

| Tool | Purpose |
|---|---|
| `get_element_info(ids?, group?, selected_only?, include_groups?, include_faces?, include_mesh_geometry?, limit?)` | Structured JSON dump of element data — the read counterpart to `modify_cube`. Cubes: from/to, computed size, origin, rotation, inflate, box-UV, visibility/shade, and (default) per-face uv/texture/rotation/tint/enabled. Meshes: transform, vertex/face counts, local bounding box, optional full geometry. Groups: transform + child count. Scope via `ids` / `group` / `selected_only`, or omit all for the whole project. Read-only; pair with `list_outline` (hierarchy) and `find_elements_by_criteria` (IDs). Use instead of `risky_eval` for offline analysis of imported reference models |
| `move_to_group(ids, target_group)` | Reparent existing cubes/meshes/groups into a target group (or `"root"`). The complement to `add_group` (which only creates empty groups) — turns a flat import into an organized outliner. Refuses to move a group into itself or a descendant. The caller decides which element goes where (e.g. from a `get_element_info` dump); this just performs the move |
| `export_model_structure(scope?, group?, include_animations?, include_faces?, max_elements?)` | One-shot bulk JSON dump: project metadata + full group hierarchy + every cube/mesh (with geometry and per-face data) + textures + optional animation summary. Replaces dozens of `get_element_info` roundtrips; the natural `before`/`after` input to `compare_models`. Respects `max_elements` and flags `truncated` |
| `get_bounding_box(target, group_id?, coordinate_space?)` | Aggregated `{min,max,center,extents}` for `selection` / `group` / `project` / `visible`. `world` space is rotation/parent-aware (THREE `Box3`, for auto-framing screenshots); `local` is the raw from/to + vertex extent. Replaces ad-hoc `risky_eval` bbox queries |
| `get_element_statistics(scope?, group?)` | Aggregated stats: totals, cube count by texture, cube-size histogram, estimated triangle count (cubes = 2 tris/enabled face, meshes fan-triangulated), cubes per group. For poly budgeting and comparing reference models |
| `group_by_criteria(group_name, parent_group?, ...filters, limit?)` | Find elements (name / type / region / texture filters) **and** move them into a NEW group in one step — the write-side companion to `find_elements_by_criteria`. Speeds up organizing flat imports into zones (receiver / barrel / stock). Groups themselves are never moved |
| `highlight_elements(ids, color?, duration_ms?, clear_previous?)` | Temporarily highlight elements in the viewport — non-destructive (never touches geometry/materials). Via selection, or with a hex `color` drawing a temporary `THREE.Box3Helper` box overlay (auto-cleans after `duration_ms`, default 2000 ms flash). For visually confirming `find_elements_by_criteria` results |
| `find_elements_by_criteria` (upstream + extended) | Adds `region_min`/`region_max` (cube center / mesh origin inside a zone box), `bbox_overlaps` (cube from/to box **intersects** a region, not just its center), `face_enabled` (cubes with a given face enabled), `texture_name`/`texture_uuid` (faces using a texture), and `name_prefix`/`name_suffix`, on top of the upstream name/type/parent/size filters |

### Model analysis & UV QA

| Tool | Purpose |
|---|---|
| `compare_models(before, after?)` | Diff two model structures by UUID: added / removed / renamed / reparented elements and groups, plus per-face UV changes. Pass two `export_model_structure` dumps, or just `before` to diff against the currently open project. For regression tracking between build iterations |
| `validate_rig(checks?, pairs?, chains?, …thresholds)` | **EXPERIMENTAL.** Composite live-rig checks → `{ passed, issues[] }`: `bone_orphans` (animated bones with no child elements, automatic), `limb_pivot` (nearest cube corner ≤ `limb_anchor_max` 0.5u from bone origin), `hand_center` (cube center ≤ `hand_bone_center_max` 1.25u), `limb_x_seam` (adjacent chain cubes share a Y cross-section at the X seam). Supply `pairs` (bone↔cube) and `chains` (ordered cubes); thresholds mirror `validate_asset.py` — tune for your rig (issue #20) |
| `find_uv_overlaps(scope?, group?, min_area?)` | Find faces whose UV rectangles overlap on the **same** texture (the classic cause of texture bleed). Overlaps across different textures are ignored. Returns overlapping face pairs with overlap area, grouped by texture |
| `uv_island_list(scope?, group?)` | List UV islands (connected components of overlapping/touching face rects) per texture, largest first, with member faces and bounds. For auditing atlas layout |
| `uv_density_per_face(scope?, group?, limit?)` | Per-face UV density: pixel area, fraction of the atlas, and (for cubes) texels-per-world-unit² — to spot under/over-resolved faces in a 256×256-style atlas workflow |

### Camera (upstream tools, extended)

| Tool | Purpose |
|---|---|
| `capture_screenshot` (extended) | Adds `width`/`height` (fixed output resolution for reproducible QA frames; both required together), `background` (`"transparent"` or a hex color, to avoid theme-dependent backdrops), and `return_format: "file"` (writes a PNG to `path` instead of returning it inline). The live viewport is restored after capture |
| `set_camera_angle` (extended) | Now **preserves** the current zoom across angle changes (previously every call reset it) and accepts an optional explicit `zoom` for reproducible framing. `get_project_info` also reports a `camera` block (projection / zoom / position / target) so zoom is queryable without `risky_eval` |

### Symmetry & pivots

| Tool | Purpose |
|---|---|
| `mirror_elements(axis, element_ids?, duplicate?)` | Mirror across X/Y/Z, optionally duplicate first |
| `set_origin(element_id, origin)` | Set pivot to `[x,y,z]` or `geometry_center` / `world_origin` / `parent_group` |

### History & I/O

| Tool | Purpose |
|---|---|
| `undo(steps?)` / `redo(steps?)` | Programmatic history navigation — **now provided by upstream's `history` module** (which also adds `get_undo_stack` and `save_checkpoint`); the fork's original implementation was dropped in favor of upstream's on the upstream-sync merge |
| `convert_project(format)` | Switch project format (e.g. `free` ↔ `bedrock_block`) |
| `add_reference_image(path, position?, scale?, axis?)` | Backdrop image for matching concept art |

### Mesh ops (experimental — depend on Blockbench version)

| Tool | Purpose |
|---|---|
| `mesh_bevel_edge(mesh_id, edge_keys, width?)` | Chamfer mesh edges |
| `mesh_inset_face(mesh_id, face_keys, inset?)` | Inset selected faces |
| `mesh_loop_cut(mesh_id, face_key, cuts?)` | Loop-cut a face into N strips |

### Layout helpers

| Tool | Purpose |
|---|---|
| `align_elements(element_ids, axis, mode)` | Align min/center/max on axis |
| `distribute_elements(element_ids, axis)` | Even spacing on axis |
| `set_group_visibility(group_id, visible)` | Show/hide a group |
| `lock_group(group_id, locked)` | Lock/unlock to prevent edits |

### Selection & settings

| Tool | Purpose |
|---|---|
| `select_by_pattern(pattern, type?)` | Regex match on element names |
| `read_setting(key)` | Read a Blockbench setting |
| `write_setting(key, value)` | Change theme, autosave_interval, etc. |

## Why these were added

Each tool came out of a real friction point during AI-driven asset creation:

- **Silent IO**: the upstream `trigger_action(save_project)` opens an Electron-native `dialog.showSaveDialog()` that the MCP plugin's `confirmDialog: true` flag can't auto-confirm — it only handles DOM dialogs, not OS-native pickers. The agent ends up blocked waiting for a human click. `save_project_silent` writes directly via Blockbench's `Codecs.project.compile()` + `LZUTF8.compress()`, matching the on-disk format byte-for-byte.
- **Symmetry**: building paired weapon/character parts manually wastes tokens and risks asymmetry drift. Mirror solves it in one call.
- **Pivots**: animation rotation pivots only get set at `place_cube` time. If you discover the pivot is wrong after building, you previously had to delete + recreate. `set_origin` fixes that in place.
- **Undo/redo**: the agent sometimes builds something wrong. Without programmatic undo, recovery means deleting + rebuilding from scratch.
- **Mesh ops**: extrude + subdivide alone aren't enough for non-trivial mesh shapes. Bevel + inset + loop-cut close the gap.

## Installation

```bash
git clone https://github.com/McMarius11/blockbench-mcp-plugin
cd blockbench-mcp-plugin
git checkout mcmarius/extensions

# Install bun if missing
curl -fsSL https://bun.sh/install | bash

bun install
bun run build

# Install built plugin
cp dist/mcp.js ~/.config/Blockbench/plugins/mcp.js
# (Linux path; Mac: ~/Library/Application Support/Blockbench/plugins/)

# Reload plugin in Blockbench: File → Plugins → MCP → Reload icon
# (or restart Blockbench)
```

The plugin starts an HTTP MCP server on `http://localhost:3000/bb-mcp` whenever Blockbench is running. Connect your AI agent (Claude Code, Cline, etc.) to that endpoint.

## Branch strategy

- `main` — tracks upstream `main`, untouched
- `mcmarius/extensions` — our additions on top of upstream main
- We periodically rebase `mcmarius/extensions` on top of upstream `main`

To pull upstream changes:

```bash
git fetch upstream
git checkout mcmarius/extensions
git rebase upstream/main
git push --force-with-lease origin mcmarius/extensions
```

## Status disclaimers

- **STABLE** (13): tested on Blockbench 5.1.x. Should work across recent versions.
- **EXPERIMENTAL** (10): depend on Blockbench-version-specific globals or BarItems-click patterns. Tested on 5.1.x but may break on future versions:
  - `export_gltf_silent` (codec discovery)
  - `force_backup_now` (depends on `BarItems.save_recovery_data`)
  - `add_reference_image` (depends on `ReferenceImage` global)
  - `convert_project` (depends on `Formats[id].convertTo`)
  - `mesh_bevel_edge` / `mesh_inset_face` / `mesh_loop_cut` (depend on BarItems handles)

## Upstream PR status

**Not yet submitted.** When the tools have been validated on more real-world workloads we may open PRs to upstream — possibly split into two (silent IO as gap-fix, workflow extras as new features).

## Related projects

- [`McMarius11/asset-generator-blockbench`](https://github.com/McMarius11/asset-generator-blockbench) — the AI asset pipeline this fork was built for
- [`jasonjgardner/blockbench-mcp-plugin`](https://github.com/jasonjgardner/blockbench-mcp-plugin) — upstream
- [`jasonjgardner/blockbench-mcp-project`](https://github.com/jasonjgardner/blockbench-mcp-project) — companion skill pack (works with this fork)

## License

GPL-3.0-only (unchanged from upstream). See [LICENSE](./LICENSE).

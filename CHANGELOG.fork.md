# Fork changelog

Tracks additions made on top of upstream [`jasonjgardner/blockbench-mcp-plugin`](https://github.com/jasonjgardner/blockbench-mcp-plugin) by the `mcmarius/extensions` branch.

Upstream changes are NOT logged here — see upstream `CHANGELOG.md` (if present) or `git log upstream/main`.

---

## [unreleased] — 2026-05-05

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

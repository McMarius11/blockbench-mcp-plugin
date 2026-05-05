# Fork changelog

Tracks additions made on top of upstream [`jasonjgardner/blockbench-mcp-plugin`](https://github.com/jasonjgardner/blockbench-mcp-plugin) by the `mcmarius/extensions` branch.

Upstream changes are NOT logged here — see upstream `CHANGELOG.md` (if present) or `git log upstream/main`.

---

## [unreleased] — 2026-05-05

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

Initial fork branch created from upstream `main` at commit `<upstream-sha>` on 2026-05-05. No upstream rebases yet.

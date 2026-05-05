# Blockbench MCP — McMarius11 fork

Fork of [`jasonjgardner/blockbench-mcp-plugin`](https://github.com/jasonjgardner/blockbench-mcp-plugin) with **23 additional tools** that close gaps in the upstream MCP coverage. Built for AI-driven 3D asset pipelines (e.g. [`asset-generator-blockbench`](https://github.com/McMarius11/asset-generator-blockbench)).

> Original upstream README is preserved at [`README.upstream.md`](./README.upstream.md). License (GPL-3.0-only) is unchanged.

## What this fork adds

The upstream plugin exposes most of Blockbench's modeling/animation API — but a few common operations either trigger OS-native dialogs the agent can't auto-confirm (the `save_project` popup), or aren't reachable at all without `risky_eval`. This fork ships them as proper MCP tools.

### Silent IO (no popup)

| Tool | Purpose |
|---|---|
| `save_project_silent(path, compressed?)` | Direct `.bbmodel` write, LZUTF8-compatible, updates `Project.save_path` |
| `export_gltf_silent(path, embed_textures?, animations?)` | Direct `.glb`/`.gltf` write, no dialog |
| `force_backup_now()` | Trigger an immediate auto-save backup |
| `set_project_resolution(width, height)` | Set `texture_width`/`texture_height` (UV coordinate space) |
| `delete_texture(id)` | Remove orphan textures programmatically |
| `switch_to_tab(tab)` | Switch edit/paint/animate/display modes |
| `get_project_state()` | Diagnostic JSON: name, format, save_path, texture sizes, counts |

### Symmetry & pivots

| Tool | Purpose |
|---|---|
| `mirror_elements(axis, element_ids?, duplicate?)` | Mirror across X/Y/Z, optionally duplicate first |
| `set_origin(element_id, origin)` | Set pivot to `[x,y,z]` or `geometry_center` / `world_origin` / `parent_group` |

### History & I/O

| Tool | Purpose |
|---|---|
| `undo(steps?)` / `redo(steps?)` | Programmatic history navigation |
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

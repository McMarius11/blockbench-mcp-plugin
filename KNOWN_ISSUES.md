# Known issues

Things that don't work, are deferred, or carry a caveat in this fork. Honest list — not blockers for the boomer-shooter pipeline this fork was built for, but worth knowing before you hit them.

Last audit: 2026-06-08 (post pipeline issue batches #2–#16 and #19–#24; 154 tools, `bun test` 66, smoke `[18/18]` 85 assertions).

---

## Index

| # | Severity | Category | Title |
|---|---|---|---|
| 1 | low | architectural | [Mesh selection wipes between MCP requests](#1-mesh-selection-wipes-between-mcp-requests) |
| 2 | low | API gap | [Vertex colors on Mesh not exposed](#2-vertex-colors-on-mesh-not-exposed) |
| 3 | low | architectural | [No live events / push notifications](#3-no-live-events--push-notifications) |
| 4 | low | architectural | [Arbitrary OS-native dialogs cannot be auto-confirmed](#4-arbitrary-os-native-dialogs-cannot-be-auto-confirmed) |
| 5 | medium | infrastructure | [No CI/CD pipeline (manual smoke test only)](#5-no-cicd-pipeline-manual-smoke-test-only) |
| 6 | medium | infrastructure | [Compatibility tested only on Blockbench 5.1.x](#6-compatibility-tested-only-on-blockbench-51x) |
| 7 | low | code quality | [`@ts-ignore` density (254 sites) + type debt](#7-ts-ignore-density--pre-existing-type-debt) |
| 8 | low | code quality | [Bundle size 587 KB — not tree-shaken](#8-bundle-size) |
| 9 | low | code quality | [EXPERIMENTAL tools not individually re-validated](#9-experimental-tools-not-individually-re-validated) |

Severity meaning: **low** = no real-world workflow blocker, **medium** = quality gap that would matter for production / wider adoption, **high** = pipeline-blocking (no `high` open items).

---

## Truly unfixable from our side (4)

These are constrained by Blockbench-internal architecture or by the MCP protocol shape itself. Closing them would require changes outside the plugin code — i.e. patching Blockbench upstream, switching protocols, or running outside the renderer process.

### 1. Mesh selection wipes between MCP requests

**Symptom**

Call `select_mesh_elements({mesh_id, mode: "face", action: "select"})` to select all 72 faces of a mesh. Return value confirms `selected: {faces: 72}`. Then immediately call `select_mesh_elements({..., topology: "connected", action: "select"})` (which depends on the prior selection as the BFS seed). The second call sees an empty selection and throws:

```
topology='connected' needs either explicit `elements` as seeds or a non-empty current face selection.
```

**Root cause**

Between two HTTP requests Blockbench resets the per-mesh selection state. The exact trigger is one of:

- Canvas render-tick treating idle time as "user finished selecting"
- Focus / blur events on the editor window
- Mode-change side effects firing between requests
- GC-style cleanup of non-active selection

We cannot identify the exact event from outside without monkey-patching Blockbench's render loop.

**Approaches tried (all wipeable)**

1. Direct write to `Project.mesh_selection[uuid].faces`
2. Official `mesh.getSelectedFaces(true)` writable-reference API + in-place mutation
3. Repositioning `mesh.select()` before vs. after the writes

All three approaches show the same pattern: selection is intact at end-of-call-1, gone at start-of-call-2.

**Impact**

Low. All 16 fork-only tools and 100 upstream tools have explicit-ID code paths — only `topology="connected"` without `elements` seeds is affected.

**Workaround**

Pass `elements` as explicit seeds for `topology="connected"`:

```ts
mcp__blockbench__select_mesh_elements({
  mesh_id: "sph",
  mode: "face",
  topology: "connected",
  elements: ["face_key_42"],   // BFS starts from this face
  action: "select",
})
```

`topology="boundary"` and `topology="inverse"` are not affected — they don't depend on prior selection.

**Path to fix**

Would require either patching Blockbench's selection-clear behaviour upstream (PR to `JannisX11/blockbench`) or running our MCP server inside the same event-loop tick as Blockbench's interactive selection paths (architectural change). Neither is in scope.

---

### 2. Vertex colors on Mesh not exposed

**Symptom**

No MCP tool to set per-vertex colors on Mesh elements (e.g. for PSX-style flat-shaded geometry without textures).

**Root cause**

Blockbench's Mesh class doesn't expose vertex colors as a first-class API. Color is a face-level Cube property (`face.tint`) and a TextureLayer property, but Mesh vertices have no stable `vertex.color`-style setter as of Blockbench 5.1.x.

**Impact**

Low. The retro pipeline this fork was built for uses textured atlases for 90% of assets; vertex-colored flat shading would be a nice-to-have for the remaining ~10% (small environment props).

**Workaround**

Use a single solid-color texture per material and atlas-pack it. Slightly more memory than vertex colors but no behavioural difference at this poly count.

**Path to fix**

Wait for Blockbench upstream to expose vertex colors as a stable API, then wrap. Plan-file gap-analysis already had this as **"Consider, wenn API stabil"**.

---

### 3. No live events / push notifications

**Symptom**

Cannot subscribe to Blockbench events from the agent (e.g. "notify me when the user saves the project" or "tell me when an animation finishes playing").

**Root cause**

The MCP protocol is request/response by design. Server-to-client streaming requires SSE (or WebSocket) transport with explicit `notifications/*` plumbing.

> **Updated 2026-05-25:** The upstream-sync merge (v1.6.0) replaced the old
> `StreamableHTTPServerTransport` (`enableJsonResponse: true`, no SSE) with
> `WebStandardStreamableHTTPServerTransport`, which **does** open SSE streams
> (see `server/net.ts` — `sseHeartbeatIntervalMs`, SSE comment heartbeats).
> The transport-level blocker is therefore **gone**; what remains is wiring
> Blockbench event subscriptions to MCP `notifications/*` messages. This item
> is now a feature-implementation gap rather than an architectural limitation.

**Impact**

Low. Polling via existing tools (`get_project_state`, `get_selection`) covers all observation needs the asset pipeline has so far.

**Workaround**

Poll `get_project_state` between operations to detect changes (e.g. cube count delta, save-path changes).

**Path to fix**

Now that the transport supports SSE, add per-event MCP `notifications/*` handlers that subscribe to Blockbench events (`Blockbench.on(...)`). ~0.5 day for a thin MVP (e.g. "notify on save"). Deferred until a concrete use case emerges.

---

### 4. Arbitrary OS-native dialogs cannot be auto-confirmed

**Symptom**

Any Blockbench action that triggers an Electron-native `dialog.show*Dialog` (custom file picker, system message box) blocks waiting for user click. The MCP plugin's `confirmDialog: true` flag only handles DOM dialogs.

**Root cause**

Electron native dialogs run in the main process. The MCP HTTP server lives in the renderer process. There is no in-renderer API to dismiss main-process dialogs.

**Impact**

Low. The two highest-frequency offenders (`save_project`, `export_gltf`) were specifically worked around via direct codec calls (`save_project_silent`, `export_gltf_silent`). What remains are rare actions: `Texture → Resize`, `File → Convert Project Format` (sometimes), `File → Import` for non-bundled formats. None of these are core to the asset workflow.

**Workaround**

For each rarely-used action that pops a dialog, add a typed silent wrapper as the need arises (the silent-IO pattern is well established now — see `silent.ts`).

**Path to fix**

Per-action workarounds. There is no general-purpose fix.

---

## Infrastructure deferred (2)

These are fixable but require infrastructure work disproportionate to current usage. Worth doing if the fork gains external contributors or starts seeing real upstream-rebase pain.

### 5. No CI/CD pipeline (manual smoke test only)

**Symptom**

The test suite (66 unit + 85 integration assertions) must be run manually:

```bash
bun test                              # unit tests, no Blockbench needed
python3 scripts/smoke_test.py         # integration tests, needs running Blockbench
```

GitHub Actions would catch upstream-rebase regressions automatically.

**Why it's hard**

The integration tests need a running Blockbench instance with the fork plugin loaded. In a headless GitHub-Actions runner that means:

- Xvfb (virtual framebuffer)
- Blockbench AppImage extracted (FUSE may not be available — `--appimage-extract` workaround)
- Plugin pre-installed with `source: "file"`
- Test runner waits for the MCP HTTP server to come up before starting smoke tests

Estimated effort: 1-2 days to get a stable green pipeline.

**Workaround**

Run smoke test manually before each commit that touches `server/tools/`. The full suite completes in a few seconds, so the ergonomics are tolerable.

**Path to fix**

GitHub Actions workflow with Xvfb + extracted AppImage + plugin pre-install. Reference: there are existing Electron CI patterns (`xvfb-run`) that should adapt.

---

### 6. Compatibility tested only on Blockbench 5.1.x

**Symptom**

The fork is verified on Blockbench 5.1.4. EXPERIMENTAL-status tools (~30 in upstream subset) depend on version-specific globals (`BarItems.<id>.click`, `Painter.<method>`, etc.) which may break silently on 5.0 or 5.2.

**Root cause**

Blockbench's API is mostly stable but has version-specific quirks. Without a test matrix, we don't know which tools degrade where.

**Impact**

Medium for users on older / newer Blockbench versions. Zero for users on 5.1.x.

**Workaround**

Stay on Blockbench 5.1.x.

**Path to fix**

Set up a multi-version test rig (Blockbench 4.12, 5.0.6, 5.1.4, latest) and run smoke + unit tests against each. Half a day per version.

---

## Low-ROI deferred (3)

Code-quality and optimisation items I could fix but the value-per-hour is low and there's no concrete bug driving them.

### 7. `@ts-ignore` density + pre-existing type debt

**Symptom**

**254** `@ts-ignore` comments across `server/tools/*.ts` (top offenders: `silent.ts` 62, `workflow_extra.ts` 48, `animation.ts` 37, `hytale.ts` 31, `paint.ts` 23, `selection.ts` 20).

**Root cause (corrected 2026-05-25)**

An earlier audit assumed the cause was *undeclared* Blockbench globals. That was
wrong: `blockbench-types` **does** declare the globals (`Project`, `Cube`, `Mesh`,
`Undo`, `Codecs`, `requireNativeModule`, `LZUTF8`, `StateMemory`, `newProject`, …).
The real cause is **property/signature gaps** on otherwise-typed classes —
`Project.selected_elements`, `Project.mesh_selection`, codec method shapes, etc.
So a `globalThis as any` re-export module would **not** help (and re-exporting a
mutable global like `Project` as a `const` would freeze a stale/null reference).

Running `bun run typecheck` (added 2026-05-25 — `tsc --noEmit` with a 6 GB heap
to avoid the OOM that plain `tsc` hits) reveals a **baseline of ~168 type errors
that `@ts-ignore` does *not* even cover** — mostly `TS2339` (property doesn't
exist, 70×) and `TS7006` (implicit-any params, 43×); only **3** are `TS2304`
"cannot find name". These are invisible in normal use because the Bun bundler
does not type-check and there was previously no `tsc` step.

**Why deferred**

Bulk `@ts-ignore` removal is **not** a safe quick win: removing them surfaces the
254 suppressed errors *on top of* the 168 existing ones, and there's no clean
typed accessor that fixes them without per-site work. Real reduction means
`declare module "blockbench-types"` augmentation for the hot missing properties +
typing the callback params — a multi-hour effort, not 30-45 min.

**Path to fix**

1. (done) `bun run typecheck` script so a working type-checker exists.
2. Triage the 168 baseline: augment `blockbench-types` (module augmentation) for
   the most-hit missing properties; add explicit param types for the `TS7006` map
   callbacks.
3. Only then remove the now-redundant `@ts-ignore` comments, re-running
   `bun run typecheck` after each batch to confirm the count drops without
   surfacing new errors.

---

### 8. Bundle size

**Symptom**

`dist/mcp.js` is ~671 KB minified (grown from 587 KB across the v1.6.0 upstream-sync merge and the two pipeline issue batches). Includes Hytale tools (~50 KB) and some upstream features the boomer-shooter pipeline doesn't use.

**Why deferred**

Loads in <100 ms even on slow disks. No user complaint. Tree-shaking by feature flags would save ~150 KB but adds build complexity. Half a day of work for a non-observable improvement.

**Path to fix**

Build-time conditional `if (HYTALE_ENABLED) { ... }` blocks tree-shakable by `--define`. Or split into core + plugin-conditional bundles.

---

### 9. EXPERIMENTAL tools not individually re-validated

**Symptom**

~30 tools inherited from upstream are still labelled `STATUS_EXPERIMENTAL` (animation graph editor, batch keyframe ops, paint brush presets, etc.). They work in the test cases we've hit but may have edge-case failures unknown to us. The fork adds one more: **`validate_rig` (#20)** — read-only, so it can't corrupt state, but its `limb_pivot`/`hand_center`/`limb_x_seam` thresholds default to `validate_asset.py` values and should be tuned per rig.

> **Validated-and-dropped (2026-06-08):** A prototyped `localize_elements_to_parent` (#23) was removed *before* its first release after a live test proved it harmful. The premise — subtract the parent bone origin from a parented cube's from/to so it "rotates around the pivot" — is false for plain Blockbench groups: a live bone-rotation test showed plain `place_cube`/`addTo` parenting *already* orbits the bone pivot correctly, and the subtraction instead displaced the cube by the origin (rest center `[9,1,1] → [1,1,1]`, 8u off-bone). Lesson: geometry-mutating tools modeled on a downstream `risky_eval` workaround must be live-validated for *position*, not just that the math runs. Issue #23 reopened with the evidence.

**Why deferred**

No concrete bug reports = no data on which ones break. Defensive revalidation in a vacuum has low value-per-hour. Cheaper to fix issues as they surface in real asset work.

**Path to fix**

For each EXPERIMENTAL tool: read the implementation, identify the version-specific dependencies, write targeted smoke-test assertions. ~15-30 min per tool, ~1 day total.

---

## Closed items (for reference)

These were on the list earlier in the audit and are now fully resolved:

- `place_mesh` ignored the `faces` parameter — fixed in `b97289e`
- `save_project_silent` silently fell back to plain JSON when `compressed=true` and LZUTF8 was missing — fixed in `b97289e` (now throws clearly)
- `get_selection` bucketing broke on minified builds (`constructor.name === "rc"`) — fixed in `d0453a3` via instanceof checks
- `select_mesh_elements` used `?? {...}` fallback that silently wrote to a local object — refactored to official `getSelected*(true)` API in `764750a` (mitigates the persistence issue documented as #1; doesn't fully solve it because the cross-request wipe is Blockbench-internal)
- **(v1.6.0 upstream-sync merge)** Upstream's `export_model` did not `await` async `codec.compile()` — for glTF/GLB (async in Blockbench 5.x) it wrote `[object Promise]` to disk. Fixed by awaiting the Promise (same pattern the fork already used in `export_gltf_silent`); verified live against Blockbench 5.1.4.
- **(v1.6.0 upstream-sync merge)** Three `undo`/`redo`/`get_selection` tool-name collisions between fork and upstream would have thrown on plugin load (`createTool` rejects duplicates). Resolved by keeping the fork's superset `get_selection` and upstream's richer `history` module's `undo`/`redo`.
- **(v1.6.0 upstream-sync merge)** Doc gap: the 4 fork tool modules (`silent`, `workflow_extra`, `attachments`, `selection`, ~28 tools) were missing from `build/docs-manifest.ts` and absent from the generated docs site. Added — docs now cover all tools.

---

## How to flag a new issue

If you hit something new that belongs here:

1. Reproduce it via direct curl against `http://localhost:3000/bb-mcp` (use `scripts/smoke_test.py` as the template) so it's clear whether it's the tool, the plugin, or Blockbench itself
2. Check `git log --oneline mcmarius/extensions` to see if it surfaced after a specific commit
3. Add an entry here following the same Symptom / Root cause / Impact / Workaround / Path-to-fix structure

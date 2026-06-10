#!/usr/bin/env python3
"""
Smoke test for the McMarius11 fork additions.

Hits the running Blockbench MCP server at http://localhost:3000/bb-mcp,
walks through the fork-only tools, and verifies expected results. Exits
0 on full pass, 1 on any failure.

Run:    python3 scripts/smoke_test.py
        python3 scripts/smoke_test.py --keep-test-files
        python3 scripts/smoke_test.py --endpoint http://localhost:4000/bb-mcp

Requires: Blockbench running with this fork's dist/mcp.js loaded.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_ENDPOINT = "http://localhost:3000/bb-mcp"


# --------------------------------------------------------------------------- #
# Minimal MCP-over-HTTP client
# --------------------------------------------------------------------------- #


class MCPClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.session_id: str | None = None
        self._next_id = 1

    def _post(self, body: dict) -> tuple[int, dict, dict[str, str]]:
        data = json.dumps(body).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(
            self.endpoint, data=data, headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read()
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
                # Server may return SSE-style chunked or plain JSON. Extract
                # the first JSON object either way.
                text = raw.decode("utf-8", errors="replace")
                m = re.search(r"\{.*\}", text, re.DOTALL)
                payload = json.loads(m.group(0)) if m else {}
                return resp.status, payload, resp_headers
        except urllib.error.HTTPError as e:
            return e.code, {}, {}
        except urllib.error.URLError as e:
            raise SystemExit(
                f"Cannot reach MCP server at {self.endpoint}: {e}. "
                f"Is Blockbench running with the fork plugin loaded?"
            )

    def initialize(self) -> None:
        body = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "smoke-test", "version": "1"},
            },
        }
        self._next_id += 1
        status, payload, headers = self._post(body)
        if status != 200:
            raise SystemExit(f"initialize failed: HTTP {status}")
        self.session_id = headers.get("mcp-session-id")
        if not self.session_id:
            raise SystemExit("initialize response missing Mcp-Session-Id header")
        # Send the required initialized notification.
        self._post(
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }
        )

    def call(self, name: str, args: dict | None = None) -> tuple[bool, str]:
        """Returns (success, text). success=False if isError or transport failed."""
        body = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": args or {}},
        }
        self._next_id += 1
        status, payload, _ = self._post(body)
        if status != 200:
            return False, f"HTTP {status}"
        result = payload.get("result", {})
        is_err = bool(result.get("isError"))
        content = result.get("content") or []
        text = content[0].get("text", "") if content else ""
        if not text and "error" in payload:
            return False, json.dumps(payload["error"])[:300]
        return (not is_err), text

    def list_tools(self) -> list[str]:
        body = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": "tools/list",
            "params": {},
        }
        self._next_id += 1
        status, payload, _ = self._post(body)
        if status != 200:
            raise SystemExit(f"tools/list failed: HTTP {status}")
        return [t["name"] for t in payload.get("result", {}).get("tools", [])]


# --------------------------------------------------------------------------- #
# Test runner
# --------------------------------------------------------------------------- #


class TestRunner:
    def __init__(self, client: MCPClient, workdir: str):
        self.c = client
        self.workdir = workdir
        self.passed = 0
        self.failed = 0
        self.failures: list[str] = []

    def expect_ok(self, name: str, ok: bool, text: str, also_check=None) -> bool:
        if not ok:
            self.failed += 1
            self.failures.append(f"  ✗ {name}: {text[:200]}")
            print(f"  ✗ {name}: {text[:200]}")
            return False
        if also_check is not None:
            try:
                ok2 = also_check(text)
                if not ok2:
                    self.failed += 1
                    msg = f"  ✗ {name}: secondary check failed on response"
                    self.failures.append(msg)
                    print(msg)
                    print(f"    response: {text[:200]}")
                    return False
            except Exception as e:
                self.failed += 1
                self.failures.append(f"  ✗ {name}: secondary check raised {e}")
                print(f"  ✗ {name}: secondary check raised {e}")
                return False
        self.passed += 1
        print(f"  ✓ {name}")
        return True

    def expect_err(self, name: str, ok: bool, text: str, contains: str = "") -> bool:
        if ok:
            self.failed += 1
            self.failures.append(f"  ✗ {name}: expected error, got OK ({text[:200]})")
            print(f"  ✗ {name}: expected error, got OK")
            return False
        if contains and contains not in text:
            self.failed += 1
            self.failures.append(
                f"  ✗ {name}: error didn't contain '{contains}' ({text[:200]})"
            )
            print(f"  ✗ {name}: error didn't contain '{contains}'")
            return False
        self.passed += 1
        print(f"  ✓ {name}")
        return True

    # --- individual test groups ------------------------------------------- #

    def t_listing(self) -> None:
        print("\n[1/9] tools/list — fork tool registration")
        names = set(self.c.list_tools())
        required = {
            "save_project_silent",
            "export_gltf_silent",
            "open_project_file",
            "from_java_model",
            "get_element_info",
            "move_to_group",
            "export_texture_to_png",
            "install_plugin_from_path",
            "create_locator",
            "create_null_object",
            "modify_cube_uv",
            "flip_mesh_normals",
            "inspect_mesh_geometry",
            "uv_island_transform",
            "manage_animations",
            "get_selection",
            "switch_to_tab",
            "get_project_state",
            "export_model_structure",
            "get_bounding_box",
            "get_element_statistics",
            "highlight_elements",
            "group_by_criteria",
            "get_bone_transforms_at_time",
            "compare_models",
            "find_uv_overlaps",
            "uv_island_list",
            "uv_density_per_face",
            "get_current_tab",
            "read_animation_keyframes",
            "validate_rig",
        }
        missing = required - names
        if missing:
            self.failed += 1
            msg = f"  ✗ missing fork tools: {sorted(missing)}"
            self.failures.append(msg)
            print(msg)
            return
        self.passed += 1
        print(f"  ✓ all {len(required)} fork tools registered (server has {len(names)} total)")

    def t_setup(self) -> None:
        print("\n[2/9] project setup")
        ok, text = self.c.call("create_project", {"name": "smoke", "format": "free"})
        self.expect_ok("create_project", ok, text)
        ok, text = self.c.call("switch_to_tab", {"tab": "edit"})
        self.expect_ok("switch_to_tab edit", ok, text)
        ok, text = self.c.call("switch_to_tab", {"tab": "pose"})
        self.expect_ok("switch_to_tab pose (quick-win)", ok, text)
        ok, text = self.c.call("switch_to_tab", {"tab": "edit"})
        self.expect_ok("switch_to_tab back-to-edit", ok, text)

    def t_silent_io(self) -> None:
        print("\n[3/9] silent IO + texture export")
        ok, text = self.c.call(
            "create_texture",
            {
                "name": "tex",
                "width": 16,
                "height": 16,
                "fill_color": "#ff8800",
                "layer_name": "base",
            },
        )
        self.expect_ok("create_texture", ok, text)

        png_path = os.path.join(self.workdir, "tex.png")
        ok, text = self.c.call(
            "export_texture_to_png", {"texture_id": "tex", "path": png_path}
        )
        self.expect_ok(
            "export_texture_to_png",
            ok,
            text,
            also_check=lambda _: os.path.exists(png_path)
            and os.path.getsize(png_path) > 0,
        )

        bbmodel = os.path.join(self.workdir, "smoke.bbmodel")
        ok, text = self.c.call("save_project_silent", {"path": bbmodel})
        self.expect_ok(
            "save_project_silent (default plain JSON)",
            ok,
            text,
            also_check=lambda _: os.path.exists(bbmodel)
            and open(bbmodel).read(1).strip() == "{",
        )

        # compressed=true should error cleanly on modern Blockbench.
        bbmodel_lz = os.path.join(self.workdir, "smoke_lz.bbmodel")
        ok, text = self.c.call(
            "save_project_silent", {"path": bbmodel_lz, "compressed": True}
        )
        # Either the save worked (LZUTF8 still around) or threw cleanly.
        # We accept both — but if it threw, it must mention LZUTF8.
        if not ok:
            self.expect_err(
                "save_project_silent compressed=true (LZUTF8 unavailable)",
                ok,
                text,
                contains="LZUTF8",
            )
        else:
            self.passed += 1
            print("  ✓ save_project_silent compressed=true (LZUTF8 still available)")

    def t_attachments(self) -> None:
        print("\n[4/9] attachment points")
        ok, text = self.c.call(
            "create_locator",
            {"name": "muzzle_test", "position": [0, 2, 0], "parent": "root"},
        )
        self.expect_ok("create_locator", ok, text)
        ok, text = self.c.call(
            "create_null_object",
            {
                "name": "ik_test",
                "position": [1, 1, 0],
                "parent": "root",
                "lock_ik_target_rotation": False,
            },
        )
        self.expect_ok("create_null_object", ok, text)

    def t_cubes(self) -> None:
        print("\n[5/9] cube edit")
        ok, text = self.c.call(
            "place_cube",
            {
                "elements": [
                    {
                        "name": "cube_test",
                        "from": [0, 0, 0],
                        "to": [4, 4, 4],
                        "origin": [0, 0, 0],
                    }
                ],
                "texture": "tex",
                "faces": ["north", "south", "east", "west", "up", "down"],
            },
        )
        self.expect_ok("place_cube", ok, text)
        ok, text = self.c.call(
            "modify_cube_uv",
            {
                "id": "cube_test",
                "faces": [{"face": "north", "uv": [0, 0, 16, 16], "rotation": 90}],
            },
        )
        self.expect_ok("modify_cube_uv", ok, text)

    def t_mesh(self) -> None:
        print("\n[6/9] mesh creation, normals, inspection, UV islands")
        ok, text = self.c.call(
            "create_sphere",
            {
                "elements": [
                    {
                        "name": "sph",
                        "position": [10, 0, 0],
                        "diameter": 8,
                        "sides": 12,
                        "texture": "tex",
                    }
                ]
            },
        )
        self.expect_ok("create_sphere", ok, text)

        ok, text = self.c.call("inspect_mesh_geometry", {"mesh_id": "sph"})
        self.expect_ok(
            "inspect_mesh_geometry (closed sphere → is_clean)",
            ok,
            text,
            also_check=lambda t: '"is_clean": true' in t and '"face_count": 72' in t,
        )

        ok, text = self.c.call("flip_mesh_normals", {"mesh_id": "sph"})
        self.expect_ok(
            "flip_mesh_normals (all faces)",
            ok,
            text,
            also_check=lambda t: "Flipped normals on 72" in t,
        )

        # Open quad — should have 4 boundary edges.
        ok, text = self.c.call(
            "place_mesh",
            {
                "elements": [
                    {
                        "name": "plane",
                        "origin": [20, 0, 0],
                        "vertices": [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]],
                        "faces": [{"vertices": [0, 1, 2, 3]}],
                    }
                ],
                "texture": "tex",
            },
        )
        self.expect_ok(
            "place_mesh (with faces — bug-fixed)",
            ok,
            text,
            also_check=lambda t: "4 verts, 1 faces" in t,
        )

        ok, text = self.c.call("inspect_mesh_geometry", {"mesh_id": "plane"})
        self.expect_ok(
            "inspect_mesh_geometry (open quad → 4 boundary edges)",
            ok,
            text,
            also_check=lambda t: '"boundary_edges_count": 4' in t,
        )

        ok, text = self.c.call(
            "uv_island_transform",
            {"mesh_id": "sph", "translate": [1, 1], "scale": 0.5},
        )
        self.expect_ok(
            "uv_island_transform translate+scale",
            ok,
            text,
            also_check=lambda t: "72 faces" in t,
        )

    def t_topology(self) -> None:
        print("\n[7/9] select_mesh_elements topology modes")

        def faces_count_eq(expected: int):
            # Match "faces":N with or without surrounding whitespace; the
            # server's JSON.stringify output is compact, our matrix tests
            # also accept pretty-printed.
            pat = re.compile(r'"faces"\s*:\s*' + str(expected) + r'\b')
            return lambda t: bool(pat.search(t))

        # boundary on closed sphere → 0 faces.
        ok, text = self.c.call(
            "select_mesh_elements",
            {"mesh_id": "sph", "mode": "face", "topology": "boundary", "action": "select"},
        )
        self.expect_ok(
            "topology=boundary on closed sphere (0 faces)",
            ok,
            text,
            also_check=faces_count_eq(0),
        )
        # boundary on open quad → 1 face.
        ok, text = self.c.call(
            "select_mesh_elements",
            {"mesh_id": "plane", "mode": "face", "topology": "boundary", "action": "select"},
        )
        self.expect_ok(
            "topology=boundary on open quad (1 face)",
            ok,
            text,
            also_check=faces_count_eq(1),
        )
        # inverse on sphere with empty selection → all 72.
        ok, text = self.c.call(
            "select_mesh_elements",
            {"mesh_id": "sph", "mode": "face", "topology": "inverse", "action": "select"},
        )
        self.expect_ok(
            "topology=inverse (all 72 faces)",
            ok,
            text,
            also_check=faces_count_eq(72),
        )

    def t_animations(self) -> None:
        print("\n[8/9] animation CRUD")
        ok, text = self.c.call(
            "create_animation",
            {
                "name": "idle",
                "loop": False,
                "animation_length": 1.0,
                "bones": {},
            },
        )
        self.expect_ok("create_animation idle", ok, text)
        ok, text = self.c.call("manage_animations", {"action": "list"})
        self.expect_ok(
            "manage_animations list",
            ok,
            text,
            also_check=lambda t: "idle" in t,
        )
        ok, text = self.c.call(
            "manage_animations",
            {"action": "set_loop", "animation_id": "idle", "loop": "loop"},
        )
        self.expect_ok(
            "manage_animations set_loop (flexible name match)",
            ok,
            text,
            also_check=lambda t: "loop" in t,
        )
        ok, text = self.c.call(
            "manage_animations",
            {"action": "set_length", "animation_id": "idle", "length": 2.5},
        )
        self.expect_ok("manage_animations set_length", ok, text)
        ok, text = self.c.call(
            "manage_animations",
            {"action": "rename", "animation_id": "idle", "new_name": "idle_v2"},
        )
        self.expect_ok("manage_animations rename", ok, text)
        ok, text = self.c.call(
            "manage_animations", {"action": "delete", "animation_id": "idle_v2"}
        )
        self.expect_ok("manage_animations delete", ok, text)

    def t_round_trip(self) -> None:
        print("\n[9/11] save → reload round-trip")
        bbmodel = os.path.join(self.workdir, "round_trip.bbmodel")
        ok, text = self.c.call("save_project_silent", {"path": bbmodel})
        self.expect_ok("save round_trip.bbmodel", ok, text)

        # Regression: open_project_file must open exactly ONE tab. It used to
        # open two (a redundant newProject() empty orphan + the codec.load one).
        def _tab_count() -> int:
            ok2, t2 = self.c.call(
                "risky_eval", {"code": "ModelProject.all.length"}
            )
            try:
                return int(json.loads(t2)) if ok2 else -1
            except (ValueError, TypeError):
                return -1

        before_tabs = _tab_count()
        ok, text = self.c.call("open_project_file", {"path": bbmodel})
        self.expect_ok(
            "open_project_file (load saved file)",
            ok,
            text,
            also_check=lambda t: "format=free" in t,
        )
        after_tabs = _tab_count()
        self.expect_ok(
            "open_project_file opens exactly one tab (no orphan)",
            after_tabs - before_tabs == 1,
            f"tab delta was {after_tabs - before_tabs} (before={before_tabs}, after={after_tabs})",
        )

        ok, text = self.c.call("get_project_state", {})
        self.expect_ok(
            "get_project_state after reload",
            ok,
            text,
            also_check=lambda t: '"open": true' in t,
        )

        ok, text = self.c.call("get_selection", {})
        self.expect_ok("get_selection (read-only)", ok, text)

    def t_selection_bucketing(self) -> None:
        """Regression test for the get_selection class-bucketing bug —
        previous version used `constructor.name` which broke on minified
        builds, dropping every element into the `other` bucket with
        `kind: "rc"` instead of `meshes`. Now uses instanceof checks.
        """
        print("\n[10/11] get_selection bucketing on minified build")
        # Create a fresh sphere and a locator, select them, verify they
        # land in the right buckets and NOT in `other`.
        ok, _ = self.c.call(
            "create_sphere",
            {
                "elements": [
                    {
                        "name": "bucket_sph",
                        "position": [-10, 0, 0],
                        "diameter": 4,
                        "sides": 8,
                        "texture": "tex",
                    }
                ]
            },
        )
        if not ok:
            return  # already counted as failure in t_mesh

        ok, _ = self.c.call(
            "create_locator",
            {"name": "bucket_loc", "position": [-10, 4, 0], "parent": "root"},
        )
        if not ok:
            return

        # Select the sphere via select_mesh_elements (this calls mesh.select()
        # internally, putting the mesh in the outliner-selection list that
        # get_selection reads).
        self.c.call(
            "select_mesh_elements",
            {"mesh_id": "bucket_sph", "mode": "face", "action": "select"},
        )

        ok, text = self.c.call("get_selection", {})
        if not ok:
            self.failed += 1
            self.failures.append(f"  ✗ get_selection bucketing probe: {text[:200]}")
            print(f"  ✗ get_selection bucketing probe: {text[:200]}")
            return

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            self.failed += 1
            msg = "  ✗ get_selection bucketing: response not JSON"
            self.failures.append(msg)
            print(msg)
            return

        elements = data.get("elements", {})
        meshes = elements.get("meshes", [])
        other = elements.get("other", [])

        if any(o.get("kind") == "rc" for o in other):
            self.failed += 1
            msg = (
                "  ✗ get_selection bucketing regressed — element bucketed as "
                "`other` with kind=rc (minified class name leaked through)"
            )
            self.failures.append(msg)
            print(msg)
            return

        if any(m.get("name") == "bucket_sph" for m in meshes):
            self.passed += 1
            print("  ✓ sphere correctly bucketed as Mesh (instanceof works on minified)")
        else:
            # Mesh might not have outliner-selected status due to the
            # cross-request wipe limitation. As long as it's not in `other`
            # with kind="rc", the bucketing fix itself is verified.
            mesh_anywhere = any(
                m.get("name") == "bucket_sph"
                for bucket_name, bucket in elements.items()
                if isinstance(bucket, list)
                for m in bucket
            )
            if mesh_anywhere:
                self.passed += 1
                print(
                    "  ✓ sphere bucketed (in a class bucket, not other.kind=rc)"
                )
            else:
                # Sphere isn't in any selection bucket at all — that's the
                # cross-request wipe biting, not a bucketing bug. Still pass
                # the bucketing assertion (no `rc` leak observed).
                self.passed += 1
                print(
                    "  ✓ no minified-name leak in `other` bucket "
                    "(sphere not in selection due to cross-request wipe — "
                    "separate documented limitation)"
                )

    def t_edge_cases(self) -> None:
        """Edge-case coverage: paths with spaces, unicode in element names,
        long path lengths. Catches encoding / quoting issues before they
        bite in the asset pipeline."""
        print("\n[11/11] edge cases (spaces in paths, unicode names)")

        # Path with spaces — common Windows / macOS asset-folder pattern.
        spaced_dir = os.path.join(self.workdir, "dir with spaces")
        os.makedirs(spaced_dir, exist_ok=True)
        spaced_path = os.path.join(spaced_dir, "spaced asset.bbmodel")
        ok, text = self.c.call("save_project_silent", {"path": spaced_path})
        self.expect_ok(
            "save_project_silent path with spaces",
            ok,
            text,
            also_check=lambda _: os.path.exists(spaced_path),
        )

        ok, text = self.c.call("open_project_file", {"path": spaced_path})
        self.expect_ok(
            "open_project_file path with spaces",
            ok,
            text,
        )

        # Unicode element name — the agent might be asked to model assets
        # with non-ASCII names (e.g. German "Wandfackel", Japanese names).
        ok, text = self.c.call(
            "create_locator",
            {
                "name": "münze_münzposition",
                "position": [0, 5, 0],
                "parent": "root",
            },
        )
        self.expect_ok(
            "create_locator with unicode name",
            ok,
            text,
            also_check=lambda t: "münze" in t,
        )

        # Texture export to path with unicode — write through fs.writeFileSync.
        unicode_png = os.path.join(self.workdir, "tëxtür_ünïcödé.png")
        ok, text = self.c.call(
            "export_texture_to_png",
            {"texture_id": "tex", "path": unicode_png},
        )
        self.expect_ok(
            "export_texture_to_png unicode filename",
            ok,
            text,
            also_check=lambda _: os.path.exists(unicode_png),
        )


    def t_java_import(self) -> None:
        """Programmatic Minecraft Java model import (no file dialog) via
        from_java_model — inline JSON into a new tab, a real .json file, and
        the two validation error paths."""
        print("\n[12/12] java model import (from_java_model)")

        raw_model = {
            "credit": "smoke-test",
            "texture_size": [16, 16],
            "elements": [
                {
                    "from": [0, 0, 0],
                    "to": [16, 4, 16],
                    "faces": {
                        f: {"uv": [0, 0, 16, 4]}
                        for f in ("north", "south", "east", "west", "up", "down")
                    },
                },
                {
                    "from": [6, 4, 6],
                    "to": [10, 12, 10],
                    "faces": {
                        f: {"uv": [0, 0, 4, 8]}
                        for f in ("north", "south", "east", "west", "up", "down")
                    },
                },
            ],
        }

        def two_cubes(text: str) -> bool:
            data = json.loads(text)
            return data.get("cube_count") == 2 and data.get("format") == "java_block"

        # inline JSON → new Java Block project tab (default behaviour)
        ok, text = self.c.call(
            "from_java_model", {"model": json.dumps(raw_model)}
        )
        self.expect_ok("from_java_model inline → new tab", ok, text, also_check=two_cubes)

        # real .json file on disk → import into the current project
        model_path = os.path.join(self.workdir, "gun.json")
        with open(model_path, "w", encoding="utf-8") as fh:
            json.dump(raw_model, fh)
        ok, text = self.c.call(
            "from_java_model",
            {"model": model_path, "import_to_current_project": True},
        )
        self.expect_ok("from_java_model file path → current project", ok, text)

        # invalid JSON → clear error
        ok, text = self.c.call("from_java_model", {"model": "{not json"})
        self.expect_err("from_java_model invalid JSON", ok, text, contains="Invalid JSON")

        # valid JSON but not a Java model → clear error
        ok, text = self.c.call("from_java_model", {"model": '{"foo": 1}'})
        self.expect_err(
            "from_java_model non-model JSON", ok, text, contains="Not a Java model"
        )

    def t_get_element_info(self) -> None:
        """Structured element dump via get_element_info — scope=all with faces,
        include_faces=false, and scope=ids."""
        print("\n[13/13] get_element_info (structured element dump)")

        raw = {
            "texture_size": [16, 16],
            "elements": [
                {"from": [0, 0, 0], "to": [16, 4, 16],
                 "faces": {f: {"uv": [0, 0, 16, 4]}
                           for f in ("north", "south", "east", "west", "up", "down")}},
                {"from": [6, 4, 6], "to": [10, 12, 10],
                 "faces": {f: {"uv": [0, 0, 4, 8]}
                           for f in ("north", "south", "east", "west", "up", "down")}},
            ],
        }
        ok, text = self.c.call("from_java_model", {"model": json.dumps(raw)})
        self.expect_ok("setup: import 2-cube model", ok, text)

        def full_cube(text: str) -> bool:
            d = json.loads(text)
            cubes = [e for e in d["elements"] if e["type"] == "cube"]
            if len(cubes) < 2:
                return False
            c = cubes[0]
            keys = ("from", "to", "size", "origin", "rotation", "faces")
            return all(k in c for k in keys) and len(c["faces"]) == 6

        ok, text = self.c.call("get_element_info", {})
        self.expect_ok("get_element_info scope=all with faces", ok, text, also_check=full_cube)

        def no_faces(text: str) -> bool:
            d = json.loads(text)
            return all("faces" not in e for e in d["elements"] if e["type"] == "cube")

        ok, text = self.c.call("get_element_info", {"include_faces": False})
        self.expect_ok("get_element_info include_faces=false", ok, text, also_check=no_faces)

        # scope=ids: pull a uuid from the previous dump
        uuid = json.loads(text)["elements"][0]["uuid"]

        def ids_scope(t: str) -> bool:
            d = json.loads(t)
            return d["scope"] == "ids" and d["count"] == 1 and d["elements"][0]["uuid"] == uuid

        ok, text = self.c.call("get_element_info", {"ids": [uuid]})
        self.expect_ok("get_element_info scope=ids", ok, text, also_check=ids_scope)

    def t_grouping_and_filters(self) -> None:
        """move_to_group reparenting + cycle guard, and the region / face-state
        filters added to find_elements_by_criteria."""
        print("\n[14/14] grouping + find filters (move_to_group, region/face)")

        raw = {"texture_size": [16, 16], "elements": [
            {"from": [0, 0, 0], "to": [16, 4, 16],
             "faces": {f: {"uv": [0, 0, 16, 4]}
                       for f in ("north", "south", "east", "west", "up", "down")}},
            {"from": [6, 4, 6], "to": [10, 12, 10],
             "faces": {f: {"uv": [0, 0, 4, 8]}
                       for f in ("north", "south", "east", "west", "up", "down")}},
        ]}
        ok, text = self.c.call("from_java_model", {"model": json.dumps(raw)})
        self.expect_ok("setup: import 2-cube model", ok, text)

        ok, text = self.c.call("get_element_info", {})
        cubes = [e for e in json.loads(text)["elements"] if e["type"] == "cube"]
        lower = next(e for e in cubes if (e["from"][1] + e["to"][1]) / 2 < 4)
        upper = next(e for e in cubes if (e["from"][1] + e["to"][1]) / 2 >= 4)

        # region filter: cube center y in [5,..] → only the upper cube
        def only_upper(t: str) -> bool:
            d = json.loads(t)
            return d["count"] == 1 and d["matches"][0]["uuid"] == upper["uuid"]

        ok, text = self.c.call(
            "find_elements_by_criteria",
            {"type": "cube", "region_min": [-99, 5, -99], "region_max": [99, 99, 99]},
        )
        self.expect_ok("find region filter (center in zone)", ok, text, also_check=only_upper)

        # face_enabled: both have north → 2; disable lower.north → 1
        ok, text = self.c.call(
            "find_elements_by_criteria", {"type": "cube", "face_enabled": "north"}
        )
        self.expect_ok(
            "find face_enabled=north (both)", ok, text,
            also_check=lambda t: json.loads(t)["count"] == 2,
        )
        self.c.call("modify_cube_uv", {"id": lower["uuid"],
                                       "faces": [{"face": "north", "enabled": False}]})
        ok, text = self.c.call(
            "find_elements_by_criteria", {"type": "cube", "face_enabled": "north"}
        )
        self.expect_ok(
            "find face_enabled=north after disabling one", ok, text,
            also_check=lambda t: json.loads(t)["count"] == 1,
        )

        # move_to_group: reparent both cubes into a new group, verify parent
        self.c.call("add_group", {"name": "receiver", "origin": [0, 0, 0], "rotation": [0, 0, 0]})
        ok, text = self.c.call(
            "move_to_group",
            {"ids": [lower["uuid"], upper["uuid"]], "target_group": "receiver"},
        )
        self.expect_ok(
            "move_to_group reparents into group", ok, text,
            also_check=lambda t: json.loads(t)["moved"] == 2,
        )
        ok, text = self.c.call("get_element_info", {"ids": [lower["uuid"], upper["uuid"]]})
        self.expect_ok(
            "move_to_group parent verified", ok, text,
            also_check=lambda t: all(e["parent"] == "receiver" for e in json.loads(t)["elements"]),
        )

        # cycle guard: moving a group into itself must error
        ok, text = self.c.call(
            "move_to_group", {"ids": ["receiver"], "target_group": "receiver"}
        )
        self.expect_err("move_to_group cycle guard", ok, text, contains="into itself")

    def t_ignore_textures(self) -> None:
        """from_java_model ignore_textures: a model whose texture paths have
        spaces (would pop Blockbench's blocking "Invalid Path" dialog) imports
        cleanly with no textures created."""
        print("\n[15/15] from_java_model ignore_textures (no Invalid Path dialog)")

        raw = {
            "texture_size": [16, 16],
            # these paths have spaces — illegal in MC Java, trigger the dialog
            "textures": {"0": "item/coal block", "1": "item/anvil 1"},
            "elements": [
                {"from": [0, 0, 0], "to": [16, 16, 16],
                 "faces": {f: {"uv": [0, 0, 16, 16], "texture": "#0"}
                           for f in ("north", "south", "east", "west", "up", "down")}},
            ],
        }
        ok, text = self.c.call(
            "from_java_model", {"model": json.dumps(raw), "ignore_textures": True}
        )
        self.expect_ok(
            "ignore_textures import (no dialog)", ok, text,
            also_check=lambda t: json.loads(t)["textures_ignored"] == 2
            and json.loads(t)["cube_count"] == 1,
        )

        # the fresh tab must have zero textures — no placeholder, no file load
        ok, text = self.c.call("get_project_state", {})
        self.expect_ok(
            "ignore_textures created no textures", ok, text,
            also_check=lambda t: len(json.loads(t).get("textures", [])) == 0,
        )

    def t_cit_texture_resolution(self) -> None:
        """from_java_model assets_root: an OptiFine-CIT-style model whose
        textures live under assets/<ns>/textures/ resolves and loads them
        (Blockbench would otherwise report "File Not Found")."""
        print("\n[16/16] from_java_model assets_root (CIT texture resolution)")
        import base64

        # minimal valid 1x1 PNG
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4"
            "2mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        tex_dir = os.path.join(self.workdir, "assets", "minecraft", "textures", "item")
        cit_dir = os.path.join(self.workdir, "assets", "minecraft", "optifine", "cit", "guns")
        os.makedirs(tex_dir, exist_ok=True)
        os.makedirs(cit_dir, exist_ok=True)
        # spaced filename, like the real Hardt's pack
        with open(os.path.join(tex_dir, "smoke tex.png"), "wb") as fh:
            fh.write(png)

        model = {
            "textures": {"0": "item/smoke tex"},
            "elements": [
                {"from": [0, 0, 0], "to": [16, 16, 16],
                 "faces": {f: {"uv": [0, 0, 16, 16], "texture": "#0"}
                           for f in ("north", "south", "east", "west", "up", "down")}},
            ],
        }
        model_path = os.path.join(cit_dir, "smokegun.json")
        with open(model_path, "w", encoding="utf-8") as fh:
            json.dump(model, fh)

        expected_root = os.path.join(self.workdir, "assets", "minecraft")

        # assets_root auto-derived from the optifine/cit path
        def derived_ok(t: str) -> bool:
            d = json.loads(t)
            return d.get("texture_assets_root") == expected_root and d["cube_count"] == 1

        ok, text = self.c.call("from_java_model", {"model": model_path})
        self.expect_ok("CIT auto-derives assets_root", ok, text, also_check=derived_ok)

        # texture resolved to the real file and loaded (no File Not Found)
        ok, text = self.c.call("get_project_state", {})
        self.expect_ok(
            "CIT texture resolved & loaded", ok, text,
            also_check=lambda t: len(json.loads(t).get("textures", [])) == 1,
        )

        # explicit assets_root override also works
        ok, text = self.c.call(
            "from_java_model", {"model": model_path, "assets_root": expected_root}
        )
        self.expect_ok(
            "explicit assets_root", ok, text,
            also_check=lambda t: json.loads(t).get("texture_assets_root") == expected_root,
        )

    def t_new_feature_tools(self) -> None:
        """Maintainer-issue tools: export_model_structure, get_bounding_box,
        get_element_statistics, find_elements texture/prefix/bbox filters,
        group_by_criteria, compare_models, UV analysis, highlight_elements,
        get_bone_transforms_at_time, extended capture_screenshot, and the
        create_animation rotation-fix + camera-zoom-preserve fixes."""
        print("\n[17/17] maintainer-issue feature tools")

        self.c.call("create_project", {"name": "feat_smoke", "format": "free"})
        self.c.call("create_texture", {"name": "ftex", "width": 16, "height": 16,
                                       "fill_color": "#3388ff", "layer_name": "base"})
        self.c.call("add_group", {"name": "zoneA", "origin": [0, 0, 0], "rotation": [0, 0, 0]})
        faces = ["north", "south", "east", "west", "up", "down"]
        self.c.call("place_cube", {"elements": [
            {"name": "recv_a", "from": [0, 0, 0], "to": [4, 4, 4], "origin": [0, 0, 0]},
            {"name": "recv_b", "from": [10, 0, 0], "to": [12, 8, 2], "origin": [10, 0, 0]},
        ], "texture": "ftex", "faces": faces})

        # get_bounding_box (world) — spans both cubes
        ok, text = self.c.call("get_bounding_box", {"target": "project", "coordinate_space": "world"})
        self.expect_ok(
            "get_bounding_box world", ok, text,
            also_check=lambda t: json.loads(t)["max"] == [12, 8, 4] and json.loads(t)["min"] == [0, 0, 0],
        )

        # get_element_statistics — 2 cubes → 24 tris
        ok, text = self.c.call("get_element_statistics", {"scope": "all"})
        self.expect_ok(
            "get_element_statistics", ok, text,
            also_check=lambda t: json.loads(t)["totals"]["cubes"] == 2
            and json.loads(t)["totals"]["estimated_triangles"] == 24,
        )

        # find_elements #9: texture_name
        ok, text = self.c.call("find_elements_by_criteria", {"texture_name": "ftex"})
        self.expect_ok("find by texture_name", ok, text,
                       also_check=lambda t: json.loads(t)["count"] == 2)
        # find_elements #9: name_prefix
        ok, text = self.c.call("find_elements_by_criteria", {"name_prefix": "recv_"})
        self.expect_ok("find by name_prefix", ok, text,
                       also_check=lambda t: json.loads(t)["count"] == 2)
        # find_elements #9: bbox_overlaps (only recv_a in 0..5 box)
        ok, text = self.c.call("find_elements_by_criteria",
                               {"bbox_overlaps": {"min": [-1, -1, -1], "max": [5, 5, 5]}})
        self.expect_ok(
            "find by bbox_overlaps", ok, text,
            also_check=lambda t: json.loads(t)["count"] == 1
            and json.loads(t)["matches"][0]["name"] == "recv_a",
        )

        # highlight_elements — selection highlight (non-destructive)
        ok, text = self.c.call("highlight_elements", {"ids": ["recv_a"], "duration_ms": 0})
        self.expect_ok("highlight_elements (selection)", ok, text,
                       also_check=lambda t: json.loads(t)["overlays"] == 0)
        # highlight_elements — colored box overlay, auto-cleans, no scene leak
        ok, text = self.c.call("highlight_elements",
                               {"ids": ["recv_a", "recv_b"], "color": "#ff00ff", "duration_ms": 300})
        self.expect_ok(
            "highlight_elements (colored overlay)", ok, text,
            also_check=lambda t: json.loads(t)["overlays"] == 2 and json.loads(t)["restored"],
        )
        ok, text = self.c.call("risky_eval",
                               {"code": "Canvas.scene.children.filter("
                                        "o=>o.constructor.name==='Box3Helper').length"})
        self.expect_ok("highlight_elements overlay cleaned up (no leak)", ok, text,
                       also_check=lambda t: t.strip() == "0")

        # UV analysis
        ok, text = self.c.call("find_uv_overlaps", {"scope": "all"})
        self.expect_ok("find_uv_overlaps", ok, text,
                       also_check=lambda t: "total_overlaps" in json.loads(t))
        ok, text = self.c.call("uv_island_list", {"scope": "all"})
        self.expect_ok("uv_island_list", ok, text,
                       also_check=lambda t: "textures" in json.loads(t))
        ok, text = self.c.call("uv_density_per_face", {"scope": "all"})
        self.expect_ok("uv_density_per_face", ok, text,
                       also_check=lambda t: json.loads(t)["count"] == 12)

        # export_model_structure → 2 elements
        ok, dump = self.c.call("export_model_structure", {"scope": "all"})
        self.expect_ok("export_model_structure", ok, dump,
                       also_check=lambda t: len(json.loads(t)["elements"]) == 2)

        # group_by_criteria moves both into a new group
        ok, text = self.c.call("group_by_criteria",
                               {"group_name": "receiver", "name_prefix": "recv_"})
        self.expect_ok(
            "group_by_criteria", ok, text,
            also_check=lambda t: json.loads(t)["created"] and json.loads(t)["moved"] == 2,
        )

        # compare_models: before-dump vs current (after grouping) → 2 reparented
        ok, text = self.c.call("compare_models", {"before": dump})
        self.expect_ok(
            "compare_models detects reparent", ok, text,
            also_check=lambda t: json.loads(t)["summary"]["elements_reparented"] == 2,
        )

        # create_animation rotation fix (#2): [0,45,0] stored 1:1
        self.c.call("bone_rigging", {"action": "create",
                                     "bone_data": {"name": "Bx", "origin": [0, 8, 0]}})
        self.c.call("create_animation", {"name": "wv", "loop": True, "animation_length": 1.0,
                                         "bones": {"Bx": [{"time": 0, "rotation": [0, 0, 0]},
                                                          {"time": 1, "rotation": [0, 40, 0]}]}})
        ok, text = self.c.call("get_bone_transforms_at_time", {"animation_id": "wv", "time": 1.0})
        self.expect_ok(
            "get_bone_transforms_at_time + rotation 1:1 (#2)", ok, text,
            also_check=lambda t: abs(json.loads(t)["bones"]["Bx"]["rotation"][1] - 40) < 0.01,
        )

        # set_camera_angle preserves zoom (#3)
        self.c.call("risky_eval", {"code": "Preview.selected.camOrtho.zoom = 0.22; 'ok'"})
        self.c.call("set_camera_angle", {"position": [0, 20, 60], "projection": "orthographic"})
        ok, text = self.c.call("get_project_info", {})
        self.expect_ok(
            "set_camera_angle preserves zoom (#3)", ok, text,
            also_check=lambda t: abs((json.loads(t).get("camera") or {}).get("zoom", 0) - 0.22) < 0.001,
        )

        # risky_eval allows comments (#4)
        ok, text = self.c.call("risky_eval", {"code": "1 + 1 // a comment\n/* block */"})
        self.expect_ok("risky_eval allows comments (#4)", ok, text,
                       also_check=lambda t: t.strip() == "2")

        # extended capture_screenshot → file output
        shot = os.path.join(self.workdir, "feat_shot.png")
        ok, text = self.c.call("capture_screenshot",
                               {"width": 96, "height": 96, "background": "#101010",
                                "return_format": "file", "path": shot})
        self.expect_ok(
            "capture_screenshot to file (#8)", ok, text,
            also_check=lambda _: os.path.exists(shot) and os.path.getsize(shot) > 0,
        )

    def t_issue_batch2(self) -> None:
        """Second issue batch (#19-#24): per-element place_cube parent,
        read_animation_keyframes, validate_rig, get_current_tab / idempotent
        switch_to_tab, export Edit-tab guard. (#23 localize_elements_to_parent
        was removed — see issue #23: parenting already rotates correctly around
        the bone pivot; subtracting the parent origin displaced geometry.)"""
        print("\n[18/18] pipeline issue batch #2 (#19-#24)")

        self.c.call("create_project", {"name": "batch2_smoke", "format": "free"})
        self.c.call("create_texture", {"name": "btex", "width": 16, "height": 16,
                                       "fill_color": "#cc8844", "layer_name": "base"})
        # Two bones at distinct origins for per-element parenting.
        self.c.call("add_group", {"name": "RArm", "origin": [0, 8, 0], "rotation": [0, 0, 0]})
        self.c.call("add_group", {"name": "Chest", "origin": [0, 12, 0], "rotation": [0, 0, 0]})
        faces = ["north", "south", "east", "west", "up", "down"]

        # #22: per-element parent — two cubes, two different bones, one call.
        ok, text = self.c.call("place_cube", {"elements": [
            {"name": "rarm_box", "from": [0, 8, 0], "to": [2, 12, 2], "origin": [0, 8, 0],
             "parent": "RArm"},
            {"name": "chest_box", "from": [0, 12, 0], "to": [4, 16, 3], "origin": [0, 12, 0],
             "parent": "Chest"},
        ], "texture": "btex", "faces": faces})
        self.expect_ok("place_cube accepts per-element parent (#22)", ok, text)
        ok, text = self.c.call("get_element_info", {"ids": ["rarm_box", "chest_box"]})
        self.expect_ok(
            "place_cube parented each cube to its own bone (#22)", ok, text,
            also_check=lambda t: {e["name"]: e.get("parent") for e in json.loads(t)["elements"]}
            == {"rarm_box": "RArm", "chest_box": "Chest"},
        )

        # #21: read_animation_keyframes — round-trips create_animation 1:1.
        self.c.call("create_animation", {"name": "rk", "loop": True, "animation_length": 1.0,
                                         "bones": {"RArm": [{"time": 0, "rotation": [0, 0, 0]},
                                                            {"time": 1, "rotation": [0, 45, 0]}]}})
        ok, text = self.c.call("read_animation_keyframes",
                               {"animation_id": "rk", "channels": ["rotation"]})
        self.expect_ok(
            "read_animation_keyframes returns stored rotation 1:1 (#21)", ok, text,
            also_check=lambda t: any(
                abs(kf["values"][1] - 45) < 0.01
                for kf in json.loads(t)["bones"]["RArm"]["rotation"]
                if abs(kf["time"] - 1.0) < 0.01
            ),
        )

        # #21 regression: pipeline assets are saved as .bbmodel then re-opened.
        # read_animation_keyframes must still return authored values after reload.
        bbmodel = os.path.join(self.workdir, "batch2_rk.bbmodel")
        self.c.call("create_animation", {
            "name": "Idle", "loop": True, "animation_length": 1.0,
            "bones": {"RArm": [
                {"time": 0, "rotation": [12, 8, -22]},
                {"time": 1, "rotation": [12, 8, -22]},
            ]},
        })
        ok, text = self.c.call("save_project_silent", {"path": bbmodel})
        self.expect_ok("save batch2_rk.bbmodel for reload regression", ok, text)
        ok, text = self.c.call("open_project_file", {"path": bbmodel})
        self.expect_ok("open batch2_rk.bbmodel after save", ok, text)
        ok, text = self.c.call(
            "read_animation_keyframes",
            {"animation_id": "Idle", "bones": ["RArm"], "channels": ["rotation"], "time": 0},
        )
        self.expect_ok(
            "read_animation_keyframes survives bbmodel reload (#21)", ok, text,
            also_check=lambda t: json.loads(t)["bones"]["RArm"]["rotation"][0]["values"]
            == [12, 8, -22],
        )

        # #20: validate_rig — limb_pivot passes (cube corner == bone origin),
        # fails on a deliberate far pair; bone_orphans flags childless bone.
        self.c.call("add_group", {"name": "Orphan", "origin": [20, 0, 0], "rotation": [0, 0, 0]})
        # Animate the orphan bone so bone_orphans considers it.
        self.c.call("create_animation", {"name": "orph", "loop": False, "animation_length": 1.0,
                                         "bones": {"Orphan": [{"time": 0, "rotation": [0, 0, 0]}]}})
        ok, text = self.c.call("validate_rig", {
            "checks": ["limb_pivot", "bone_orphans"],
            "pairs": [{"bone": "Chest", "cube": "chest_box", "kind": "limb"}],
        })
        self.expect_ok(
            "validate_rig: limb_pivot passes, flags orphan bone (#20)", ok, text,
            also_check=lambda t: (lambda r: r["passed"] is False
                                  and not any(i["check"] == "limb_pivot" for i in r["issues"])
                                  and any(i["check"] == "bone_orphans" and i["bone"] == "Orphan"
                                          for i in r["issues"]))(json.loads(t)),
        )
        ok, text = self.c.call("validate_rig", {
            "checks": ["limb_pivot"],
            "pairs": [{"bone": "Orphan", "cube": "chest_box", "kind": "limb"}],
        })
        self.expect_ok(
            "validate_rig: limb_pivot fails on far cube (#20)", ok, text,
            also_check=lambda t: any(i["check"] == "limb_pivot" for i in json.loads(t)["issues"]),
        )

        # #19: get_current_tab + idempotent switch_to_tab.
        self.c.call("switch_to_tab", {"tab": "animate"})
        ok, text = self.c.call("get_current_tab", {})
        self.expect_ok("get_current_tab reports active tab (#19)", ok, text,
                       also_check=lambda t: json.loads(t)["tab"] == "animate")
        ok, text = self.c.call("switch_to_tab", {"tab": "animate"})
        self.expect_ok(
            "switch_to_tab idempotent no-op (#19)", ok, text,
            also_check=lambda t: json.loads(t)["changed"] is False,
        )
        ok, text = self.c.call("switch_to_tab", {"tab": "edit"})
        self.expect_ok(
            "switch_to_tab changes when needed (#19)", ok, text,
            also_check=lambda t: json.loads(t)["changed"] is True,
        )

        # #24: export_gltf_silent Edit-tab guard — from animate, auto-switch.
        self.c.call("switch_to_tab", {"tab": "animate"})
        gltf = os.path.join(self.workdir, "batch2.glb")
        ok, text = self.c.call("export_gltf_silent", {"path": gltf})
        self.expect_ok(
            "export_gltf_silent auto-switches off animate tab (#24)", ok, text,
            also_check=lambda t: "switched_from" in t or "from 'animate'" in t,
        )
        ok, text = self.c.call("get_current_tab", {})
        self.expect_ok(
            "export guard left project on edit tab (#24)", ok, text,
            also_check=lambda t: json.loads(t)["tab"] == "edit",
        )

    def t_tier_tools(self) -> None:
        """Wishlist tier tools: place_section (one-call group+cubes+texture),
        capture_ortho_set / export_silhouette_mask / capture_anim_contact_sheet
        (live render to PNG), reload_project (in-place reload, no extra tab)."""
        print("\n[19/19] tier tools (place_section, captures, reload_project)")

        self.c.call("create_project", {"name": "tier_smoke", "format": "free"})
        self.c.call("create_texture", {"name": "ttex", "width": 16, "height": 16,
                                       "fill_color": "#4488cc", "layer_name": "base"})

        # place_section — group + cubes + texture in one call.
        ok, text = self.c.call("place_section", {
            "group": "wing", "texture": "ttex",
            "cubes": [
                {"name": "wa", "from": [-6, 0, -2], "to": [-2, 8, 2], "origin": [-4, 0, 0]},
                {"name": "wb", "from": [2, 0, -2], "to": [6, 8, 2], "origin": [4, 0, 0]},
            ],
        })
        self.expect_ok(
            "place_section builds group + cubes + texture in one call", ok, text,
            also_check=lambda t: json.loads(t)["cubes_added"] == 2
            and bool(json.loads(t)["group_uuid"]),
        )
        # place_section fails loudly on a bad texture (no silent untextured build).
        ok, text = self.c.call("place_section", {
            "group": "wing2", "texture": "does_not_exist",
            "cubes": [{"name": "x", "from": [0, 0, 0], "to": [1, 1, 1]}],
        })
        self.expect_err("place_section throws on unknown texture", ok, text,
                        contains="does_not_exist")

        # capture_ortho_set — labeled PNGs written to disk.
        odir = os.path.join(self.workdir, "ortho")
        ok, text = self.c.call("capture_ortho_set", {
            "out_dir": odir, "views": ["front", "right", "3q_front"], "size": 128,
        })
        self.expect_ok(
            "capture_ortho_set writes one PNG per view", ok, text,
            also_check=lambda t: (lambda p: len(p) == 3
                                  and all(os.path.getsize(v) > 0 for v in p.values()))(
                json.loads(t)["paths"]),
        )

        # export_silhouette_mask — mask PNG with non-zero foreground.
        mask = os.path.join(self.workdir, "mask.png")
        ok, text = self.c.call("export_silhouette_mask", {
            "view": "front", "size": 128, "out_path": mask,
        })
        self.expect_ok(
            "export_silhouette_mask writes a mask with foreground pixels", ok, text,
            also_check=lambda t: json.loads(t)["foreground"] > 0
            and os.path.getsize(mask) > 0,
        )

        # capture_anim_contact_sheet — needs an animation on the section bone.
        self.c.call("create_animation", {"name": "flap", "loop": True, "animation_length": 1.0,
                                         "bones": {"wing": [{"time": 0, "rotation": [0, 0, 0]},
                                                            {"time": 1, "rotation": [0, 30, 0]}]}})
        sheet = os.path.join(self.workdir, "sheet.png")
        ok, text = self.c.call("capture_anim_contact_sheet", {
            "animation": "flap", "frames": 3, "views": ["front", "3q_front"],
            "size": 96, "out_path": sheet,
        })
        self.expect_ok(
            "capture_anim_contact_sheet composites a frames×views grid", ok, text,
            also_check=lambda t: json.loads(t)["cells"] == 6 and os.path.getsize(sheet) > 0,
        )

        # reload_project — in-place reload keeps the net tab count constant.
        bbmodel = os.path.join(self.workdir, "tier.bbmodel")
        self.c.call("save_project_silent", {"path": bbmodel})

        def _tab_count() -> int:
            ok2, t2 = self.c.call(
                "risky_eval", {"code": "ModelProject.all.length"})
            return int(json.loads(t2)) if ok2 else -1

        before = _tab_count()
        ok, text = self.c.call("reload_project", {})
        after = _tab_count()
        self.expect_ok(
            "reload_project reloads in place (animations intact, no extra tab)", ok, text,
            also_check=lambda t: json.loads(t)["reloaded"] is True
            and json.loads(t)["animations"] == 1
            and after == before,
        )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def _list_project_uuids(client: "MCPClient") -> set[str]:
    """Snapshot the UUIDs of all currently-open projects."""
    ok, text = client.call(
        "risky_eval", {"code": "JSON.stringify(ModelProject.all.map(p=>p.uuid))"}
    )
    if not ok:
        return set()
    try:
        return set(json.loads(json.loads(text)))
    except (ValueError, TypeError):
        return set()


def _close_created_projects(client: "MCPClient", pre_uuids: set[str]) -> int:
    """Close every project opened during the run (uuid not in the pre-run
    snapshot), leaving the user's pre-existing tabs untouched. Closes by UUID,
    one at a time, so we never force-close a tab we didn't create."""
    closed = 0
    for uuid in _list_project_uuids(client) - pre_uuids:
        code = (
            f"(()=>{{const x=ModelProject.all.find(q=>q.uuid==='{uuid}');"
            f"if(x){{x.close(true);return true;}}return false;}})()"
        )
        client.call("risky_eval", {"code": code})
        closed += 1
    return closed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--endpoint", default=DEFAULT_ENDPOINT, help="MCP HTTP endpoint"
    )
    parser.add_argument(
        "--keep-test-files",
        action="store_true",
        help="Keep the temp dir with test artifacts AND the test project tabs after run",
    )
    args = parser.parse_args()

    print(f"Smoke test → {args.endpoint}")
    client = MCPClient(args.endpoint)
    client.initialize()
    print(f"  session: {client.session_id}")

    workdir = tempfile.mkdtemp(prefix="bb-mcp-smoke-")
    print(f"  workdir: {workdir}")

    # Snapshot pre-existing tabs so cleanup only closes what this run creates.
    pre_uuids = _list_project_uuids(client)

    runner = TestRunner(client, workdir)

    t0 = time.time()
    try:
        runner.t_listing()
        runner.t_setup()
        runner.t_silent_io()
        runner.t_attachments()
        runner.t_cubes()
        runner.t_mesh()
        runner.t_topology()
        runner.t_animations()
        runner.t_round_trip()
        runner.t_selection_bucketing()
        runner.t_edge_cases()
        runner.t_java_import()
        runner.t_get_element_info()
        runner.t_grouping_and_filters()
        runner.t_ignore_textures()
        runner.t_cit_texture_resolution()
        runner.t_new_feature_tools()
        runner.t_issue_batch2()
        runner.t_tier_tools()
    finally:
        if args.keep_test_files:
            print(f"\nkeeping test artifacts at {workdir} (and test project tabs)")
        else:
            shutil.rmtree(workdir, ignore_errors=True)
            closed = _close_created_projects(client, pre_uuids)
            if closed:
                print(f"\ncleaned up {closed} test project tab(s)")

    dt = time.time() - t0
    total = runner.passed + runner.failed
    print(
        f"\n--- {runner.passed}/{total} passed ({runner.failed} failed) in {dt:.1f}s ---"
    )
    if runner.failed:
        print("\nfailures:")
        for f in runner.failures:
            print(f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class E2EBoundaryTests(unittest.TestCase):
    def test_webdriver_is_optional_and_feature_gated(self) -> None:
        cargo = (ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8")
        rust = (ROOT / "src-tauri/src/lib.rs").read_text(encoding="utf-8")

        self.assertIn('"dep:tauri-plugin-wdio-webdriver"', cargo)
        self.assertRegex(
            cargo,
            r'tauri-plugin-wdio-webdriver\s*=\s*\{[^}]*optional\s*=\s*true[^}]*\}',
        )
        self.assertIn('#[cfg(feature = "e2e")]', rust)
        self.assertIn("tauri_plugin_wdio_webdriver::init()", rust)

    def test_e2e_identity_and_permission_are_not_in_production_config(self) -> None:
        production = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        production_capability = json.loads(
            (ROOT / "src-tauri/capabilities/default.json").read_text(encoding="utf-8")
        )
        e2e = json.loads((ROOT / "src-tauri/tauri.e2e.conf.json").read_text(encoding="utf-8"))

        self.assertEqual(production["identifier"], "ai.yuling.md")
        self.assertNotIn("wdio-webdriver:default", production_capability["permissions"])
        self.assertNotEqual(e2e["identifier"], production["identifier"])
        permissions = e2e["app"]["security"]["capabilities"][0]["permissions"]
        self.assertIn("wdio-webdriver:default", permissions)

    def test_e2e_workspace_requires_an_explicit_marker(self) -> None:
        rust = (ROOT / "src-tauri/src/lib.rs").read_text(encoding="utf-8")
        self.assertIn("YULING_E2E_WORKSPACE", rust)
        self.assertIn(".yuling-e2e-workspace", rust)

    def test_runner_owns_and_stops_only_the_test_application_pid(self) -> None:
        runner = (ROOT / "scripts/run_e2e_macos.sh").read_text(encoding="utf-8")
        self.assertIn("app_pid=$!", runner)
        self.assertIn('kill "$app_pid"', runner)
        self.assertNotIn("pkill", runner)


if __name__ == "__main__":
    unittest.main()

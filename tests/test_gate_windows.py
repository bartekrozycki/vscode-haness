import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gate_harness", Path(__file__).resolve().parents[1] / "resources/project/tools/work-items.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class WindowsGateTests(unittest.TestCase):
    def test_npm_and_npx_use_node_and_preserve_arguments(self):
        node = r"C:\Program Files\nodejs\node.exe"
        npm = r"C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
        npx = r"C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js"
        args = ["test", "argument with spaces", "&$(not-shell)"]
        with patch.dict(os.environ, {"COPILOT_SDLC_NODE_PATH": node}), patch("os.path.isfile", side_effect=lambda p: p in (node, npm, npx)):
            self.assertEqual(harness.resolve_gate_command(["npm", *args], windows=True), [node, npm, *args])
            self.assertEqual(harness.resolve_gate_command(["npx.cmd", *args], windows=True), [node, npx, *args])
            with self.assertRaisesRegex(ValueError, "batch gate commands"):
                harness.resolve_gate_command(["yarn.cmd"], windows=True)

    def test_missing_npm_cli_is_actionable(self):
        node = r"C:\Node\node.exe"
        with patch.dict(os.environ, {"COPILOT_SDLC_NODE_PATH": node}), patch("os.path.isfile", side_effect=lambda p: p == node):
            with self.assertRaisesRegex(ValueError, "npm-cli.js"):
                harness.resolve_gate_command(["npm", "test"], windows=True)


class GateTimeoutTests(unittest.TestCase):
    def test_timeout_stops_spawned_descendant_and_keeps_output(self):
        import sys
        import tempfile
        import time
        with tempfile.TemporaryDirectory() as directory:
            marker = str(Path(directory) / "descendant-wrote")
            child = "import pathlib,sys,time; time.sleep(2.5); pathlib.Path(sys.argv[1]).write_text('alive')"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); print('gate started',flush=True); time.sleep(20)"
            code, output = harness.run_gate_command([sys.executable, "-c", parent, child, marker], directory, 1)
            self.assertEqual(code, 124)
            self.assertIn("gate started", output)
            self.assertIn("Gate timed out", output)
            time.sleep(3)
            self.assertFalse(Path(marker).exists(), "Timed-out descendant survived and wrote a file")

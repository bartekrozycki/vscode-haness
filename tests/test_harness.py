import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[1] / "resources/project"
spec = importlib.util.spec_from_file_location("harness", PROJECT / "tools/work-items.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        shutil.copytree(PROJECT, self.root, dirs_exist_ok=True)
        harness.ROOT = self.root

    def tearDown(self):
        self.directory.cleanup()

    def call(self, operation, **values):
        return harness.dispatch(dict(operation=operation, **values))

    def create(self, **values):
        return self.call("create", title="Unicode: 日本語", requirements="W1: behavior and test", **values)

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def repository(self, item="WI-001"):
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Harness test")
        self.git("add", "tools/work-items.py")
        self.git("commit", "-qm", f"test: harness ({item})")
        return self.git("rev-parse", "HEAD")

    def test_no_implicit_initialization(self):
        (self.root / ".copilot-sdlc/config.json").unlink()
        with self.assertRaisesRegex(ValueError, "not initialized"):
            self.call("list")
        self.assertFalse((self.root / ".work-item/.lock").exists())

    def test_unicode_tsv_and_markdown_are_round_tripped(self):
        item = self.create()
        self.assertEqual(self.call("read", id=item["id"])["title"], "Unicode: 日本語")
        self.assertIn("W1:", self.call("read", id=item["id"])["body"])
        self.assertEqual(self.call("list")[0]["status"], "ready")

    def test_task_template_belongs_to_the_project(self):
        (self.root / ".work-item/TEMPLATE.md").write_text("# ${id}\n\nProject-specific section\n${requirements}\n")
        item = self.create()
        body = self.call("read", id=item["id"])["body"]
        self.assertIn("Project-specific section", body)
        self.assertIn("W1:", body)

    def test_approval_dependency_and_ownership_are_enforced(self):
        first = self.create()["id"]
        second = self.create(dependencies=[first])["id"]
        with self.assertRaisesRegex(ValueError, "approval"):
            self.call("update", id=first, status="active", actor="a")
        self.call("approve", id=second)
        with self.assertRaisesRegex(ValueError, "dependencies"):
            self.call("update", id=second, status="active", actor="a")
        self.call("approve", id=first)
        self.call("update", id=first, status="active", actor="a")
        with self.assertRaisesRegex(ValueError, "belongs"):
            self.call("update", id=first, status="active", actor="b")

    def test_invalid_transition_and_self_review_are_rejected(self):
        item = self.create()["id"]
        with self.assertRaisesRegex(ValueError, "Forbidden"):
            self.call("update", id=item, status="accepted", actor="judge", evidence="looks good")
        rows = harness.read_table("tasks")
        rows[0].update(status="review", executor="worker")
        harness.atomic(self.root / ".work-item/tasks.tsv", harness.as_tsv("tasks", rows))
        with self.assertRaisesRegex(ValueError, "own task"):
            self.call("update", id=item, status="accepted", actor="worker", evidence="self approved")
        self.call("update", id=item, status="changes", actor="judge", evidence="W1 fails")
        self.assertEqual(self.call("read", id=item)["rounds"], "1")

    def test_open_questions_block_queue_and_cannot_be_reanswered(self):
        item = self.create()["id"]
        self.call("approve", id=item)
        self.call("ask", id=item, question="Which?", options={"A": "a", "B": "b"}, recommended="A")
        self.assertIsNone(self.call("next"))
        with self.assertRaisesRegex(ValueError, "decision"):
            self.call("update", id=item, status="active")
        self.call("answer", id=item, question_id="P1", answer="A")
        self.assertEqual(self.call("next")["id"], item)
        with self.assertRaisesRegex(ValueError, "already answered"):
            self.call("answer", id=item, question_id="P1", answer="B")

    def test_overlapping_reservations_and_path_escapes_are_rejected(self):
        first = self.create()["id"]
        second = self.create()["id"]
        self.call("approve", id=first)
        self.call("update", id=first, status="active", actor="a")
        self.call("reserve", id=first, files=["src/"])
        with self.assertRaisesRegex(ValueError, "held"):
            self.call("reserve", id=second, files=["src/a.ts"])
        with self.assertRaises(ValueError):
            self.call("reserve", id=second, files=["../outside"])
        with self.assertRaises(ValueError):
            self.call("reserve", id=second, files=["src/../file"])

    def test_concurrent_creates_keep_all_ids_and_history(self):
        def create(index):
            result = subprocess.run([sys.executable, str(self.root / "tools/work-items.py"), "api"], input=json.dumps(dict(operation="create", title=f"Task {index}", requirements="W1")), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)["id"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            ids = list(pool.map(create, range(12)))
        self.assertEqual(len(set(ids)), 12)
        self.assertEqual(len(self.call("list")), 12)
        self.assertEqual(len(harness.read_table("history")), 12)

    def test_transaction_recovers_after_interrupted_write(self):
        tasks = [dict(id="WI-007", title="Recovered", status="ready")]
        journal = {".work-item/tasks.tsv": harness.as_tsv("tasks", tasks)}
        (self.root / ".work-item/.transaction.json").write_text(json.dumps(journal))
        self.assertEqual(self.call("list")[0]["id"], "WI-007")
        self.assertFalse((self.root / ".work-item/.transaction.json").exists())

    def test_unknown_cost_is_not_recorded_as_zero_and_finish_is_once(self):
        item = self.create()["id"]
        self.call("approve", id=item)
        self.call("run_start", id=item, run="run1", role="worker", actor="sdk-worker")
        with self.assertRaisesRegex(ValueError, "already owns"):
            self.call("run_start", id=item, run="run2", role="worker", actor="sdk-worker")
        self.call("run_finish", run="run1", outcome="failed", model="auto", input_tokens=10)
        metric = harness.read_table("metrics")[0]
        self.assertEqual(metric["cost_usd"], "")
        self.assertEqual(metric["input_tokens"], "10")
        self.assertTrue(self.call("read", id=item)["blocked"])
        with self.assertRaisesRegex(ValueError, "already finished"):
            self.call("run_finish", run="run1", outcome="completed")

    def test_lessons_need_recurrence_and_independent_confirmation(self):
        item = self.create()["id"]
        lesson = self.call("lesson", id=item, rule="Always verify", evidence="regression", actor="worker")
        with self.assertRaisesRegex(ValueError, "threshold"):
            self.call("lesson_update", id=lesson["id"], status="implemented", actor="judge")
        self.call("lesson_update", id=lesson["id"], status="recur")
        with self.assertRaisesRegex(ValueError, "independent"):
            self.call("lesson_update", id=lesson["id"], status="implemented", actor="worker")
        self.assertEqual(self.call("lesson_update", id=lesson["id"], status="implemented", actor="judge")["status"], "implemented")

    def test_gates_validate_clean_commit_and_clear_old_success_on_failure(self):
        item = self.create()["id"]
        sha = self.repository(item)
        cfg_path = self.root / ".copilot-sdlc/config.json"
        cfg = json.loads(cfg_path.read_text())
        cfg["gates"] = [{"name": "snapshot", "command": [sys.executable, "-c", "from pathlib import Path; assert not Path('uncommitted.txt').exists()"]}]
        cfg_path.write_text(json.dumps(cfg))
        (self.root / "uncommitted.txt").write_text("must not enter gate")
        result = harness.run_gates(dict(id=item, commit=sha))
        self.assertTrue(result["passed"])
        self.assertEqual(self.call("read", id=item)["gate_commit"], sha)
        cfg["gates"][0]["command"] = [sys.executable, "-c", "raise SystemExit(1)"]
        cfg_path.write_text(json.dumps(cfg))
        self.assertFalse(harness.run_gates(dict(id=item, commit=sha))["passed"])
        self.assertEqual(self.call("read", id=item)["gate_commit"], "")

    def test_gates_refuse_an_older_work_item_commit(self):
        item = self.create()["id"]
        old = self.repository(item)
        self.git("commit", "--allow-empty", "-qm", f"fix: another round ({item})")
        cfg_path = self.root / ".copilot-sdlc/config.json"
        cfg = json.loads(cfg_path.read_text())
        cfg["gates"] = [{"name": "unit", "command": [sys.executable, "-c", "pass"]}]
        cfg_path.write_text(json.dumps(cfg))
        with self.assertRaisesRegex(ValueError, "latest commit"):
            harness.run_gates(dict(id=item, commit=old))

    def test_return_to_ready_releases_owner_and_clears_blocker(self):
        item = self.create()["id"]
        self.call("approve", id=item)
        self.call("update", id=item, status="active", actor="user")
        self.call("update", id=item, status="ready", actor="user")
        self.assertEqual(self.call("read", id=item)["executor"], "")
        self.call("update", id=item, status="active", actor="sdk-worker")
        self.call("run_start", id=item, run="interrupted", role="worker", actor="sdk-worker")
        self.call("run_finish", run="interrupted", outcome="cancelled")
        self.assertTrue(self.call("read", id=item)["blocked"])
        self.call("unblock", id=item)
        self.call("run_start", id=item, run="resumed", role="worker", actor="sdk-worker")

    def test_missing_gates_block_handoff(self):
        self.create()
        with self.assertRaisesRegex(ValueError, "at least one gate"):
            harness.run_gates(dict(id="WI-001", commit="HEAD"))


if __name__ == "__main__":
    unittest.main()

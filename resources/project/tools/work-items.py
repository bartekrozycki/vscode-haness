#!/usr/bin/env python3
"""Project-owned Copilot harness. Stdlib only; TSV is the source of truth.

Derived from the work-items.py harness snapshot documented in UPSTREAM.md.
  python3 tools/work-items.py                        # open tasks as TSV
  python3 tools/work-items.py next worker            # next task as JSON
  python3 tools/work-items.py launchpad               # dashboard as JSON
  python3 tools/work-items.py api < input.json         # extension/tool protocol
  python3 tools/work-items.py create 'Title' 'Requirements'
  python3 tools/work-items.py start WI-001
  python3 tools/work-items.py set WI-001 active worker

Files are created only by explicit initialization or mutation. All state changes
use an OS lock, atomic replacement and a recoverable multi-file journal.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import re
import signal
import subprocess
from string import Template
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLES = {
    "tasks": ("id", "title", "status", "priority", "area", "estimate", "executor", "dependencies", "approved", "created", "updated", "commit", "gate_commit", "blocked", "rounds", "files", "document"),
    "history": ("timestamp", "item", "event", "actor", "detail"),
    "metrics": ("run", "item", "role", "model", "started", "finished", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "premium_requests", "duration_ms", "turns", "tool_calls", "outcome", "session"),
    "questions": ("id", "item", "question", "options", "recommended", "asked_by", "asked", "answer", "answered_by", "answered"),
    "lessons": ("id", "item", "kind", "phase", "weight", "occurrences", "rule", "evidence", "target", "status", "author", "confirmed_by"),
    "runs": ("id", "item", "role", "actor", "started", "finished", "outcome", "session"),
}
TRANSITIONS = {
    "ready": {"active", "blocked", "closed"},
    "active": {"review", "blocked", "ready"},
    "review": {"accepted", "changes", "blocked"},
    "changes": {"active", "blocked", "closed"},
    "accepted": {"closed", "changes"},
    "blocked": {"ready", "active", "changes", "closed"},
    "closed": {"ready"},
}
PRIORITIES = {"MUST": 0, "SHOULD": 1, "COULD": 2}


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe(relative):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError("Path leaves the project")
    return path


def config():
    path = safe(".copilot-sdlc/config.json")
    if not path.is_file():
        raise ValueError("Harness is not initialized. Run SDLC: Initialize project harness first.")
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("version") != 1:
        raise ValueError("Unsupported harness configuration version")
    return value


def read_table(name):
    path = safe(f".work-item/{name}.tsv")
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if tuple(reader.fieldnames or ()) != TABLES[name]:
            raise ValueError(f"Invalid TSV columns in {path.name}; restore the documented header")
        rows = list(reader)
    if any(None in row or any(v is None for v in row.values()) for row in rows):
        raise ValueError(f"Malformed TSV row in {path.name}")
    return rows


def as_tsv(name, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, TABLES[name], delimiter="\t", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: str(row.get(key, "")).replace("\t", " ").replace("\r", " ").replace("\n", " ") for key in TABLES[name]})
    return out.getvalue()


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".sdlc-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def recover():
    journal = safe(".work-item/.transaction.json")
    if journal.exists():
        for name, content in json.loads(journal.read_text(encoding="utf-8")).items():
            atomic(safe(name), content)
        journal.unlink()


def commit(changes):
    atomic(safe(".work-item/.transaction.json"), json.dumps(changes, ensure_ascii=False))
    recover()


@contextlib.contextmanager
def locked():
    config()
    path = safe(".work-item/.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            stream.seek(0, 2)
            if not stream.tell():
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            deadline = time.monotonic() + 30
            while True:
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise ValueError("Harness is busy; retry shortly")
                    time.sleep(0.05)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            recover()
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def event(changes, item, action, actor, detail=""):
    rows = read_table("history")
    rows.append(dict(timestamp=stamp(), item=item, event=action, actor=actor, detail=detail))
    changes[".work-item/history.tsv"] = as_tsv("history", rows)


def find(rows, item):
    matches = [row for row in rows if row["id"] == item]
    if len(matches) != 1:
        raise ValueError(f"Unknown or duplicate item: {item}")
    return matches[0]


def nonempty(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty string")
    return value.strip()


def git(*args):
    result = subprocess.run([os.environ.get("COPILOT_SDLC_GIT_PATH", "git"), *args], cwd=ROOT, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError(result.stderr.strip() or "Git command failed")
    return result.stdout.strip()


def dependencies_done(row, rows):
    ids = [value.strip() for value in row["dependencies"].split(",") if value.strip()]
    return all(find(rows, item)["status"] in ("accepted", "closed") for item in ids)


def latest_commit(item):
    lines = git("log", "--format=%H%x00%s", "--fixed-strings", f"--grep=({item})").splitlines()
    matches = [line.split("\0", 1)[0] for line in lines if f"({item})" in line.split("\0", 1)[-1]]
    if not matches:
        raise ValueError(f"No commit with ({item}) in its subject")
    return matches[0]


def next_task(rows, role, actor=""):
    asked = {row["item"] for row in read_table("questions") if not row["answer"]}
    eligible = [row for row in rows if not row["blocked"] and row["id"] not in asked]
    if role == "judge":
        return next(iter(sorted((r for r in eligible if r["status"] == "review"), key=lambda r: (r["updated"], r["id"]))), None)
    eligible = [row for row in eligible if row["status"] in ("ready", "active", "changes") and dependencies_done(row, rows)
                and row["approved"] and (not actor or not row["executor"] or row["executor"] == actor)]
    return next(iter(sorted(eligible, key=lambda r: ({"changes": 0, "active": 1, "ready": 2}[r["status"]], PRIORITIES[r["priority"]], r["id"]))), None)


def dispatch(request):
    op = request.get("operation", "snapshot")
    actor = str(request.get("actor") or "user")
    with locked():
        cfg, tasks, changes = config(), read_table("tasks"), {}
        if op == "snapshot":
            return {name: read_table(name) for name in TABLES} | {"config": cfg}
        if op == "list":
            return [r for r in tasks if not request.get("status") or r["status"] == request["status"]]
        if op == "next":
            if request.get("role", "worker") not in ("worker", "judge"):
                raise ValueError("role must be worker or judge")
            return next_task(tasks, request.get("role", "worker"), request.get("actor", ""))
        if op == "read":
            row = find(tasks, request["id"])
            return row | {"body": safe(row["document"]).read_text(encoding="utf-8")}
        if op == "create":
            title = nonempty(request.get("title"), "title")
            body = nonempty(request.get("requirements"), "requirements")
            priority = request.get("priority", "SHOULD")
            if priority not in PRIORITIES:
                raise ValueError("priority must be MUST, SHOULD or COULD")
            deps = request.get("dependencies", [])
            if not isinstance(deps, list):
                raise ValueError("dependencies must be an array")
            for dep in deps:
                find(tasks, dep)
            numbers = [int(r["id"][3:]) for r in tasks if re.fullmatch(r"WI-\d+", r["id"])]
            try:
                numbers += [int(n) for n in re.findall(r"\bWI-(\d{3,})\b", git("log", "--all", "--format=%s%n%b"))]
            except (OSError, ValueError):
                pass
            item = f"WI-{max(numbers, default=0) + 1:03d}"
            row = {key: "" for key in TABLES["tasks"]}
            row.update(id=item, title=title, status="ready", priority=priority, area=str(request.get("area", "")),
                       estimate=str(request.get("estimate", "")), dependencies=",".join(deps), created=stamp(), updated=stamp(),
                       rounds="0", document=f".work-item/{item}.md")
            tasks.append(row)
            template_path = safe(".work-item/TEMPLATE.md")
            template = template_path.read_text(encoding="utf-8") if template_path.exists() else "# ${id} — ${title}\n\n## Requirements\n\n${requirements}\n"
            if "${requirements}" not in template:
                raise ValueError("Task template must contain ${requirements}")
            changes[row["document"]] = Template(template).safe_substitute(id=item, title=title, requirements=body)
            event(changes, item, "created", actor, title)
            result = row
        elif op == "approve":
            row = find(tasks, request["id"])
            if row["status"] not in ("ready", "changes"):
                raise ValueError("Only ready or returned tasks can be approved")
            row.update(approved=stamp(), updated=stamp())
            event(changes, row["id"], "approved", actor)
            result = row
        elif op == "unblock":
            row = find(tasks, request["id"])
            if row["status"] == "blocked":
                raise ValueError("Select a resume status for a blocked task")
            row.update(blocked="", updated=stamp())
            event(changes, row["id"], "unblocked", actor)
            result = row
        elif op == "update":
            row = find(tasks, request["id"])
            target = request.get("status", row["status"])
            if target != row["status"] and target not in TRANSITIONS.get(row["status"], set()):
                raise ValueError(f"Forbidden transition: {row['status']} → {target}")
            if target == "active":
                if not row["approved"] or not dependencies_done(row, tasks):
                    raise ValueError("Task needs explicit approval and completed dependencies")
                if row["blocked"] and row["status"] != "blocked" or any(q["item"] == row["id"] and not q["answer"] for q in read_table("questions")):
                    raise ValueError("Task is waiting for a decision")
                if any(r["id"] != row["id"] and r["status"] == "active" and r["executor"] == actor for r in tasks):
                    raise ValueError("An executor can hold only one active task")
                if row["executor"] and row["executor"] != actor:
                    raise ValueError(f"Task belongs to {row['executor']}")
                row["executor"] = actor
            if target == "review":
                if actor != row["executor"]:
                    raise ValueError("Only the assigned executor can hand off a task")
                sha = git("rev-parse", "--verify", request.get("commit", row["commit"]) + "^{commit}")
                if row["gate_commit"] != sha or latest_commit(row["id"]) != sha:
                    raise ValueError("Run configured quality gates for this commit first")
                evidence = nonempty(request.get("evidence"), "handoff evidence")
                row["commit"] = sha
                doc = safe(row["document"]).read_text(encoding="utf-8")
                changes[row["document"]] = doc + f"\n## Handoff for review — {stamp()}\n\n{evidence}\n"
            if target in ("accepted", "changes") and target != row["status"]:
                if actor == row["executor"]:
                    raise ValueError("Executor cannot review their own task")
                verdict = nonempty(request.get("evidence"), "review evidence")
                doc = safe(row["document"]).read_text(encoding="utf-8")
                changes[row["document"]] = doc + f"\n## Verification — {actor}, {stamp()}\n\n{verdict}\n"
                if target == "changes":
                    row["rounds"] = str(int(row["rounds"] or 0) + 1)
            if target == "blocked":
                row["blocked"] = nonempty(request.get("reason"), "block reason")
            elif row["status"] == "blocked":
                row["blocked"] = ""
            if target == "ready":
                row.update(executor="", blocked="", gate_commit="")
            if row["status"] == "closed" and target == "ready":
                row.update(approved="", executor="", commit="", gate_commit="")
            row.update(status=target, updated=stamp())
            event(changes, row["id"], target, actor, request.get("evidence", request.get("reason", "")))
            result = row
        elif op == "reserve":
            row = find(tasks, request["id"])
            paths = request.get("files", [])
            if not isinstance(paths, list) or not paths:
                raise ValueError("files must be a nonempty array")
            for path in paths:
                safe(nonempty(path, "file"))
                if path.startswith("/") or "\\" in path or "," in path:
                    raise ValueError("Use project-relative paths without commas")
                if any(part in ("..", ".", "") for part in path.rstrip("/").split("/")):
                    raise ValueError("Use normalized relative paths")
                for other in tasks:
                    if other["id"] == row["id"] or other["status"] not in ("active", "review", "changes"):
                        continue
                    for held in other["files"].split(","):
                        if held and (path == held or path.startswith(held.rstrip("/") + "/") or held.startswith(path.rstrip("/") + "/")):
                            raise ValueError(f"{path} is held by {other['id']}")
            row.update(files=",".join(dict.fromkeys(paths)), updated=stamp())
            event(changes, row["id"], "reserved", actor, row["files"])
            result = row
        elif op == "ask":
            find(tasks, request["id"])
            options = request.get("options", {})
            if not isinstance(options, dict) or len(options) < 2 or request.get("recommended") not in options:
                raise ValueError("Provide at least two options and a recommendation among them")
            rows = read_table("questions")
            count = 1 + max((int(r["id"][1:]) for r in rows if r["item"] == request["id"]), default=0)
            result = dict(id=f"P{count}", item=request["id"], question=nonempty(request.get("question"), "question"),
                          options=json.dumps(options, ensure_ascii=False), recommended=request["recommended"],
                          asked_by=actor, asked=stamp(), answer="", answered_by="", answered="")
            rows.append(result)
            changes[".work-item/questions.tsv"] = as_tsv("questions", rows)
            event(changes, request["id"], "question", actor, result["question"])
        elif op == "answer":
            rows = read_table("questions")
            result = next((r for r in rows if r["id"] == request["question_id"] and r["item"] == request["id"]), None)
            if result is None or result["answer"]:
                raise ValueError("Question is missing or already answered")
            result.update(answer=nonempty(request.get("answer"), "answer"), answered_by=actor, answered=stamp())
            changes[".work-item/questions.tsv"] = as_tsv("questions", rows)
            event(changes, request["id"], "answered", actor, result["answer"])
        elif op == "lesson":
            find(tasks, request["id"])
            rows = read_table("lessons")
            weight = request.get("weight", "medium")
            if weight not in ("high", "medium", "low"):
                raise ValueError("weight must be high, medium or low")
            result = dict(id=f"L-{1 + max((int(r['id'][2:]) for r in rows), default=0):03d}", item=request["id"],
                          kind=request.get("kind", "verification"), phase=request.get("phase", "review"), weight=weight,
                          occurrences="1", rule=nonempty(request.get("rule"), "rule"), evidence=nonempty(request.get("evidence"), "evidence"),
                          target=request.get("target", "check"), status="ready" if weight == "high" else "observed", author=actor, confirmed_by="")
            rows.append(result)
            changes[".work-item/lessons.tsv"] = as_tsv("lessons", rows)
        elif op == "lesson_update":
            rows = read_table("lessons")
            result = find(rows, request["id"])
            if request.get("status") == "implemented":
                if actor == result["author"]:
                    raise ValueError("An independent reviewer must confirm a lesson")
                if int(result["occurrences"]) < {"high": 1, "medium": 2, "low": 3}[result["weight"]]:
                    raise ValueError("Lesson has not reached its recurrence threshold")
                result.update(status="implemented", confirmed_by=actor)
            elif request.get("status") == "recur":
                result["occurrences"] = str(int(result["occurrences"]) + 1)
                if int(result["occurrences"]) >= {"high": 1, "medium": 2, "low": 3}[result["weight"]]:
                    result["status"] = "ready"
            else:
                raise ValueError("status must be recur or implemented")
            changes[".work-item/lessons.tsv"] = as_tsv("lessons", rows)
        elif op == "run_start":
            row = find(tasks, request["id"])
            runs = read_table("runs")
            if any(not r["finished"] and (r["item"] == row["id"] or r["actor"] == actor) for r in runs):
                raise ValueError("A session already owns this task or executor; stop/recover it first")
            if request["role"] == "worker" and (not row["approved"] or row["status"] not in ("ready", "changes", "active") or not dependencies_done(row, tasks)):
                raise ValueError("Worker needs an approved, unblocked task with completed dependencies")
            if request["role"] == "worker" and row["executor"] and row["executor"] != actor:
                raise ValueError(f"Task belongs to {row['executor']}; return it to ready to release ownership")
            if request["role"] == "worker" and any(r["id"] != row["id"] and r["status"] == "active" and r["executor"] == actor for r in tasks):
                raise ValueError("An executor can hold only one active task")
            if row["blocked"] or any(r["item"] == row["id"] and not r["answer"] for r in read_table("questions")):
                raise ValueError("Task is waiting for a decision")
            if request["role"] == "judge" and row["status"] != "review":
                raise ValueError("Judge needs a task in review")
            result = dict(id=request["run"], item=row["id"], role=request["role"], actor=actor, started=stamp(), finished="", outcome="running", session="")
            runs.append(result)
            changes[".work-item/runs.tsv"] = as_tsv("runs", runs)
            event(changes, row["id"], "session_started", actor, request["run"])
        elif op == "run_finish":
            runs = read_table("runs")
            result = find(runs, request["run"])
            if result["finished"]:
                raise ValueError("Run already finished")
            result.update(finished=stamp(), outcome=request["outcome"], session=request.get("session", ""))
            rows = read_table("metrics")
            metric = {key: str(request.get(key, "")) for key in TABLES["metrics"]}
            metric.update(run=result["id"], item=result["item"], role=result["role"], started=result["started"], finished=result["finished"])
            rows.append(metric)
            changes[".work-item/runs.tsv"] = as_tsv("runs", runs)
            changes[".work-item/metrics.tsv"] = as_tsv("metrics", rows)
            report = request.get("report", "")
            if report:
                changes[f".work-item/reports/{result['id']}.md"] = str(report)
            row = find(tasks, result["item"])
            expected = {"worker": ("review", "blocked"), "judge": ("accepted", "changes", "blocked"), "planner": tuple(TRANSITIONS)}
            if result["role"] in ("worker", "judge") and row["status"] not in expected[result["role"]]:
                row["blocked"] = f"Session ended without handoff/verdict: {result['outcome']}"
                row["updated"] = stamp()
            event(changes, result["item"], "session_finished", actor, result["outcome"])
        elif op == "recover_run":
            runs = read_table("runs")
            result = find(runs, request["run"])
            if result["finished"]:
                raise ValueError("Run already finished")
            result.update(finished=stamp(), outcome="interrupted")
            changes[".work-item/runs.tsv"] = as_tsv("runs", runs)
            event(changes, result["item"], "session_recovered", actor, nonempty(request.get("reason"), "reason"))
        else:
            raise ValueError(f"Unknown operation: {op}")
        changes[".work-item/tasks.tsv"] = as_tsv("tasks", tasks)
        commit(changes)
        return result


def resolve_gate_command(command, windows=None):
    """Resolve known tools without invoking a command shell or changing argument boundaries."""
    import ntpath
    import shutil
    is_windows = os.name == "nt" if windows is None else windows
    executable = command[0]
    tool = {"git": "GIT", "node": "NODE", "java": "JAVA", "python": "PYTHON", "python3": "PYTHON"}.get(executable)
    if tool and os.environ.get(f"COPILOT_SDLC_{tool}_PATH"):
        return [os.environ[f"COPILOT_SDLC_{tool}_PATH"], *command[1:]]
    if not is_windows:
        return command
    name = ntpath.basename(executable).lower()
    if name in ("npm", "npm.cmd", "npx", "npx.cmd"):
        package = name.removesuffix(".cmd")
        node = os.environ.get("COPILOT_SDLC_NODE_PATH")
        if not node and ntpath.isabs(executable):
            node = ntpath.join(ntpath.dirname(executable), "node.exe")
        node = node or shutil.which("node")
        if not node or not os.path.isfile(node):
            raise ValueError("Cannot locate Node for the Windows npm command. Configure the Node executable path.")
        cli = ntpath.join(ntpath.dirname(node), "node_modules", "npm", "bin", package + "-cli.js")
        if not os.path.isfile(cli):
            raise ValueError(f"Cannot find {package}-cli.js beside the selected Node installation. Install npm or invoke its CLI JavaScript directly.")
        return [node, cli, *command[1:]]
    if name in ("yarn", "pnpm") or name.endswith((".cmd", ".bat")):
        raise ValueError("Windows batch gate commands are not supported. Invoke the package CLI JavaScript with Node instead.")
    return command


def run_gate_command(command, cwd, timeout):
    """Run one gate in its own process group and stop descendants on timeout or cancellation."""
    import threading
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, start_new_session=os.name != "nt",
                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
    previous = None
    if os.name != "nt" and threading.current_thread() is threading.main_thread():
        previous = signal.getsignal(signal.SIGTERM)
        def cancel_gate(_signum, _frame):
            raise SystemExit("Gate cancelled")
        signal.signal(signal.SIGTERM, cancel_gate)

    def terminate_tree():
        failed = False
        if os.name == "nt":
            taskkill = str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "taskkill.exe")
            try:
                killed = subprocess.run([taskkill, "/PID", str(process.pid), "/T", "/F"],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3, check=False)
                failed = killed.returncode != 0
            except (OSError, subprocess.TimeoutExpired):
                failed = True
            try:
                process.kill()
            except OSError:
                pass
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                failed = True
                try:
                    process.kill()
                except OSError:
                    pass
        return failed

    try:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
            return process.returncode, stdout + stderr
        except subprocess.TimeoutExpired as expired:
            termination_error = terminate_tree()
            try:
                stdout, stderr = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                # A process outside the group may still hold a pipe; never wait indefinitely.
                def text(value):
                    return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
                stdout, stderr = text(expired.stdout), text(expired.stderr)
            return 124, stdout + stderr + "\nGate timed out" + ("; could not confirm process-tree termination" if termination_error else "")
    except BaseException:
        terminate_tree()
        try:
            process.communicate(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        raise
    finally:
        if previous is not None:
            signal.signal(signal.SIGTERM, previous)


def run_gates(request):
    """Checks execute outside the state lock, in a clean snapshot of the commit."""
    cfg = config()
    gates = cfg.get("gates", [])
    if not gates:
        raise ValueError("Configure at least one gate in .copilot-sdlc/config.json first")
    sha = git("rev-parse", "--verify", nonempty(request.get("commit"), "commit") + "^{commit}")
    if latest_commit(request["id"]) != sha:
        raise ValueError("Gates must verify this work item's latest commit, not an unrelated or older one")
    row = dispatch({"operation": "read", "id": request["id"]})
    results = []
    with tempfile.TemporaryDirectory(prefix="copilot-sdlc-gate-") as directory:
        import tarfile
        archive = subprocess.run([os.environ.get("COPILOT_SDLC_GIT_PATH", "git"), "archive", "--format=tar", sha], cwd=ROOT, capture_output=True, check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(directory, filter="data")
        for gate in gates:
            command = gate.get("command")
            if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
                raise ValueError("Gate command must be an argv array")
            command = resolve_gate_command(command)
            cwd = (Path(directory) / gate.get("cwd", ".")).resolve()
            if not cwd.is_relative_to(Path(directory).resolve()):
                raise ValueError("Gate cwd leaves the commit snapshot")
            code, output = run_gate_command(command, cwd, min(int(gate.get("timeoutSeconds", 300)), 3600))
            log = f".work-item/checks/{uuid.uuid4()}.log"
            atomic(safe(log), output)
            results.append(dict(name=gate.get("name", command[0]), exit=code, log=log))
    with locked():
        rows = read_table("tasks")
        current = find(rows, request["id"])
        if any(current[key] != row[key] for key in TABLES["tasks"]):
            raise ValueError("Task changed during checks. Results saved; run gates again.")
        current.update(gate_commit=sha if all(r["exit"] == 0 for r in results) else "", updated=stamp())
        changes = {".work-item/tasks.tsv": as_tsv("tasks", rows)}
        event(changes, current["id"], "gates", request.get("actor", "user"), json.dumps(results))
        commit(changes)
    return dict(commit=sha, passed=all(r["exit"] == 0 for r in results), results=results)


def main(argv):
    if argv[1:2] == ["api"]:
        request = json.load(sys.stdin)
    elif len(argv) == 1:
        print(as_tsv("tasks", [r for r in dispatch({"operation": "list"}) if r["status"] != "closed"]), end="")
        return 0
    elif argv[1] in ("launchpad", "metrics", "history", "lessons", "metryki", "historia", "lekcje"):
        snapshot = dispatch({"operation": "snapshot"})
        table = {"metrics": "metrics", "history": "history", "lessons": "lessons", "metryki": "metrics", "historia": "history", "lekcje": "lessons"}.get(argv[1])
        print(as_tsv(table, snapshot[table]) if table else json.dumps(snapshot, ensure_ascii=False, indent=2), end="\n")
        return 0
    elif argv[1] == "next":
        request = dict(operation="next", role=argv[2], actor=argv[3] if len(argv) > 3 else "")
    elif argv[1] == "create":
        request = dict(operation="create", title=argv[2], requirements=argv[3])
    elif argv[1] == "start":
        request = dict(operation="approve", id=argv[2])
    elif argv[1] == "set":
        request = dict(operation="update", id=argv[2], status=argv[3], actor=argv[4] if len(argv) > 4 else "user")
    else:
        raise ValueError(__doc__)
    result = run_gates(request) if request.get("operation") == "gates" else dispatch(request)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)

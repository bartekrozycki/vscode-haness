# Project-owned SDLC harness

Write all communication, reports, questions, requirements and artifacts in English.
This directory belongs to the project. Reinitialization preserves existing files.
Edit project prompts, tools and configuration in the repository as needed.

## Files and authority

| File | Contents |
| --- | --- |
| tasks.tsv | Tasks, status, priority, estimate, dependencies, approval, commit and reservations |
| history.tsv | Timestamped events, task and actor |
| metrics.tsv | Reported tokens, cache usage, duration, outcome and premium-request units |
| questions.tsv | Questions, options, recommendation and human answers |
| lessons.tsv | Rules, severity, recurrence and independent confirmation |
| runs.tsv | Session ownership and outcomes |
| WI-NNN.md | Requirements, handoff evidence and verdicts |
| reports/*.md | Final or partial session responses |
| live/*.tsv | Public responses and tool activity, captured while running |
| studio/records.tsv | Initiatives, specifications, artifacts, proposals and research teams |
| studio/docs/ | Immutable Markdown and HTML artifact revisions |

TSV is authoritative state; Markdown stores descriptions and evidence. Engine
columns are defined in `TABLES` in `tools/work-items.py`; do not change headers.
Use tools or the CLI for mutations. Save manual TSV edits only after sessions
stop. The engine serializes mutations with an OS lock and recovers interrupted
multi-file transactions from its journal.

## Implementation workflow

`ready → active → review → accepted → closed`, with corrections through
`review → changes → active`. `blocked` records why work cannot continue.
Reopening `closed → ready` clears previous approval and gate results. Closed tasks
remain in history.

1. Prepare requirements and acceptance criteria. Estimate explicitly; unknown is
   not a default eight points.
2. The human selects **Approve implementation** or explicitly requests approval.
3. The worker reserves changed paths, implements and verifies each requirement.
   One active task per worker; returned work takes precedence over new work,
   then MUST before SHOULD before COULD.
4. Commit only task-owned changes according to project policy; include `(WI-NNN)`
   in the subject. Run configured gates for that commit.
5. Handoff to `review` requires the same SHA, passing gates and concrete evidence.
6. An independent verifier records `accepted` or `changes` with its own evidence.
   Workers cannot accept their own work.
7. The human, or a planner explicitly instructed by the human, closes accepted work.

A task session starts only on explicit request. There is no automatic delivery
loop. Different roles may run concurrently; a task has one session and a role
cannot own two implementation tasks. Recover interrupted sessions explicitly,
first checking they are not active in another window. Role policies are not an
operating-system sandbox; processes run with the VS Code user's permissions.

## Quality gates

Configure meaningful checks in `.copilot-sdlc/config.json`:

```json
"gates": [{ "name": "unit", "command": ["node", "--test"] }]
```

Gates run sequentially in the same clean exported commit snapshot. Prepare any
dependencies there, for example with a separate `npm ci` gate. `cwd` is relative
to the snapshot. Logs are saved under `.work-item/checks/`. Commands use argv,
without shell interpolation. Missing gates cannot produce a passing result;
a failing run clears an earlier passing mark.

## Project customization

- `session.permissions: "bypass"` is the implementation-session default, including
  old configuration without this field. It approves SDK permissions and in-session
  project tools; `"ask"` enables confirmation. Changes apply to new sessions.
- `.work-item/TEMPLATE.md` uses `${id}`, `${title}`, `${requirements}`.
- `.github/agents/sdlc-ROLE.agent.md` defines `name`, `description`, prompt and an
  optional `model`. Definitions are read before sessions.
- `.copilot-sdlc/tools/*.json` defines JSON Schema and an argv `command`.
  `${projectRoot}` and `${input.name}` substitutions are arguments, never shell
  code. Use `sdlc_project_tool` list before invoke. On Windows, configure the
  appropriate Python executable.
- `workflow.agentsByStatus` controls role ordering. An omitted status uses the
  default; `[]` disables agents for that status. Snapshots expose `agentActions`
  and reasons why actions are disabled.
- `execution.default`, role mappings, agent `executor` and per-call overrides
  choose the replaceable session executor. Missing providers do not silently fall back.

## CLI and API

Python 3.12+ requires no additional packages.

```sh
python3 tools/work-items.py list
python3 tools/work-items.py create 'Task title' 'W1: expected behavior and verification'
python3 tools/work-items.py next worker
python3 tools/work-items.py metrics
python3 tools/work-items.py history
python3 tools/work-items.py lessons
```

The complete API accepts JSON on stdin: `python3 tools/work-items.py api`.
Operations: snapshot, list, read, next, create, approve, update, unblock, reserve,
gates, ask, answer, lesson, lesson_update, run_start, run_finish, recover_run.

```json
{"operation":"update","id":"WI-001","status":"active","actor":"worker"}
```

## Research, prototypes and backlog

The human and ordinary VS Code Copilot chat are the master. Read the `sdlc_studio`
taxonomy and use the project `sdlc-studio` skill. Capture an initiative, record a
quick Fibonacci estimate and select specialist slices. Research also applies at
<=13; >13 requires decomposition analysis. Inspect partial results, redirect or
stop the team. Specialists do not approve work or edit implementation.

Specs and decisions require explicit human acceptance. Changes invalidate old
acceptance. Prototypes are discussion artifacts; they do not establish accepted
scope or implementation. Ready proposals reference an accepted spec revision
and promote to unapproved work items. Record dependencies and decomposition links.
Research is bounded by concurrency, reported token usage and time. Interrupted
teams never restart automatically. Their reports and live logs remain available.

## Live sessions and usage

**SDLC: Open agent session** reuses the workbench. Inspect public responses, tools,
errors, duration, model and reported usage. Select a session, stop it, or open its
TSV/report. Live logs use `timestamp`, `event`, `data` (JSON in the final cell).
Older sessions have only their saved reports and usage. The preview retains 300
entries and approximately 8 MB of logged text per session.

Usage is deduplicated by SDK event ID. `assistant.usage.cost` is premium-request
units, not USD. Unknown monetary cost stays unknown. `session.maxPremiumRequests:
null` disables the optional premium ceiling; duration and output-token limits
still apply. In-flight calls can exceed a reported limit before returning usage.
Stops preserve partial responses and their specific reason. A completed model
response does not mean the task was handed off, verified or accepted.

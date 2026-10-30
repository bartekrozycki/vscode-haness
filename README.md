# Copilot SDLC

An extensible VS Code workbench for project-owned tasks, supervised research,
prototypes and agent sessions. Ordinary VS Code Copilot is the master. The
extension supplies tools; GitHub Copilot SDK is the default, replaceable executor.
One workbench combines tasks, live sessions, module contributions and usage.
All extension-owned UI, messages, prompts, documentation and templates use English.
Existing user-authored project content is preserved.

Runtime setup, credentials and onboarding: `docs/launchpad.md`

Studio guide: `docs/studio.md` · Architecture: `docs/architecture.md` · Public API:
`src/contracts/api.ts` · Companion extension: `examples/quality`

## Install and run

Requires VS Code 1.110+, Python 3.12+ and Git. SDK sessions require GitHub Copilot
access. Task management and browsing do not make model calls. Building requires
Node.js 22.12+.

```sh
npm install
npm run check
npm test
npm run package
code --install-extension copilot-sdk-sdlc-darwin-arm64-0.7.2.vsix --force
```

Packaging targets the current host platform and architecture because the SDK
includes a native runtime. Build on the appropriate host for other platforms.
Open this repository and press F5 to develop the extension. Reload existing VS
Code windows after installing an update.

1. Open the project where you want the harness.
2. Run **SDLC: Initialize project harness**, or explicitly ask Copilot to use
   `sdlc_initialize`. No project files are created on activation.
3. Run **SDLC: Open workbench** or click **SDLC** in the status bar.
4. Configure meaningful quality gates in `.copilot-sdlc/config.json`.
5. Prepare requirements, approve implementation, then select **Implement**.
   After handoff, **Verify** runs an independent verifier.

SDK authentication uses Copilot CLI credentials/environment. Runtime state stays
in `.copilot-sdlc/runtime/`. If authentication is unavailable, sign in to Copilot
CLI on the same host. `copilotSdlc.cliPath` selects an optional CLI executable;
`copilotSdlc.pythonPath` selects Python. Keep secrets out of project configuration.

## Copilot master and studio

Use ordinary Copilot chat to develop an idea with the human. Record an initiative,
make a quick Fibonacci estimate and choose a focused research team. Research also
applies at <=13; estimates >13 require a decomposition slice. Specialists gather
facts, propose requirements or return a prototype. The master and human refine
these outputs into an accepted specification and a backlog.

| Tool | Purpose |
| --- | --- |
| `sdlc_suggest_tasks` | Publish editable task drafts after user-requested skill/research work |
| `sdlc_studio` | Read taxonomy, records, revisions and relationships |
| `sdlc_initiatives` | Capture a brief, initial estimate and uncertainty |
| `sdlc_specs` | Version requirements and acceptance criteria |
| `sdlc_artifacts` | Save reports, HTML prototypes and decisions |
| `sdlc_research` | Start, inspect and stop a bounded specialist team |
| `sdlc_backlog` | Refine proposals, decompose scope and promote ready proposals |
| `sdlc_initialize` | Explicitly initialize project-owned harness files |
| `sdlc_tasks` | List/read tasks, select next work, reserve paths and run gates |
| `sdlc_update_task` | Create/update tasks, approve work and recover interrupted runs |
| `sdlc_questions` | Record questions and human answers |
| `sdlc_lessons` | Record recurrence and independent confirmation |
| `sdlc_metrics` | Read task ledgers, configuration and usage |
| `sdlc_run` | Start one explicitly requested work-item session |
| `sdlc_project_tool` | Discover and invoke project-defined tools |

Research returns immediately. Poll `status` for partial reports and live sessions;
status polling needs no mutation confirmation. Stop cancels the team and queued
members. Restart never automatically launches model calls. Budgets cover duration,
reported tokens and concurrency; in-flight calls can overshoot a reported limit.

Prototypes are discussion artifacts, not accepted requirements or verified
implementation. Accepting requirements is separate from implementation approval.
Promotion is idempotent and creates an **unapproved** work item. Ready proposals
pin an accepted specification revision, have requirements and a Fibonacci estimate
<=13. Editing accepted requirements invalidates acceptance. See `docs/studio.md`
for tool examples, decomposition, proposal dependencies and persistence details.

## Single workbench

The Linear-inspired workbench uses VS Code theme colors:

- Task list or compact board on the left; task details and live session on the right.
- Module-provided usage and studio summaries above the task list.
- Module discovery under **Modules**, with data files and **Refresh** in the menu.

There are no separate metrics, history or session tabs. One panel is reused per
project and reconnected after editor restart. Refresh displays progress and a
completion timestamp. Selection, stream following and transcript scroll position
are retained. Selecting a research session shows its transcript in the same panel.

Live output includes public responses, tool arguments/results, errors, usage and
elapsed time. Select a run, stop it, open its TSV log or report, and disable
**Follow stream** to read earlier output. Older sessions have their saved reports
and usage without fabricated historical streaming data. The preview retains the
latest 300 entries; log text is capped at 8 MB per session. Reasoning internals
and binary payloads are excluded.

## Project-owned files

```text
.copilot-sdlc/
  config.json                   models, limits, executors and gates
  config.schema.json
  tools/*.json                  custom tools
.github/
  copilot-instructions.md
  agents/sdlc-*.agent.md         editable role definitions
  skills/sdlc-studio/SKILL.md    normal Copilot master's workflow
.work-item/
  README.md
  TEMPLATE.md
  tasks.tsv                     implementation work items
  history.tsv
  metrics.tsv
  questions.tsv
  lessons.tsv
  runs.tsv
  WI-NNN.md                     requirements, handoffs and verdicts
  reports/
  live/                         timestamp, event, JSON data
  checks/                       committed-snapshot gate results
  studio/records.tsv            studio taxonomy and relationships
  studio/docs/                  immutable Markdown/HTML revisions
tools/work-items.py
```

Initialization is additive and preserves existing files and custom agents. An
incompatible `tools/work-items.py` is detected before any writes. Legacy task
formats are not migrated automatically. Unknown estimates remain unknown in new
harnesses; studio promotion always supplies an explicit final estimate.

## Extend the workbench

**SDLC: Create companion module** generates a standalone extension on request,
including public types, a tool, task widget, action, optional executor and VSIX
build. It never overwrites an existing directory.

```sh
npm run example:package
```

Companions call `api.registerModule(...)` and declare a dependency on the main
extension. Widgets use the existing workspace/task slots. Registration is atomic;
unregistering removes the module's tools, widgets, actions and executors together.
Optional `onDispose` (host >=0.5) stops module-owned work. Trusted companion code
runs in the Extension Host without process isolation.

Project tools use JSON Schema plus an argv command, without shell interpolation:

```json
{
  "name": "project_check",
  "displayName": "Project check",
  "description": "Run the project's requested check.",
  "readOnly": false,
  "inputSchema": { "type": "object", "additionalProperties": false },
  "command": ["node", "tools/check.mjs"],
  "timeoutSeconds": 30
}
```

Create the script only on request. Definitions are read when invoked and before
agent sessions; arguments are validated. Native Copilot tools use VS Code's own
confirmation policy. Session permission mode defaults to `bypass`, including
older projects without an explicit setting. It applies to SDK permissions and
project tools inside sessions; it does not grant workflow approval to an agent.
Research uses read-only capabilities regardless of this implementation setting.

## Replaceable executors and role routing

**Modules → Select default executor…** writes the project selection. Executors
implement `AgentExecutor.createSession` and expose `run`, `abort` and `dispose`.
They report neutral events; the core handles scope, limits, logs and reports.

```json
"execution": {
  "default": "copilot-sdk",
  "roles": { "planner": "acme.local" },
  "options": { "acme.local": { "endpoint": "http://127.0.0.1:8000" } }
}
```

Selection precedence: explicit override → agent front matter → role configuration
→ project default → Copilot SDK. A missing executor fails clearly without silently
switching providers. `examples/quality` includes an opt-in executor that makes no
AI calls and does not implement or approve tasks.

Task actions come from status, not a picker containing every agent:

| Status | Default actions |
| --- | --- |
| Ready | Plan; Implement after approval |
| Active | Continue |
| Changes requested | Fix |
| Review | Verify |
| Blocked / Accepted / Closed | None |

Override role ordering through `workflow.agentsByStatus`. An omitted status uses
the default; an empty list disables agents. The first enabled role is primary.
The UI, API and session preflight apply the same policy. Open runs, unanswered
questions, dependencies, task ownership and missing approval disable actions with
an explanation. A completed model response does not accept or close a task.

## Consistency, gates and usage

The Python harness serializes mutations, uses atomic writes and recovers interrupted
transactions. Scope, reservations and task ownership prevent conflicting agent
work, but do not sandbox the user's operating system or block manual editor changes.
Workspace Trust is required for Python, project tools and agent execution.

Handoff requires passing configured gates for the task's current commit and
requirement-by-requirement evidence. A failing gate clears the earlier passing
mark. Empty gate configuration cannot manufacture a pass. Workers cannot accept
their own work or answer for the human. The verifier records independent evidence.
The studio keeps planning separate from execution. The optional monitor workflow
module coordinates at most three worker/judge rounds for an approved mapped task,
using the same commit-bound gates. Unarmed requests wait for UI approval; an
explicit native grant can authorize future matching monitor events.

SDK usage is deduplicated by event ID. Reported token counts and actual models are
stored per run. `assistant.usage.cost` is premium-request units, not USD; historical
storage uses `premium_requests`. Monetary cost stays unknown unless explicitly
reported. Default sessions allow 900 seconds and 60,000 output tokens.
`session.maxPremiumRequests: null` disables the optional premium-unit ceiling;
existing explicit ceilings remain respected. Limits preserve partial responses
and show the reason and configuration key. Reported limits may be exceeded by
calls already in flight. Idle completion and graceful shutdown have recovery paths
for unresponsive SDK completion/shutdown RPCs.

## Architecture and verification

`contracts` and `domain` contain data and pure rules. `application` coordinates
ports, registries and sessions. `features` provides registered modules.
`infrastructure` handles storage/Python/processes; `integrations` contains provider
adapters. VS Code and browser code live in `host` and `ui`. `bootstrap` wires
implementations. Boundary checks reject forbidden imports and dependency cycles.
Public API version 1 and compatibility SDK import paths remain supported.

```sh
npm run check
npm test
npm run build
npm run example:package
npm run test:extension
npm run package
```

Set `VSCODE_EXECUTABLE_PATH` to use an installed VS Code for Extension Host tests;
otherwise the test runner downloads one. Controlled executors validate behavior
without paid model calls. `npm run demo` explicitly creates a separate sample
project, preserving an existing demo; initial history and usage are synthetic.


## Connected services and monitors

Jira Server/Data Center, Confluence, Bitbucket Server and GitHub adapters support
credential profiles in native settings, deterministic polling, a durable change feed
and a supervised workflow inbox in the same workbench. Read the
[integration guide](docs/integrations.md) for examples and provider limits.

Monitoring itself makes no model calls. A locally authorized monitor can start
a bounded refinement squad or implementation/review loop; otherwise requests await
human review. Publishing uses a separate native confirmation of the complete
destination and payload, independent of executor permission bypass.

The [integration review record](docs/integration-review.md) documents all three review cycles and verification limits.

## Copilot tool skill and settings

The project-owned `.github/skills/harness-workbench/SKILL.md` includes a concrete
reference for all 18 native tools and example inputs. Explicitly initialize an
existing project again to add this new skill; existing files are preserved.
Prefer native `sdlc_tasks` and `sdlc_metrics` calls over terminal commands.
The custom `project_info` command remains subject to its own confirmation.

Settings contains **Review Copilot settings patch**, which previews a folder-scoped
change only when agent skills are disabled. It preserves terminal and publication
approvals. See [Copilot settings](docs/copilot-settings.md).

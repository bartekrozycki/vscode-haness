# Copilot master, research and backlog

The master is the user's normal VS Code Copilot conversation. The extension
provides tools and bounded specialist execution; it does not replace that chat
with a hidden planner. Read `sdlc_studio` with operation `taxonomy` first.

## Taxonomy

| Entity | Identity | Meaning / states |
| --- | --- | --- |
| Initiative | INI | Human brief and evolving scope: draft, exploring, defined, archived |
| Specification | SPEC | Versioned requirements: draft, review, accepted, superseded |
| Proposal | PROP | Backlog candidate: draft, ready, promoted, discarded |
| Report | REP | Evidence, risks and questions: draft, reviewed |
| Prototype | PROTO | Discussion artifact: draft, reviewed, discarded |
| Decision | DEC | Human decision record: proposed, accepted, superseded |
| Research team | TEAM | Bounded process: running, completed, failed, cancelled; interrupted/external ownership projections |
| Work item | WI | Existing implementation workflow with separate human approval |
| Session | UUID | One executor invocation; team session IDs link to live TSV logs |

Specifications, proposals and artifacts belong to an initiative. Proposals can
reference a parent proposal for decomposition and `dependsOnProposals` for
ordering. Promotion resolves dependencies to work-item IDs. Prototypes do not
imply accepted requirements; accepted requirements do not authorize implementation.
Editing an accepted specification/decision invalidates acceptance unless the
human explicitly accepts the new revision. Ready proposals pin a spec revision.

## Tools for ordinary Copilot

- `sdlc_studio`: taxonomy, filtered list and full record read.
- `sdlc_initiatives`: create/revise brief, quick Fibonacci estimate and rationale.
- `sdlc_specs`: create/revise requirements and acceptance criteria.
- `sdlc_artifacts`: save reports, prototypes and decisions; `data.format: html`
  writes versioned HTML for prototypes, otherwise Markdown.
- `sdlc_research`: start/status/stop, including partial specialist results.
- `sdlc_backlog`: create/revise proposals and promote ready proposals.

These are native VS Code language-model tools, alongside the existing eight
work-item tools. No companion extension or MCP server is needed for the master.
The project-owned `sdlc-studio` skill is added on explicit harness initialization;
initialization preserves existing project files. No studio files are created
by activation or read-only discovery.

## Example conversation flow

After the user requests preparing an initiative, the master creates a brief:

```json
{"operation":"create","title":"Checkout flow","estimate":8,
 "body":"Goal: ...\nQuick estimate: 8; reuse existing UI. Uncertainty: payment contract."}
```

For `sdlc_research`, the master chooses composition and assigns non-overlapping
slices. Small initiatives still receive research; there is no fixed head count
based on points. More than 13 requires an explicit decomposition purpose.

```json
{"operation":"start","initiative":"INI-001",
 "plan":"Two specialists: existing UI behavior and backend contract.",
 "maxParallel":2,"timeoutSeconds":300,"maxTokens":60000,
 "members":[
  {"role":"specify","purpose":"research","focus":"UI behavior and existing tests"},
  {"role":"specify","purpose":"research","focus":"Backend contract and every write path"}
 ]}
```

Start returns immediately. Poll with `{"operation":"status","id":"TEAM-001"}`.
Read reports, discuss their findings, and launch focused follow-up teams as needed.
To explore an interface, assign `role: prototype`, `purpose: prototype` and a
concrete brief. It returns HTML as an artifact, without modifying implementation
files. Open the returned file in the editor/browser as appropriate.

`specify` gathers facts, `design` proposes requirements/decomposition, `prototype`
crafts a standalone artifact. The project may override `.github/agents/sdlc-ROLE.agent.md`;
otherwise bundled definitions apply. Native research tools remain read-only.
Research tools cannot mutate tasks, approve, answer for the human, run gates,
start nested teams or edit project code. External executors are trusted extension
code and must honor the same contract.

Once discussed, save a spec and accept it only on the human's explicit decision.
Every revision uses the current `id` and `revision` returned by read. A proposal:

```json
{"operation":"create","parent":"INI-001","title":"Payment confirmation",
 "estimate":5,"status":"ready","body":"W1: ...\nAcceptance: ...",
 "data":{"specification":"SPEC-001","parentProposal":"PROP-001",
         "dependsOnProposals":["PROP-002"]}}
```

Ready proposals require nonempty requirements, an accepted spec and a final
Fibonacci estimate <=13. Promote dependencies first, then use
`{"operation":"promote","id":"PROP-003","revision":1}`. Promotion is idempotent,
records the source spec revision and creates an **unapproved** work item. The
existing worker/gates/judge tools handle implementation; studio does not add an
automatic delivery loop.

## Persistence and lifecycle

`.work-item/studio/records.tsv` stores identities, types, relationships, revisions,
status and JSON metadata using standard quoted TSV. Immutable documents are in
`.work-item/studio/docs/`; prior revisions remain available. Writes use a
cross-process lock and atomic ledger replacement. A crashed writer's lock is
retained with `owner.json` for inspection; never remove it while its owner is live.

Research persists run IDs before model execution, reports per finished member,
usage and final outcome. `sdlc_research status` distinguishes locally controllable,
external and interrupted teams. Restart never automatically launches model calls.
Read saved evidence and explicitly start a new team to continue. Stop cancels the
whole team, including queued members. The live panel's “Stop team” does the
same. Token budgets count provider-reported input/output across members; concurrent
in-flight calls can overshoot the ceiling before reporting usage. Cost is not
invented when the provider does not report it.

## Architecture

- `contracts/studio.ts`: record and persistence port.
- `application/studio/notebook.ts`: versioning, relationships and promotion.
- `application/studio/research.ts`: bounded teams, executor routing and live logs.
- `infrastructure/studio/store.ts`: filesystem, quoted TSV and immutable documents.
- `features/studio/`: tool contracts, default specialist roles and module factories.
- `bootstrap/catalog.ts`: native-tool manifest aggregation.

`core.backlog`, `core.research` and `core.artifacts` are separately registered
modules. They use the same public contribution format as companion extensions.
Modules can now implement optional `onDispose` (host >=0.5) to stop owned work.
Executors stay replaceable and use project model/routing/options configuration.
The existing single workbench shows studio summaries and research transcripts.

# SDLC tool reference

All tools accept optional `workspacePath` (absolute path; useful with multiple workspaces). Inputs below are JSON objects passed to the named tool, not shell commands. IDs and connection names in examples are illustrative; use IDs returned by the tools. Fields listed as optional by the outer schema can still be required by a particular operation. Read current state and errors for operation-specific requirements.

## Work items and sessions

- `sdlc_initialize`: `{}` initializes only on explicit request and preserves existing files.
- `sdlc_tasks`: `operation` is `list`, `read`, `next`, `reserve`, or `gates`; optional `id`, `role` (`worker` or `judge`), `status`, `files` (string array), `commit`. Reserve and gates mutate state; gates run configured checks on a clean Git commit.
- `sdlc_update_task`: `operation` is `create`, `update`, `approve`, `unblock`, or `recover_run`; fields `id`, `title`, `requirements`, `priority` (MUST/SHOULD/COULD), `area`, `estimate` (integer 1–55), `dependencies` (IDs), `status` (ready/active/review/changes/accepted/closed/blocked), `commit`, `evidence`, `reason`, `run`. Approval requires explicit human request; handoff requires passing gates and evidence.
- `sdlc_questions`: `operation` ask/answer and `id`; ask uses `question`, `options` (key-to-description object), `recommended`; answer uses `question_id` and the human-provided `answer`.
- `sdlc_lessons`: `operation` lesson/lesson_update and `id`; lesson fields `rule`, `evidence`, `weight` (high/medium/low), `kind`, `phase`, `target`; update `status` recur/implemented. Recurrence thresholds are 1/2/3 respectively; implementation confirmation is independent.
- `sdlc_metrics`: `{}` reads configuration, tasks, questions, lessons, runs and usage. Unknown cost is not zero.
- `sdlc_run`: `id` and `role`, optional `prompt`, `executor`. Start one fresh session only at user request; check `sdlc_metrics` agentActions and prior human worker approval.
- `sdlc_project_tool`: `operation` list/invoke, with `name` and object `input` for invoke. List first and use returned schema; definitions use argv without shell interpolation.

Example: `sdlc_update_task` with `{"operation":"create","title":"Add search","requirements":"Support search by title. Acceptance: matching results are shown.","priority":"SHOULD","estimate":3}`. Then use the returned ID with `sdlc_tasks` `{"operation":"read","id":"WI-001"}`. Approval and session execution are separate actions.

## Studio and research

- `sdlc_studio`: `operation` taxonomy/list/read; optional `id`, `kind` (initiative/specification/report/prototype/decision/proposal/research), `parent`.
- `sdlc_initiatives`, `sdlc_specs`, `sdlc_artifacts`: `operation` create/revise; shared fields `id`, `revision`, `parent`, `title`, `body`, `status`, Fibonacci `estimate` (1,2,3,5,8,13,21,34,55), `data`. Artifacts also use `kind` report/prototype/decision. Specs support draft/review/accepted/superseded; only explicit human acceptance permits accepted. Artifacts' statuses: report draft/reviewed; prototype draft/reviewed/discarded; decision proposed/accepted/superseded. Prototype `data.format` of `html` saves HTML.
- `sdlc_backlog`: create/revise/promote with the shared fields. A ready proposal requires estimate at most 13 and `data.specification` identifying an accepted spec. `data.dependencies` holds existing work item IDs; `data.dependsOnProposals` references proposals to promote first; `data.parentProposal` links decomposition children. Promotion creates an unapproved work item.
- `sdlc_research`: `operation` start/status/stop; `id`, `initiative`, `title`, `plan`, `maxParallel` (1–5), `maxTokens` (1–1000000), `timeoutSeconds` (5–1800), `members` (1–5 objects with `role` specify/design/prototype, `focus`, `purpose` research/design/decomposition/prototype, optional `executor`). Start returns immediately; status shows partial reports, usage and artifacts; stop cancels the team. Research agents cannot implement or approve; estimates above 13 require decomposition.
- `sdlc_suggest_tasks`: `source` and `suggestions` (1–20 objects with `title`, `requirements`, optional Fibonacci `estimate`); creates drafts for review following requested skill/research work.

Example `sdlc_research`: `{"operation":"start","initiative":"INIT-1","title":"Explore search","plan":"Compare options and acceptance risks","maxParallel":1,"maxTokens":10000,"timeoutSeconds":300,"members":[{"role":"specify","focus":"Search requirements","purpose":"research"}]}`. Use the returned team ID in `{"operation":"status","id":"RESEARCH-1"}`. Limits bound research; they do not grant human approval or SDK permissions.

## Connections, monitors and automation

- `sdlc_connections`: `operation` list/search/read/pullRequests/readPullRequest/comments/reviewComments; non-list operations require `connectionId` and provider-specific `params`. Each response is one bounded page; Atlassian uses `start` and `limit`, GitHub `page` and `limit`. These are read-only operations.
- `sdlc_monitors`: `operation` list/events/define/activate/pause/poll; `id` identifies a monitor and `definition` is a locally authored object. Definitions require `id`, `name`, `provider` (jira/github/bitbucket), `connectionId`, `query`, and `intervalSeconds` (60–86400). Jira query requires `jql`; GitHub requires `owner`, `repo`, `pullRequestId`; Bitbucket requires `project`, `repo`, `pullRequestId`. Optional query `label` and `commentContains` are subject to provider restrictions. Optional `action` uses `kind` refine/implement, respectively `researchFocus` or `taskId`, optional `armed`, `estimate`, `timeoutSeconds`, `maxTokens`, `maxParallel`. Armed definitions require explicit host authorization. Implement cannot use Bitbucket or a comment filter and requires the exact `hanes-implement` label; first polling establishes baseline. Unarmed triggers remain pending for a direct human host action. Armed triggers require a prior explicit native host grant bound to the matching definition and trigger; ordinary human task approval still applies.
- `sdlc_automation`: `operation` list/propose/dismiss; dismiss uses `id`. Propose uses `proposal` with `connectionId`, `operation` (create/update/createPullRequest/createComment), `params` object, and, for pull requests, `taskId` of an accepted delivery task. Proposals are frozen and run only via direct human host action.

Example `sdlc_monitors`: `{"operation":"define","definition":{"id":"issues","name":"Issue research","provider":"jira","connectionId":"jira-main","query":{"jql":"project = EXAMPLE"},"intervalSeconds":300,"action":{"kind":"refine","researchFocus":"Clarify requirements","maxTokens":10000,"timeoutSeconds":300,"maxParallel":1}}}`. Activate with `{"operation":"activate","id":"issues"}` and inspect events with `{"operation":"events","id":"issues"}`. A monitor event is not approval.

Example `sdlc_automation`: `{"operation":"propose","proposal":{"connectionId":"github-main","operation":"createComment","params":{"owner":"example","repo":"app","pullRequestId":1,"body":"Proposed update"}}}`. Check provider parameters and the frozen proposal before the human runs it.

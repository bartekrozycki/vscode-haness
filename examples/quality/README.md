# Quality

A standalone companion extension for Copilot SDLC. `src/extension.ts` contributes
a tool, task widget and action; `src/executor.ts` demonstrates an opt-in executor
that makes no model calls. The main extension does not need source changes.

```sh
npm install
npm run check
npm run package
```

Install Copilot SDLC 0.4+ first. Change `publisher` before publishing to the
Marketplace; local VSIX files can be distributed directly. API version 1 types
are in `sdk/api.d.ts`. Register handles and listeners in `context.subscriptions`.
Call `api.refresh(root)` after changing module-owned data. Start AI sessions only
in response to an explicit user request.

Select the example executor under **Modules → Select default executor…**, or
configure one role:

```json
"execution": { "roles": { "planner": "example.quality.echo" } }
```

Replace `createSession` with your CLI/SDK integration. Honor cancellation during
creation and execution; implement `abort` and `dispose`. The core supplies logs,
reports, metrics and the shared workbench. Executors do not run on activation.

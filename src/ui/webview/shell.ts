import { randomBytes } from 'node:crypto';
import type { Snapshot } from '../../contracts/model';
import type { LiveSession } from '../../contracts/live';
import { dashboardStyles } from './styles';
/** Shell only. Features contribute data; project values always use textContent. */
export function dashboardHtml({ cspSource, snapshot, error, live = [], initialTab, script: webviewScript }: {
    cspSource: string;
    script: string;
    snapshot?: Snapshot;
    error?: string;
    live?: LiveSession[];
    initialTab?: string;
}): string {
    const nonce = randomBytes(18).toString('base64');
    const json = JSON.stringify({ snapshot, error, live, initialTab }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
${dashboardStyles}</style></head><body><div class="app">
<header><span class="mark" aria-hidden="true">◈</span><div class="brand"><h1>SDLC</h1><span id="project">Workspace</span></div><div class="header-actions"><button id="show-onboarding" class="ghost hidden">Get started</button><button id="settings" class="ghost">Settings</button><button id="monitors" class="ghost">Monitors</button><button id="modules" class="ghost">Modules</button><details class="source-menu"><summary aria-label="Data files and refresh">•••</summary><div><button data-action="refresh">Refresh</button><button data-table="tasks">tasks.tsv</button><button data-table="metrics">metrics.tsv</button><button data-table="runs">runs.tsv</button><button data-table="questions">questions.tsv</button><button data-table="lessons">lessons.tsv</button><button data-table="history">history.tsv</button></div></details><button class="primary" data-action="create">+ Task</button></div></header>
<div id="notice" role="status" aria-live="polite"></div><section id="onboarding" class="onboarding hidden" aria-labelledby="onboarding-title"><div><button id="dismiss-onboarding" class="ghost onboarding-dismiss" aria-label="Dismiss getting started">✕</button><p class="eyebrow">Get started</p><h2 id="onboarding-title">Bring your project into the workbench</h2><p id="onboarding-description" class="muted">Initialize a project-owned harness to track tasks, decisions, and agent sessions. Existing files are preserved.</p><div class="onboarding-actions"><button id="initialize" class="primary">Initialize project</button><button id="suggest-tasks">Suggest starter tasks</button></div><p class="muted hint">Suggestions are optional drafts. Review and edit them before creating tasks.</p></div><div id="suggestion-area" aria-live="polite"></div></section><section id="workspace-summary" class="workspace-summary" aria-label="Project summary"></section>
<main class="workbench"><section class="work-list" aria-label="Tasks"><div class="list-heading"><h2>Tasks <span id="task-count" class="count"></span></h2><div class="segmented" aria-label="Task layout"><button id="list-mode" aria-pressed="true">List</button><button id="board-mode" aria-pressed="false">Board</button></div></div><div class="filter-wrap"><input id="filter" aria-label="Filter tasks" placeholder="Search tasks…"></div><div id="tasks"></div></section><aside id="inspector" class="inspector" aria-label="Details and session"></aside></main>
<footer><span id="refresh-status" role="status" aria-live="polite"></span> Files belong to the project <span aria-hidden="true">·</span> TSV + Markdown</footer></div>
<dialog id="studio-dialog" aria-labelledby="studio-title"><div class="dialog-heading"><h2 id="studio-title">Record</h2><button id="close-studio" class="ghost" aria-label="Close record">✕</button></div><div id="studio-content"></div></dialog>
<dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-heading"><div><p class="eyebrow">Workbench</p><h2 id="settings-title">Settings</h2></div><button id="close-settings" class="ghost" aria-label="Close settings">✕</button></div><div id="environment-content"><p class="muted">Checking environment…</p></div></dialog>
<dialog id="monitor-dialog" aria-labelledby="monitor-title"><div class="dialog-heading"><div><p class="eyebrow">Workbench</p><h2 id="monitor-title">Monitors</h2></div><button id="close-monitors" class="ghost" aria-label="Close monitors">✕</button></div><p class="muted">Changes are evidence. Requests require the configured workflow and approval.</p><div id="monitor-content"></div><h3>Connections</h3><div id="connection-content"></div><h3>Workflow requests</h3><div id="automation-content"></div></dialog>
<dialog id="module-dialog" aria-labelledby="module-title"><div class="dialog-heading"><h2 id="module-title">Modules</h2><button id="close-modules" class="ghost" aria-label="Close modules">✕</button></div><p class="muted">Tools, actions, data and session executors.</p><button data-action="selectExecutor" class="small">Select default executor…</button><div id="module-list"></div></dialog>
<script nonce="${nonce}">const payload=${json};
${webviewScript}
</script></body></html>`;
}

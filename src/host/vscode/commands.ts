import * as vscode from 'vscode';
import path from 'node:path';
import type { AppServices } from '../../application/services';
import type { ProjectConfig, Snapshot } from '../../contracts/model';
import { validateExecution } from '../../domain/execution-policy';
import type { WorkspaceAccess } from './workspace';
import type { Workbench } from './workbench';
export function createCommands(services: AppServices, workspace: WorkspaceAccess, workbench: Workbench, snapshot: (folder: string) => Promise<Snapshot | undefined>) {
    const { root, trust, approve } = workspace;
    const changed = (folder?: string) => services.modules.emit({ type: 'workspace.changed', root: folder });
    async function setup(folder: string) { trust(); const result = await services.projects.initialize(folder); changed(); void vscode.window.showInformationMessage(`SDLC: created ${result.created.length} files, preserved ${result.preserved.length}.`); return result; }
    async function createTask(folder: string) {
        trust();
        const title = await vscode.window.showInputBox({ title: 'New SDLC task', prompt: 'Task title', ignoreFocusOut: true });
        if (!title)
            return;
        const requirements = await vscode.window.showInputBox({ title: 'Requirements and acceptance criteria', prompt: 'After creation, expand the requirements in the Markdown document.', ignoreFocusOut: true });
        if (!requirements)
            return;
        const result = await services.projects.open(folder).invoke<{
            id: string;
            document: string;
        }>({ operation: 'create', title, requirements, actor: 'user' });
        await vscode.window.showTextDocument(vscode.Uri.file(await services.files.resolve(folder, result.document)));
        changed();
    }
    async function createModule() {
        trust();
        const id = await vscode.window.showInputBox({ title: 'New SDLC module', value: 'my-team.quality', prompt: 'Publisher and module ID', validateInput: value => /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(value) ? undefined : 'Use publisher.module, for example acme.quality.' });
        if (!id)
            return;
        const target = await vscode.window.showSaveDialog({ title: 'New extension directory', defaultUri: vscode.Uri.file(path.join(await root(), `sdlc-${id.split('.')[1]}`)), saveLabel: 'Create module' });
        if (!target || target.scheme !== 'file')
            return;
        await services.scaffold(target.fsPath, id);
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(target.fsPath, 'README.md')));
    }
    async function selectExecutor(requestedRoot?: string) {
        trust();
        const folder = await root(requestedRoot), client = services.projects.open(folder);
        if (!(await client.initialized()))
            throw new Error('Initialize the project harness first.');
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(await services.files.resolve(folder, '.copilot-sdlc/config.json')));
        const selected = await vscode.window.showQuickPick(services.modules.executors.list().map(e => ({ label: e.title, description: e.id, detail: e.description, id: e.id })), { title: 'Default session executor for this project' });
        if (!selected)
            return;
        // Read again after the picker to preserve edits made while it was open.
        const current = JSON.parse(document.getText()) as ProjectConfig;
        current.execution = { ...current.execution, default: selected.id };
        validateExecution(current);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), JSON.stringify(current, null, 2) + '\n');
        if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save()))
            throw new Error('Could not save the executor selection.');
        changed(folder);
    }
    async function run(folder: string, id?: string, role?: string) {
        trust();
        const state = await snapshot(folder);
        if (!state)
            throw new Error('Initialize the project harness first.');
        if (!id) {
            const tasks = state.tasks.filter(t => state.agentActions?.[t.id]?.some(a => a.enabled));
            if (!tasks.length)
                throw new Error('No tasks currently have an available agent action. Check statuses, approvals and blockers.');
            id = (await vscode.window.showQuickPick(tasks.map(t => ({ label: t.id, description: t.title })), { title: 'Task for the agent' }))?.label;
        }
        if (!id)
            return;
        const actions = state.agentActions?.[id] || [];
        role ||= actions.find(a => a.enabled)?.role;
        const action = actions.find(a => a.role === role);
        if (!action?.enabled)
            throw new Error(action?.reason || 'No agent is available for the current task status.');
        await workbench.open(folder, { item: id });
        // The workbench owns progress and cancellation; a second, persistent
        // notification obscures the live session and has no independent state.
        await services.runner.run({ id, role }, { root: folder, approve });
    }
    async function changeStatus(folder: string, id: string) {
        trust();
        const client = services.projects.open(folder);
        const row = await client.invoke<{
            status: string;
            executor: string;
        }>({ operation: 'read', id });
        const transitions: Record<string, string[]> = { ready: ['active', 'blocked', 'closed'], active: ['review', 'blocked', 'ready'], review: ['accepted', 'changes', 'blocked'], changes: ['active', 'blocked', 'closed'], accepted: ['closed', 'changes'], blocked: ['ready', 'active', 'changes', 'closed'], closed: ['ready'] };
        const status = await vscode.window.showQuickPick(transitions[row.status], { title: `${id}: ${row.status} →` });
        if (!status)
            return;
        const request: Record<string, unknown> = { operation: 'update', id, status, actor: 'user' };
        if (status === 'blocked') {
            request.reason = await vscode.window.showInputBox({ title: 'Blocker reason' });
            if (!request.reason)
                return;
        }
        if (['review', 'accepted', 'changes'].includes(status)) {
            request.evidence = await vscode.window.showInputBox({ title: 'Handoff / review evidence', ignoreFocusOut: true });
            if (!request.evidence)
                return;
            if (status === 'review') {
                request.commit = await vscode.window.showInputBox({ title: 'Commit with passing gates' });
                request.actor = row.executor;
                if (!request.commit)
                    return;
            }
        }
        await client.invoke(request as {
            operation: string;
        });
        changed();
    }
    const tables = ['tasks', 'history', 'metrics', 'questions', 'lessons', 'runs'];
    async function openTsv(folder: string, table?: string) {
        table ||= await vscode.window.showQuickPick(tables, { title: 'TSV file' });
        if (!table || !tables.includes(table))
            return;
        await vscode.window.showTextDocument(vscode.Uri.file(await services.files.resolve(folder, `.work-item/${table}.tsv`)));
    }
    async function handleAction(folder: string, message: Record<string, unknown>) {
        trust();
        const client = services.projects.open(folder);
        const id = typeof message.id === 'string' && /^WI-\d+$/.test(message.id) ? message.id : undefined;
        const runId = typeof message.run === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(message.run) ? message.run : undefined;
        switch (message.action) {
            case 'initialize':
                await setup(folder);
                break;
            case 'create':
                await createTask(folder);
                break;
            case 'stop':
                services.runner.stop(folder);
                services.research?.stopAll(folder);
                break;
            case 'stopSession':
                if (runId && !(services.runner.stop(folder, runId) || services.research?.stopRun(folder, runId)))
                    throw new Error('This session is not running in this window.');
                break;
            case 'openLiveLog':
            case 'openReport':
                if (runId && (await services.runner.sessions(folder, await snapshot(folder))).some(session => session.run === runId)) {
                    const relative = message.action === 'openLiveLog' ? `.work-item/live/${runId}.tsv` : `.work-item/reports/${runId}.md`;
                    const file = await services.files.resolve(folder, relative);
                    if (await services.files.exists(file))
                        await vscode.window.showTextDocument(vscode.Uri.file(file));
                    else
                        void vscode.window.showInformationMessage('This session has no saved report or log.');
                }
                break;
            case 'openTsv':
                await openTsv(folder, String(message.table));
                break;
            case 'openTask':
                if (id) {
                    const task = await client.invoke<{
                        document: string;
                    }>({ operation: 'read', id });
                    await vscode.window.showTextDocument(vscode.Uri.file(await services.files.resolve(folder, task.document)));
                }
                break;
            case 'approve':
                if (id)
                    await client.invoke({ operation: 'approve', id, actor: 'user' });
                break;
            case 'unblock':
                if (id)
                    await client.invoke({ operation: 'unblock', id, actor: 'user' });
                break;
            case 'run':
                if (id)
                    await run(folder, id, typeof message.role === 'string' ? message.role : undefined);
                break;
            case 'openConfig':
                await vscode.window.showTextDocument(vscode.Uri.file(await services.files.resolve(folder, '.copilot-sdlc/config.json')));
                break;
            case 'selectExecutor':
                await selectExecutor(folder);
                break;
            case 'status':
                if (id)
                    await changeStatus(folder, id);
                break;
            case 'answer':
                if (id && typeof message.question === 'string') {
                    const answer = await vscode.window.showInputBox({ title: `${id} / ${message.question}: answer`, ignoreFocusOut: true });
                    if (answer)
                        await client.invoke({ operation: 'answer', id, question_id: message.question, answer, actor: 'user' });
                }
                break;
            case 'recover':
                if (runId) {
                    if (services.runner.activeCount)
                        throw new Error('Stop active sessions in this window first.');
                    const reason = await vscode.window.showInputBox({ title: 'Confirm the session was interrupted and enter a recovery reason' });
                    if (reason)
                        await client.invoke({ operation: 'recover_run', run: runId, reason, actor: 'user' });
                }
                break;
        }
        changed(folder);
    }
    const commands: Record<string, (...args: any[]) => Promise<unknown> | unknown> = {
        createModule, selectExecutor,
        initialize: async () => setup(await root()), createTask: async () => createTask(await root()), run: async () => run(await root()),
        stop: () => { services.runner.stop(); services.research?.stopAll(); }, openTsv: async (table?: string) => openTsv(await root(), table), reload: async () => { await services.tools.definitions(await root()); changed(); },
        dashboard: async () => workbench.open(await root()), liveSessions: async () => { const folder = await root(); const sessions = await services.runner.sessions(folder, await snapshot(folder)); await workbench.open(folder, { run: (sessions.find(s => s.controllable) || sessions[0])?.run }); },
    };
    return { handlers: commands, handleAction };
}

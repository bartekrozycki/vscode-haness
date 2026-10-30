import { createMonitorAuthority } from '../host/vscode/monitor-authority';
import { createConnections } from './connections';
import { approveRemoteWrite } from '../host/vscode/remote-approval';
import { createIntegrationActions } from '../host/vscode/integration-actions';
import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import type { SdlcApi } from '../contracts/api';
import { createServices } from './services';
import { createWorkspaceAccess } from '../host/vscode/workspace';
import { createCommands } from '../host/vscode/commands';
import { createPublicApi } from '../host/vscode/public-api';
import { registerLanguageModelTools } from '../host/vscode/language-model-tools';
import { registerProjectWatcher } from '../host/vscode/project-watcher';
import { Workbench } from '../host/vscode/workbench';
import { createLaunchpadActions } from '../host/vscode/launchpad-actions';
import { catalog } from './catalog';
import { createEnvironmentController } from './environment';
export async function activate(extension: vscode.ExtensionContext): Promise<SdlcApi> {
    const script = await readFile(extension.asAbsolutePath('dist/webview.js'), 'utf8');
    const output = vscode.window.createOutputChannel('Copilot SDLC');
    const workspace = createWorkspaceAccess(output);
    const environment = createEnvironmentController(extension);
    const connections = createConnections(extension, approveRemoteWrite);
    const monitorAuthority = createMonitorAuthority({
        connections: connections.service,
        get: key => extension.workspaceState.get<string>(key),
        set: (key,value) => extension.workspaceState.update(key,value),
        review: async (_root,definition,connection) => {
            workspace.trust();
            const document = await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify({definition,connection},null,2)});
            await vscode.window.showTextDocument(document,{preview:false});
            return await vscode.window.showWarningMessage('Allow this monitor to start agent workflows automatically?', {modal:true,detail:'Review the complete definition, local task mapping, research estimate and budgets. Matching future changes may consume model usage. Publication always requires a separate confirmation.'}, 'Authorize monitor') === 'Authorize monitor';
        },
    });
    let workbench: Workbench;
    const services = createServices({
        connections: connections.service,
        authorizeMonitor: monitorAuthority.authorize,
        allowMonitorWorkflow: async (root,definition) => { workspace.trust(); return (vscode.workspace.workspaceFolders || []).some(folder => folder.uri.scheme === 'file' && folder.uri.fsPath === root) && await monitorAuthority.allows(root,definition); },
        resources: extension.asAbsolutePath('resources'), sdk: extension.asAbsolutePath('sdk'),
        python: () => vscode.workspace.getConfiguration('copilotSdlc').get<string>('pythonPath') || (process.platform === 'win32' ? 'python' : 'python3'),
        cliPath: root => vscode.workspace.getConfiguration('copilotSdlc', root ? vscode.Uri.file(root) : undefined).get<string>('cliPath') || '',
        processEnvironment: root => environment.processEnvironment(root),
        runtimeOptions: root => environment.runtimeOptions(root),
        publish: (root,message) => { workbench?.post(root,message); if (message.type === 'taskSuggestions') void workbench?.open(root); },
        beforeRun: async (_input, context) => workbench.open(context.root),
        host: {
            permission: async (request) => request.kind === 'read' || await workspace.approve(`The executor requests an operation ${request.kind}:\n${JSON.stringify(request)}`) ? { kind: 'approve-once' } : { kind: 'reject' },
            input: async (question, choices) => choices?.length ? vscode.window.showQuickPick(choices, { title: question }) : vscode.window.showInputBox({ title: question }),
            log: text => output.append(text),
            changed: () => services.modules.emit({ type: 'workspace.changed' }),
            liveChanged: root => { workbench?.liveChanged(root); services.modules.emit({ type: 'session.changed', root }); },
            started: (root, run) => { workbench?.liveChanged(root, run); services.modules.emit({ type: 'session.changed', root, run }); },
        },
    });
    const changed = () => services.modules.emit({ type: 'workspace.changed' });
    async function snapshot(root: string) {
        workspace.trust();
        return await services.projects.open(root).initialized() ? services.snapshot(root) : undefined;
    }
    let commands: ReturnType<typeof createCommands>;
    workbench = new Workbench({ snapshot, usage: services.usage, onReady: root => { const drafts=services.suggestions?.current(root);if(drafts)workbench.post(root,{type:'taskSuggestions',...drafts}); }, sessions: (root, state) => services.runner.sessions(root, state),
        action: createIntegrationActions({ services, trust: workspace.trust, post: (root,message) => workbench.post(root,message), credentials: connections.credentials, fallback: createLaunchpadActions({ services, environment, workspace, workbench: { post: (root, message) => workbench.post(root, message) },
            onboarding: { get: root => extension.workspaceState.get<boolean>(`onboarding.dismissed:${root}`, false), set: (root, dismissed) => extension.workspaceState.update(`onboarding.dismissed:${root}`, dismissed) },
            openFile: async path => vscode.window.showTextDocument(vscode.Uri.file(path)), fallback: (root, message) => commands.handleAction(root, message) }) }), log: error => output.appendLine(String(error)) }, services.modules, script);
    commands = createCommands(services, workspace, workbench, snapshot);
    extension.subscriptions.push(vscode.window.registerWebviewPanelSerializer('copilotSdlc.dashboard', {
        async deserializeWebviewPanel(panel) {
            const folder = vscode.workspace.workspaceFolders?.find(folder => panel.title === `SDLC · ${folder.name}`)?.uri.fsPath;
            panel.dispose();
            await workbench.open(folder || await workspace.root());
        },
    }));
    const moduleChanges = services.modules.onDidEvent(event => {
        if (event.type === 'workspace.changed')
            workbench.changed(event.root);
        if (event.type === 'modules.changed')
            workbench.changed();
    });
    extension.subscriptions.push(output, services, workbench, moduleChanges);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
    status.text = '$(layout) SDLC';
    status.tooltip = 'Open SDLC workbench';
    status.command = 'copilotSdlc.dashboard';
    status.show();
    extension.subscriptions.push(status);
    for (const [name, handler] of Object.entries(commands.handlers))
        extension.subscriptions.push(vscode.commands.registerCommand(`copilotSdlc.${name}`, workspace.guarded(handler)));
    registerLanguageModelTools(extension.subscriptions, catalog, services.tools, workspace, changed);
    registerProjectWatcher(extension.subscriptions, changed, root => workbench.liveChanged(root));
    const restored = new Set<string>();
    const restoreMonitors = async () => {
        if (!vscode.workspace.isTrusted) return;
        for (const folder of vscode.workspace.workspaceFolders || []) {
            if (folder.uri.scheme !== 'file' || restored.has(folder.uri.fsPath)) continue;
            const root = folder.uri.fsPath; restored.add(root);
            try { await services.automation?.reconcile(root, await services.monitors?.events(root) || []); await services.monitors?.start(root); }
            catch (error) { restored.delete(root); output.appendLine(String(error)); }
        }
    };
    extension.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => void restoreMonitors()), vscode.workspace.onDidChangeWorkspaceFolders(event => { for (const folder of event.removed) { services.monitors?.stopRoot(folder.uri.fsPath); restored.delete(folder.uri.fsPath); } void restoreMonitors(); }));
    await restoreMonitors();
    return createPublicApi(services, workspace, workbench, snapshot);
}

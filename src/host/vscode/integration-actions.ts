import * as vscode from 'vscode';
import type { AppServices } from '../../application/services';
import type { ConnectionMetadata } from '../../contracts/connections';
import type { MonitorDefinition } from '../../contracts/monitors';

interface Dependencies {
    services: AppServices;
    trust(): void;
    post(root: string, message: Record<string, unknown>): void;
    credentials: { setCredential(id: string): Promise<boolean>; deleteCredential(id: string): Promise<void> };
    fallback(root: string, message: Record<string, unknown>): Promise<void>;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
/** UI requests are routed here, independently of executor tool permission policy. */
export function createIntegrationActions(deps: Dependencies) {
    const { services, post } = deps;
    const monitorState = async (root: string, error?: string) => post(root, { type: 'monitors', monitors: await services.monitors?.list(root), events: await services.monitors?.events(root), error });
    const automationState = async (root: string, error?: string) => post(root, { type: 'automation', error, workflowActions: (await services.automation?.list(root) || []).map(request => ({ ...request, state: request.status, title: request.trigger?.taskId || request.trigger?.researchFocus || request.publication?.operation || request.kind })) });
    return async (root: string, message: Record<string, unknown>) => {
        const action = String(message.action);
        if (action.startsWith('connection')) {
            try {
                deps.trust(); if (!services.connections) throw new Error('Connections are unavailable.');
                if (action === 'connectionSave') await services.connections.save(message.metadata as ConnectionMetadata);
                else if (action === 'connectionCredential') await deps.credentials.setCredential(String(message.id));
                else if (action === 'connectionRemove') await services.connections.remove(String(message.id));
                else if (action !== 'connectionRead') throw new Error('Unknown connection action.');
                post(root, { type: 'connections', connections: await services.connections.list() });
            } catch (error) { post(root, { type: 'connections', error: errorText(error) }); }
            return;
        }
        if (action === 'monitorRead' || action === 'monitorAction') {
            try {
                deps.trust(); const engine = services.monitors; if (!engine) throw new Error('Monitors are unavailable.');
                if (action === 'monitorAction') {
                    if (message.operation === 'define') await engine.define(root, message.definition as MonitorDefinition);
                    else if (message.operation === 'activate') await engine.activate(root, String(message.id));
                    else if (message.operation === 'pause') await engine.pause(root, String(message.id));
                    else if (message.operation === 'poll') await engine.poll(root, String(message.id));
                    else throw new Error('Unknown monitor operation.');
                }
                await engine.start(root); await monitorState(root); await automationState(root);
            } catch (error) { post(root, { type: 'monitors', error: errorText(error) }); }
            return;
        }
        if (['automationRead', 'automationApprove', 'automationDismiss'].includes(action)) {
            try {
                deps.trust(); const queue = services.automation; if (!queue) throw new Error('Workflows are unavailable.');
                if (action === 'automationDismiss') await queue.dismiss(root, String(message.id));
                if (action === 'automationApprove') {
                    const request = (await queue.list(root)).find(r => r.id === message.id);
                    if (!request || request.status !== 'pending') throw new Error('Request is no longer pending.');
                    const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(request, null, 2) });
                    await vscode.window.showTextDocument(doc, { preview: false });
                    const approved = await vscode.window.showWarningMessage(`Start ${request.kind} workflow?`, { modal: true, detail: 'Review the full request in the JSON document. Agent workflows use the configured executor and budget. Remote publication requires a separate exact-request confirmation.' }, 'Start workflow');
                    if (approved === 'Start workflow') {
                        // Do not block the webview message loop while the supervised agent runs.
                        void queue.runApproved(root, request.id, request).then(() => automationState(root)).catch(error => post(root, { type: 'automation', error: errorText(error) }));
                    }
                }
                await automationState(root);
            } catch (error) { post(root, { type: 'automation', error: errorText(error) }); }
            return;
        }
        return deps.fallback(root, message);
    };
}

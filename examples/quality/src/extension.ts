import * as vscode from 'vscode';
import type { SdlcApi, Snapshot } from '../sdk/api';
import { echoExecutor } from './executor';

function summary(snapshot?: Snapshot, item?: string) {
  const tasks = snapshot?.tasks.filter(t => !item || t.id === item) || [];
  return {
    tasks: tasks.length,
    approved: tasks.filter(t => t.approved).length,
    blocked: tasks.filter(t => t.blocked || t.status === 'blocked').length,
    review: tasks.filter(t => t.status === 'review').length,
  };
}

export async function activate(context: vscode.ExtensionContext) {
  const base = vscode.extensions.getExtension<SdlcApi>('project-sdlc.copilot-sdk-sdlc');
  if (!base) throw new Error('Install Copilot SDLC first.');
  const api = await base.activate();
  if (!api.executors) throw new Error('Copilot SDLC 0.4+ is required for executor modules.');
  if (api.version !== 1) throw new Error('Unsupported Copilot SDLC API version.');
  context.subscriptions.push(api.registerModule({
    apiVersion: 1, id: 'example.quality', title: 'quality', version: '0.1.0',
    description: 'Example task tool, data and action contributions.',
    executors: [echoExecutor],
    tools: [{
      definition: { name: 'example_quality_summary', displayName: 'Task readiness', description: 'Read task readiness counts from the project harness.', readOnly: true,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
      invoke: async (input, ctx) => summary(await api.getSnapshot(ctx.root), String(input.id || ctx.item || '') || undefined),
    }],
    widgets: [{
      id: 'readiness', title: 'Task readiness', placement: 'task', order: 20,
      provide: ({ snapshot, item }) => {
        if (!snapshot) return undefined;
        const value = summary(snapshot, item);
        return { kind: 'text', text: value.blocked ? 'This task is blocked. Check decisions and dependencies.' : value.approved ? 'Implementation has been approved.' : 'This task is awaiting implementation approval.' };
      },
    }],
    actions: [{
      id: 'report', title: 'Readiness report', scope: 'task',
      run: async ({ snapshot, item }) => {
        const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify({ item, ...summary(snapshot, item) }, null, 2) });
        await vscode.window.showTextDocument(document, { preview: true });
      },
    }],
  }));
}

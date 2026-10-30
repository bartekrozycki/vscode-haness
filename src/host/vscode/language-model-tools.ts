import * as vscode from 'vscode';
import path from 'node:path';
import { toolMutates } from '../../application/tools/confirmation';
import type { ToolDefinition } from '../../contracts/model';
import type { ToolService } from '../../application/ports';
import type { WorkspaceAccess } from './workspace';
export function registerLanguageModelTools(subscriptions: vscode.Disposable[], catalog: ToolDefinition[], tools: ToolService, workspace: WorkspaceAccess, changed: () => void) {
    const { root, trust, approve } = workspace;
    for (const definition of catalog)
        subscriptions.push(vscode.lm.registerTool(definition.name, {
            async prepareInvocation(options) {
                const folder = await root((options.input as Record<string, unknown>).workspacePath);
                const mutation = toolMutates(definition, options.input as Record<string, unknown>);
                return { invocationMessage: `${definition.displayName} · ${path.basename(folder)}`, ...(mutation ? { confirmationMessages: { title: definition.displayName, message: new vscode.MarkdownString(`Project: \`${folder}\`\n\n${definition.description}`) } } : {}) };
            },
            async invoke(options, token) {
                trust();
                const input = options.input as Record<string, unknown>, folder = await root(input.workspacePath);
                const controller = new AbortController();
                const cancellation = token.onCancellationRequested(() => controller.abort());
                if (token.isCancellationRequested)
                    controller.abort();
                try {
                    const result = await tools.invoke(definition.name, input, { root: folder, approve, signal: controller.signal });
                    changed();
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
                }
                finally {
                    cancellation.dispose();
                }
            },
        }));
}

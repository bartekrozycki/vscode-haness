import * as vscode from 'vscode';
import type { ConnectionApproval } from '../../contracts/connections';

/** This capability stays in the native host; executor permission bypass cannot grant it. */
export async function approveRemoteWrite(request: ConnectionApproval): Promise<boolean> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before publishing.');
    const review = JSON.stringify(request, null, 2);
    const document = await vscode.workspace.openTextDocument({ language: 'json', content: review });
    await vscode.window.showTextDocument(document, { preview: false });
    return await vscode.window.showWarningMessage('Publish this exact request?', {
        modal: true,
        detail: `${request.connection.provider} · ${request.connection.baseUrl}\n${request.operation}\nReview the complete request in the open JSON document. This writes to the connected service.`,
    }, 'Publish request') === 'Publish request';
}

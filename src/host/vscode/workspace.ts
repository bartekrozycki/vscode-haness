import * as vscode from 'vscode';
import path from 'node:path';
export function createWorkspaceAccess(output: vscode.OutputChannel) {
    const trust = () => { if (!vscode.workspace.isTrusted)
        throw new Error('Trust this workspace before running its tools.'); };
    async function root(requested?: unknown): Promise<string> {
        const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'file') || [];
        if (typeof requested === 'string') {
            const folder = folders.find(f => path.resolve(f.uri.fsPath) === path.resolve(requested));
            if (!folder)
                throw new Error('workspacePath must refer to an open project folder.');
            return folder.uri.fsPath;
        }
        const active = vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
        if (active && folders.includes(active))
            return active.uri.fsPath;
        if (folders.length === 1)
            return folders[0].uri.fsPath;
        if (!folders.length)
            throw new Error('Open a local project folder in VS Code.');
        const selected = await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, description: f.uri.fsPath, root: f.uri.fsPath })), { title: 'SDLC project' });
        if (!selected)
            throw new Error('Project selection cancelled');
        return selected.root;
    }
    const approve = async (description: string) => (await vscode.window.showWarningMessage(description.slice(0, 4000), { modal: true }, 'Run')) === 'Run';
    const guarded = (action: (...args: any[]) => unknown) => async (...args: any[]) => {
        try {
            return await action(...args);
        }
        catch (error) {
            output.appendLine(String(error));
            void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    };
    return { root, trust, approve, guarded };
}
export type WorkspaceAccess = ReturnType<typeof createWorkspaceAccess>;

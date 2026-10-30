import * as vscode from 'vscode';
import path from 'node:path';
export function registerProjectWatcher(subscriptions: vscode.Disposable[], changed: () => void, liveChanged: (root: string) => void) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/{.work-item,.copilot-sdlc,.github/agents}/**');
    const fileChanged = (uri: vscode.Uri) => {
        const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
        if (folder && path.relative(folder, uri.fsPath).startsWith(`.work-item${path.sep}live${path.sep}`))
            liveChanged(folder);
        else
            changed();
    };
    subscriptions.push(watcher, watcher.onDidChange(fileChanged), watcher.onDidCreate(fileChanged), watcher.onDidDelete(fileChanged), vscode.workspace.onDidGrantWorkspaceTrust(() => changed()));
}

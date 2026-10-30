import * as vscode from 'vscode';

/** An opt-in proposal; callers must show this change and obtain confirmation before applying it. */
export interface CopilotSettingsProposal {
    setting: 'chat.useAgentSkills';
    currentValue: boolean | undefined;
    proposedValue: true;
    patch: { op: 'add' | 'replace'; path: '/chat.useAgentSkills'; value: true };
}

/** VS Code discovers the project's .github/skills natively; no custom path is needed. */
export function proposeCopilotSettings(root: string): CopilotSettingsProposal | undefined {
    const config = vscode.workspace.getConfiguration(undefined, vscode.Uri.file(root));
    const currentValue = config.get<boolean>('chat.useAgentSkills');
    if (currentValue !== false) return undefined;
    const folderValue = config.inspect<boolean>('chat.useAgentSkills')?.workspaceFolderValue;
    return { setting: 'chat.useAgentSkills', currentValue, proposedValue: true,
        patch: { op: folderValue === undefined ? 'add' : 'replace', path: '/chat.useAgentSkills', value: true } };
}

/** Apply only a proposal explicitly approved by the user. VS Code edits settings JSONC in place. */
export async function applyCopilotSettings(root: string, approved: CopilotSettingsProposal): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before changing settings.');
    const current = proposeCopilotSettings(root);
    if (!current || current.currentValue !== approved.currentValue || current.patch.op !== approved.patch.op)
        throw new Error('Copilot settings changed since review. Review the proposal again.');
    const config = vscode.workspace.getConfiguration(undefined, vscode.Uri.file(root));
    await config.update('chat.useAgentSkills', true, vscode.ConfigurationTarget.WorkspaceFolder);
}

import { LocalEnvironmentDiscovery, processEnvironment } from '../infrastructure/environment/discovery';
import { createEnvironmentSettings } from '../host/vscode/environment-settings';
import * as vscode from 'vscode';
import type { EnvironmentDiscovery } from '../contracts/environment';

export function createEnvironmentController(context: vscode.ExtensionContext, discovery: EnvironmentDiscovery = new LocalEnvironmentDiscovery()) {
    const settings = createEnvironmentSettings(context, discovery);
    const childEnvironment = (root?: string) => { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running tools.'); return processEnvironment(discovery, settings.paths(root)); };
    return { ...settings, processEnvironment: childEnvironment, runtimeOptions: async (root: string) => ({ env: await childEnvironment(root), gitHubToken: await context.secrets.get('copilotSdlc.credential.githubToken') }) };
}

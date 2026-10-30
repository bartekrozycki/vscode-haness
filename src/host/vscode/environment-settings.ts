import * as vscode from 'vscode';
import { environmentTools, type EnvironmentDiscovery, type EnvironmentPaths, type EnvironmentStatus, type EnvironmentTool } from '../../contracts/environment';

const credentialNames = ['githubToken', 'openaiApiKey'] as const;
const secretKey = (name: string) => `copilotSdlc.credential.${name}`;
function credentialName(name: unknown): string {
    if (typeof name !== 'string' || !credentialNames.includes(name as typeof credentialNames[number])) throw new Error('Unknown credential.');
    return name;
}
export function createEnvironmentSettings(context: vscode.ExtensionContext, discovery: EnvironmentDiscovery) {
    const config = (root?: string) => vscode.workspace.getConfiguration('copilotSdlc', root ? vscode.Uri.file(root) : undefined);
    const trust = () => { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before configuring or discovering tools.'); };
    const paths = (root?: string): EnvironmentPaths => Object.fromEntries(environmentTools.map(tool => [tool, config(root).get<string>(`${tool}Path`) || ''])) as EnvironmentPaths;
    async function read(root?: string): Promise<EnvironmentStatus> {
        trust();
        const selected = paths(root);
        const [tools, credentials] = await Promise.all([
            Promise.all(environmentTools.map(tool => discovery.inspect(tool, selected[tool]))),
            Promise.all(credentialNames.map(async name => ({ name, configured: (await context.secrets.get(secretKey(name))) !== undefined })))
        ]);
        return { tools, credentials };
    }
    async function save(input: unknown, root?: string): Promise<EnvironmentStatus> {
        trust();
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid tool paths.');
        const values = input as Record<string, unknown>;
        for (const tool of environmentTools) if (typeof values[tool] !== 'string' || (values[tool] as string).length > 4096 || (values[tool] as string).includes('\0')) throw new Error(`Invalid ${tool} path.`);
        const statuses = await Promise.all(environmentTools.map(tool => discovery.inspect(tool, (values[tool] as string).trim())));
        const invalid = statuses.find(status => status.configuredPath && status.error);
        if (invalid) throw new Error(`${invalid.tool}: ${invalid.error}`);
        for (const tool of environmentTools) await config(root).update(`${tool}Path`, (values[tool] as string).trim(), root ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
        return read(root);
    }
    async function setCredential(value: unknown, root?: string): Promise<EnvironmentStatus> {
        trust();
        const name = credentialName(value);
        const secret = await vscode.window.showInputBox({ title: `Set ${name}`, prompt: 'Enter the credential to store securely.', password: true, ignoreFocusOut: true });
        if (secret !== undefined && secret.length) await context.secrets.store(secretKey(name), secret);
        return read(root);
    }
    async function deleteCredential(value: unknown, root?: string): Promise<EnvironmentStatus> {
        trust();
        await context.secrets.delete(secretKey(credentialName(value)));
        return read(root);
    }
    async function resolve(tool: EnvironmentTool, root?: string): Promise<string | undefined> { trust(); return (await discovery.inspect(tool, paths(root)[tool])).executable; }
    return { read, save, setCredential, deleteCredential, resolve, paths };
}

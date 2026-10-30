import * as vscode from 'vscode';
import type { ConnectionCredential, ConnectionMetadata, ConnectionStorage } from '../../contracts/connections';

const metadataKey = 'copilotSdlc.connections';
const secretKey = (id: string) => `copilotSdlc.connection.${id}`;
function validId(id: unknown): asserts id is string { if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid connection ID.'); }
const trust = () => { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using connections.'); };
export function createConnectionStorage(context: vscode.ExtensionContext): ConnectionStorage {
    return {
        async load() { trust(); return context.globalState.get<ConnectionMetadata[]>(metadataKey, []); },
        async save(items) { trust(); await context.globalState.update(metadataKey, items); },
        async getCredential(id) { trust(); validId(id); const value = await context.secrets.get(secretKey(id)); if (!value) return undefined; try { const credential: unknown = JSON.parse(value); return credential && typeof credential === 'object' && !Array.isArray(credential) ? credential as ConnectionCredential : undefined; } catch { return undefined; } },
        async setCredential(id, credential) { trust(); validId(id); await context.secrets.store(secretKey(id), JSON.stringify(credential)); },
        async deleteCredential(id) { trust(); validId(id); await context.secrets.delete(secretKey(id)); }
    };
}
export function createConnectionCredentialSettings(storage: ConnectionStorage) {
    return {
        async setCredential(id: string): Promise<boolean> {
            trust(); validId(id); const connection = (await storage.load()).find(item => item.id === id); if (!connection) throw new Error('Connection not found.');
            if (connection.auth === 'token') {
                const token = await vscode.window.showInputBox({ title: `Credential for ${id}`, prompt: 'Enter the personal access token.', password: true, ignoreFocusOut: true });
                if (token === undefined) return false; if (!token || /[\r\n]/.test(token)) throw new Error('Invalid token.');
                await storage.setCredential(id, { token });
            } else {
                const username = await vscode.window.showInputBox({ title: `Credential for ${id}`, prompt: 'Enter the username.', ignoreFocusOut: true });
                if (username === undefined) return false; if (!username || username.includes(':')) throw new Error('Invalid username.');
                const password = await vscode.window.showInputBox({ title: `Credential for ${id}`, prompt: 'Enter the password.', password: true, ignoreFocusOut: true });
                if (password === undefined) return false; if (!password) throw new Error('Invalid password.');
                await storage.setCredential(id, { username, password });
            }
            return true;
        },
        async deleteCredential(id: string) { trust(); validId(id); await storage.deleteCredential(id); }
    };
}

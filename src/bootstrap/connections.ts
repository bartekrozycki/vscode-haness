import * as vscode from 'vscode';
import type { ConnectionApproval } from '../contracts/connections';
import { createConnectionCredentialSettings, createConnectionStorage } from '../host/vscode/connection-settings';
import { RestConnectionService } from '../infrastructure/connections/service';

/** The caller must provide a host-controlled approval callback; never derive it from remote content. */
export function createConnections(context: vscode.ExtensionContext, approve: (request: ConnectionApproval) => Promise<boolean>) {
    const storage = createConnectionStorage(context);
    return { service: new RestConnectionService(storage, approve), credentials: createConnectionCredentialSettings(storage) };
}

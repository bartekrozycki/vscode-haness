export type ConnectionProvider = 'jira' | 'confluence' | 'bitbucket' | 'github';
export type ConnectionAuth = 'token' | 'basic';
export interface ConnectionMetadata { id: string; provider: ConnectionProvider; baseUrl: string; auth: ConnectionAuth; }
export interface ConnectionStatus extends ConnectionMetadata { credentialPresent: boolean; }
export interface ConnectionCredential { token?: string; username?: string; password?: string; }
export interface ConnectionStorage {
    load(): Promise<ConnectionMetadata[]>;
    save(connections: ConnectionMetadata[]): Promise<void>;
    getCredential(id: string): Promise<ConnectionCredential | undefined>;
    setCredential(id: string, credential: ConnectionCredential): Promise<void>;
    deleteCredential(id: string): Promise<void>;
}
export type ConnectionOperation = 'search' | 'read' | 'create' | 'update' | 'pullRequests' | 'readPullRequest' | 'comments' | 'reviewComments' | 'createPullRequest' | 'createComment';
export type ConnectionParams = Record<string, unknown>;
export interface ConnectionApproval { connection: ConnectionMetadata; operation: ConnectionOperation; params: ConnectionParams; method: 'POST' | 'PUT'; path: string; body: Readonly<Record<string, unknown>>; }
export interface ConnectionService {
    list(): Promise<ConnectionStatus[]>;
    save(metadata: ConnectionMetadata): Promise<ConnectionStatus[]>;
    remove(id: string): Promise<ConnectionStatus[]>;
    execute(id: string, operation: ConnectionOperation, params: ConnectionParams): Promise<unknown>;
}

/** The provider request was not transmitted; safe to report as a preflight failure. */
export class ConnectionNotSentError extends Error {
    constructor(message: string) { super(message); this.name = 'ConnectionNotSentError'; }
}

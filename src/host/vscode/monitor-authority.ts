import type { ConnectionMetadata, ConnectionService } from '../../contracts/connections';
import type { MonitorDefinition } from '../../contracts/monitors';

/** Grants live in private extension state, never in project monitor JSON or model input. */
export function createMonitorAuthority(options: {
    connections: ConnectionService;
    get(key: string): string | undefined;
    set(key: string, value: string): PromiseLike<void>;
    review(root: string, definition: MonitorDefinition, connection: ConnectionMetadata): Promise<boolean>;
}) {
    const key = (root: string, definition: MonitorDefinition) => `monitor.grant:${root}:${definition.id}`;
    const fingerprint = async (definition: MonitorDefinition) => {
        const profile = (await options.connections.list()).find(c => c.id === definition.connectionId);
        if (!profile || profile.provider !== definition.provider) throw new Error('Monitor provider must match its connection.');
        return JSON.stringify({ definition, connection: { id: profile.id, provider: profile.provider, baseUrl: profile.baseUrl, auth: profile.auth } });
    };
    return {
        async authorize(root: string, definition: MonitorDefinition) {
            const value = await fingerprint(definition);
            if (!await options.review(root, definition, (JSON.parse(value) as {connection:ConnectionMetadata}).connection)) return false;
            if (value !== await fingerprint(definition)) throw new Error('Connection changed while reviewing monitor.');
            await options.set(key(root, definition), value); return true;
        },
        async allows(root: string, definition: MonitorDefinition) {
            return definition.action?.armed === true && options.get(key(root, definition)) === await fingerprint(definition);
        },
    };
}

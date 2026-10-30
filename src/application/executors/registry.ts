import type { AgentExecutor, ExecutorInfo } from '../../contracts/executor';
import type { Snapshot } from '../../contracts/model';
import { DEFAULT_EXECUTOR, isExecutorId } from '../../domain/execution-policy';
/** Registration owns discovery only. Existing sessions retain their captured adapter. */
export class ExecutorRegistry {
    private readonly entries = new Map<string, {
        executor: AgentExecutor;
        info: ExecutorInfo;
    }>();
    register(executor: AgentExecutor, module?: string) {
        if (executor.apiVersion !== 1 || !isExecutorId(executor.id) || !executor.title || typeof executor.createSession !== 'function')
            throw new Error('Invalid executor definition / API version');
        if (this.entries.has(executor.id))
            throw new Error(`Duplicate executor: ${executor.id}`);
        const owned = { executor: { apiVersion: 1 as const, id: executor.id, title: executor.title, description: executor.description, createSession: executor.createSession.bind(executor) }, info: { id: executor.id, title: executor.title, description: executor.description, module } };
        const id = executor.id;
        this.entries.set(id, owned);
        return { dispose: () => { if (this.entries.get(id) === owned)
                this.entries.delete(id); } };
    }
    list(): ExecutorInfo[] { return [...this.entries.values()].map(e => ({ ...e.info })); }
    get(id: string): AgentExecutor {
        const found = this.entries.get(id);
        if (!found)
            throw new Error(`Missing executor „${id}”. Install its module or change the execution configuration.`);
        return found.executor;
    }
    annotate(snapshot: Snapshot): Snapshot {
        const available = new Set(this.entries.keys());
        return { ...snapshot, agentActions: Object.fromEntries(Object.entries(snapshot.agentActions || {}).map(([id, actions]) => [id, actions.map(action => action.enabled && !available.has(action.executor || DEFAULT_EXECUTOR) ? { ...action, enabled: false, reason: `Missing executor „${action.executor}”. Install its module or choose another executor.` } : action)])) };
    }
}

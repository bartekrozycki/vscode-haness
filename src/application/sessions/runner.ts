import { Usage } from '../../domain/usage';
import { withRunHistory } from '../queries/run-history';
import { agentActions } from '../../domain/agent-policy';
import { usageLimit } from '../../domain/session-limits';
import { ExecutorRegistry } from '../executors/registry';
import { selectExecutor } from '../../domain/execution-policy';
import { liveEvent } from './event-bridge';
import type { ExecutorEvent, ExecutorSession, ExecutorPermissionRequest, ExecutorPermissionResult } from '../../contracts/executor';
import type { Snapshot, ToolContext } from '../../contracts/model';
import type { ProjectGateway, ToolService, SessionLog } from '../ports';
import type { ToolDefinition } from '../../contracts/model';
export interface RuntimeHost {
    permission(request: ExecutorPermissionRequest): Promise<ExecutorPermissionResult>;
    input: (question: string, choices?: string[]) => Promise<string | undefined>;
    log: (text: string) => void;
    changed: () => void;
    liveChanged?: (root: string) => void;
    started?: (root: string, run: string) => void;
}
/** Provider-independent lifecycle: policy, tools, limits, logs and task ledgers. */
export class SessionRunner {
    private readonly running = new Map<string, {
        controller: AbortController;
        run: string;
        root: string;
    }>();
    private readonly registry: ToolService;
    private readonly projects: ProjectGateway;
    private readonly live: SessionLog;
    private readonly host: RuntimeHost;
    private readonly executors: ExecutorRegistry;
    private readonly filterTools: (definitions: ToolDefinition[]) => ToolDefinition[];
    constructor(services: {
        tools: ToolService;
        projects: ProjectGateway;
        live: SessionLog;
        host: RuntimeHost;
        executors: ExecutorRegistry;
        sessionTools: (definitions: ToolDefinition[]) => ToolDefinition[];
    }) {
        this.registry = services.tools;
        this.projects = services.projects;
        this.live = services.live;
        this.host = services.host;
        this.executors = services.executors;
        this.filterTools = services.sessionTools;
    }
    get activeCount(): number { return this.running.size; }
    stop(root?: string, run?: string): boolean {
        let stopped = false;
        for (const record of this.running.values()) {
            if ((root && record.root !== root) || (run && record.run !== run))
                continue;
            this.live.activity(record.root, record.run, 'Stopping session');
            record.controller.abort();
            stopped = true;
        }
        return stopped;
    }
    sessions(root: string, snapshot?: Snapshot) { return this.live.list(root).then(sessions => withRunHistory(sessions, snapshot)); }
    async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
        const id = String(input.id), role = String(input.role), key = `${context.root}:${id}`;
        if (this.running.has(key))
            throw new Error('A session for this task is already running');
        const harness = this.projects.open(context.root), agents = await harness.agents();
        const agent = agents.find(a => a.name === `sdlc-${role}`);
        if (!agent)
            throw new Error(`Missing agent .github/agents/sdlc-${role}.agent.md`);
        const cfg = await harness.config(), snapshot = await harness.snapshot(context.signal), taskState = snapshot.tasks.find(t => t.id === id);
        if (!taskState)
            throw new Error(`Task not found ${id}.`);
        const action = agentActions({ ...snapshot, config: cfg }, taskState, agents).find(a => a.role === role);
        if (!action)
            throw new Error(`Agent ${role} is not available for status ${taskState.status}. See workflow.agentsByStatus.`);
        if (!action.enabled)
            throw new Error(action.reason);
        if (input.executor !== undefined && typeof input.executor !== 'string')
            throw new Error('Invalid executor ID.');
        const executorId = selectExecutor(cfg, role, agent, input.executor as string | undefined), executor = this.executors.get(executorId);
        if (this.running.has(key))
            throw new Error('A session for this task is already running');
        const permissions = cfg.session.permissions ?? 'bypass';
        const model = agent.model || (typeof cfg.models[role] === 'string' ? cfg.models[role] : 'auto');
        const options = cfg.execution?.options;
        const executorOptions = options && Object.hasOwn(options, executorId) ? options[executorId] : {};
        // Historical actor IDs identify a logical role. Keeping them lets another provider resume its tasks.
        const run = globalThis.crypto.randomUUID(), actor = `sdk-${role}`, controller = new AbortController();
        this.running.set(key, { controller, run, root: context.root });
        const forwardAbort = () => controller.abort();
        context.signal?.addEventListener('abort', forwardAbort, { once: true });
        if (context.signal?.aborted)
            controller.abort();
        let session: ExecutorSession | undefined, begun = false, accepting = true;
        let outcome = 'failed', failure: unknown, sessionId = '', limitReason: string | undefined, eventFailed = false;
        const usage = new Usage(), started = Date.now(), messages = new Map<string, string>(), seen = new Set<string>();
        const hitLimit = (reason: string) => {
            if (controller.signal.aborted)
                return;
            limitReason = reason;
            this.live.activity(context.root, run, reason);
            this.host.log(`\n[${reason}]\n`);
            controller.abort();
        };
        const deadline = setTimeout(() => hitLimit(`Extension limit: session duration ${cfg.session.timeoutSeconds} s. Setting: session.timeoutSeconds.`), cfg.session.timeoutSeconds * 1000);
        const abortSession = () => { void session?.abort().catch(error => this.host.log(`\n[abort] ${String(error)}\n`)); };
        controller.signal.addEventListener('abort', abortSession);
        const emit = (event: ExecutorEvent) => {
            if (!accepting || (event.id && seen.has(event.id)))
                return;
            if (event.id)
                seen.add(event.id);
            try {
                if (event.type === 'activity') {
                    this.live.activity(context.root, run, event.text, event.waiting);
                    return;
                }
                const normalized = liveEvent(event);
                if (!normalized)
                    return;
                usage.add(normalized);
                this.live.event(context.root, run, normalized);
                if (event.type === 'message.delta') {
                    messages.set(event.messageId, (messages.get(event.messageId) || '') + event.text);
                    this.host.log(event.text);
                }
                if (event.type === 'message')
                    messages.set(event.messageId, event.text);
                if (event.type === 'error')
                    failure = new Error(event.message);
                const reached = usageLimit(usage, cfg.session);
                if (reached)
                    hitLimit(reached);
            }
            catch (error) {
                eventFailed = true;
                failure = error;
                controller.abort();
            }
        };
        try {
            controller.signal.throwIfAborted();
            await harness.invoke({ operation: 'run_start', id, role, actor, run }, controller.signal);
            begun = true;
            this.live.begin(context.root, { run, item: id, role, model: model, permissions, executor: executorId });
            this.host.started?.(context.root, run);
            this.host.changed();
            const definitions = this.filterTools(await this.registry.definitions(context.root));
            const toolContext: ToolContext = { ...context, actor, role, item: id, signal: controller.signal, approve: permissions === 'bypass' ? async () => true : context.approve };
            const tools = definitions.map(definition => ({ definition: structuredClone(definition), invoke: async (args: Record<string, unknown>) => {
                    if (!accepting)
                        throw new Error('The session has ended.');
                    controller.signal.throwIfAborted();
                    try {
                        return await this.registry.invoke(definition.name, args, toolContext);
                    }
                    finally {
                        this.host.changed();
                    }
                } }));
            const task = await harness.invoke<{
                body: string;
                title: string;
            }>({ operation: 'read', id }, controller.signal);
            session = await executor.createSession({ root: context.root, run, item: id, role, actor, agent: structuredClone(agent), model: model,
                prompt: `Task ${id}:\n\n${task.body}\n\n${String(input.prompt || '')}`,
                systemPrompt: `Project SDLC session. Write all responses, reports and questions in English. Work only on ${id}. Identity: ${actor}. Read .work-item/README.md. Do not approve your own work, answer on the human's behalf, push, publish, switch branches or alter harness ledgers directly. Use sdlc_* tools to change state. Stop after your task's handoff/verdict or record a blocker. Task TSV is authoritative. ${task.title}`,
                permissions, timeoutSeconds: cfg.session.timeoutSeconds, options: structuredClone(executorOptions), tools, signal: controller.signal, emit,
                requestPermission: async (request) => {
                    if (permissions === 'bypass')
                        return { kind: 'approve-once' };
                    this.live.activity(context.root, run, `Waiting for permission: ${request.kind}`, true);
                    try {
                        return await this.host.permission(request);
                    }
                    finally {
                        this.live.activity(context.root, run, 'Agent working');
                    }
                },
                askUser: async (question, choices) => {
                    this.live.activity(context.root, run, `Question: ${question}`, true);
                    try {
                        return await this.host.input(question, choices);
                    }
                    finally {
                        this.live.activity(context.root, run, 'Agent working');
                    }
                },
            });
            if (!session || typeof session.id !== 'string' || !session.id || !['run', 'abort', 'dispose'].every(method => typeof (session as unknown as Record<string, unknown>)[method] === 'function'))
                throw new Error(`Executor ${executorId} returned an invalid session.`);
            sessionId = session.id;
            this.live.connect(context.root, run, sessionId);
            controller.signal.throwIfAborted();
            this.host.log(`\n[${id} ${role} · ${executorId} · ${sessionId} · permissions: ${permissions}]\n`);
            await session.run();
            if (failure)
                throw failure;
            outcome = controller.signal.aborted ? (limitReason ? 'limit' : 'cancelled') : 'completed';
        }
        catch (error) {
            failure = limitReason ? new Error(limitReason) : eventFailed ? failure : error;
            outcome = eventFailed ? 'failed' : controller.signal.aborted ? (limitReason ? 'limit' : 'cancelled') : 'failed';
            this.host.log(`\n[${outcome}] ${String(failure)}\n`);
        }
        finally {
            accepting = false;
            if (begun)
                this.live.activity(context.root, run, 'Finalizing session and saving metrics');
            clearTimeout(deadline);
            controller.signal.removeEventListener('abort', abortSession);
            context.signal?.removeEventListener('abort', forwardAbort);
            try {
                await session?.abort();
            }
            catch (error) {
                this.host.log(`\n[abort] ${String(error)}\n`);
            }
            try {
                await session?.dispose();
            }
            catch (error) {
                this.host.log(`\n[dispose] ${String(error)}\n`);
            }
            const report = [...messages.values()].join('\n\n');
            try {
                if (begun)
                    await harness.invoke({ operation: 'run_finish', id, run, actor, outcome, session: sessionId,
                        model: [...usage.models].join(', ') || model, duration_ms: Date.now() - started,
                        report: limitReason ? `# Session stopped by an extension limit\n\n${limitReason}\n\n## Response so far\n\n${report || 'The agent has not saved a final response yet.'}` : report, ...usage.fields() });
            }
            finally {
                try {
                    if (begun)
                        await this.live.finish(context.root, run, outcome, limitReason || failure);
                }
                finally {
                    this.running.delete(key);
                    this.host.changed();
                }
            }
        }
        if (failure && outcome === 'failed')
            throw failure;
        return { run, id, role, executor: executorId, session: sessionId, outcome, ...(limitReason ? { reason: limitReason } : {}), ...usage.fields() };
    }
}

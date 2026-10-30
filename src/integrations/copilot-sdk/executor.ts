import path from 'node:path';
import type { CopilotClient, CopilotClientOptions, CopilotSession, SessionEvent } from '@github/copilot-sdk';
import type { AgentExecutor, ExecutorEvent } from '../../contracts/executor';
import { closeCopilotSession, runCopilotSession, within } from './completion';
/** All SDK-specific types, native tools, connection setup and events live in this adapter. */
export function copilotSdkExecutor(host: {
    client?: (root: string) => Promise<CopilotClient>;
    cliPath?: (root?: string) => string;
    clientFactory?: (options: CopilotClientOptions) => CopilotClient;
    runtimeOptions?: (root: string) => Promise<{ env?: NodeJS.ProcessEnv; gitHubToken?: string }>;
} = {}): AgentExecutor {
    return {
        apiVersion: 1, id: 'copilot-sdk', title: 'GitHub Copilot SDK',
        description: 'Copilot SDK sessions with project tools and public event streaming.',
        async createSession(request) {
            const sdk = await import('@github/copilot-sdk');
            let client: CopilotClient | undefined, session: CopilotSession | undefined;
            const abortCreation = () => { if (session)
                void session.abort().catch(() => { });
            else
                void client?.stop().catch(() => { }); };
            request.signal.addEventListener('abort', abortCreation, { once: true });
            async function cleanup() {
                request.signal.removeEventListener('abort', abortCreation);
                await closeCopilotSession(client, session);
            }
            try {
                request.signal.throwIfAborted();
                const configuredPath = typeof request.options.cliPath === 'string' ? request.options.cliPath : host.cliPath?.(request.root);
                const runtime = host.client ? undefined : await host.runtimeOptions?.(request.root);
                request.signal.throwIfAborted();
                const clientOptions: CopilotClientOptions = { workingDirectory: request.root,
                    ...(runtime?.env ? { env: runtime.env } : {}),
                    ...(runtime?.gitHubToken ? { gitHubToken: runtime.gitHubToken } : {}),
                    baseDirectory: path.join(request.root, '.copilot-sdlc/runtime'),
                    ...(configuredPath ? { connection: sdk.RuntimeConnection.forStdio({ path: configuredPath }) } : {}) };
                client = host.client ? await host.client(request.root) : host.clientFactory ? host.clientFactory(clientOptions) : new sdk.CopilotClient(clientOptions);
                await client.start();
                request.signal.throwIfAborted();
                const tools = request.tools.map(tool => ({ name: tool.definition.name, description: tool.definition.description, parameters: tool.definition.inputSchema,
                    handler: async (input: unknown) => {
                        try { return JSON.stringify(await tool.invoke(input as Record<string, unknown>)); }
                        catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            request.emit({ type: 'activity', text: `Error ${tool.definition.name}: ${message}` });
                            return { resultType: 'failure' as const, textResultForLlm: message, error: message, sessionLog: message };
                        }
                    } }));
                const readers = ['view', 'grep', 'glob'];
                const native = request.role === 'worker' || request.role === 'planner' ? [...readers, 'edit', 'create', process.platform === 'win32' ? 'powershell' : 'bash'] : readers;
                const visible = request.agent.tools ?? [...native, ...tools.map(t => t.name)];
                session = await client.createSession({ model: request.model, workingDirectory: request.root, streaming: true, tools, availableTools: visible,
                    customAgents: [{ name: request.agent.name, description: request.agent.description, prompt: request.agent.prompt, model: request.agent.model, tools: visible, infer: false }], agent: request.agent.name,
                    onPermissionRequest: async (permission, invocation) => request.permissions === 'bypass' ? sdk.approveAll(permission, invocation) : request.requestPermission({ kind: permission.kind, details: permission }),
                    onUserInputRequest: async (input) => ({ answer: await request.askUser(input.question, input.choices) ?? 'No answer. Record a question and stop.', wasFreeform: true }),
                    systemMessage: { mode: 'append', content: request.systemPrompt },
                });
                let fallbackMessage = 'message-0', turn = 0;
                const observe = (event: SessionEvent) => {
                    if (event.type === 'assistant.turn_start')
                        fallbackMessage = `message-${++turn}`;
                    const normalized = copilotEvent(event, fallbackMessage);
                    if (normalized)
                        request.emit(normalized);
                };
                request.signal.throwIfAborted();
                request.signal.removeEventListener('abort', abortCreation);
                const owned = session;
                let finished = false;
                return { id: session.sessionId, run: async () => {
                        try { await runCopilotSession(owned, request.prompt, request.signal, request.timeoutSeconds * 1000, observe); }
                        finally { finished = true; }
                    },
                    abort: async () => { if (!finished) await within(() => owned.abort(), 1000); }, dispose: cleanup };
            }
            catch (error) {
                try {
                    if (session) await within(() => session!.abort(), 1000);
                }
                catch { /* shutting down */ }
                try {
                    await cleanup();
                }
                catch { /* retain original provider error */ }
                throw error;
            }
        },
    };
}
const plain = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
function toolResult(data: Record<string, unknown>): string {
    const result = data.result as Record<string, unknown> | undefined;
    const blocks = Array.isArray(data.content) ? data.content : Array.isArray(result?.content) ? result.content : [];
    return blocks.flatMap(block => {
        const part = block as Record<string, unknown>;
        return ['text', 'terminal', 'shell_exit'].includes(String(part.type)) ? [plain(part.text || part.outputPreview || '')] : [];
    }).join('\n') || plain(result?.content && !Array.isArray(result.content) ? result.content : result?.detailedContent || result?.text || '');
}
/** Whitelist public SDK output. Reasoning and binary blocks never enter the core protocol. */
export function copilotEvent(event: SessionEvent, fallbackMessage: string): ExecutorEvent | undefined {
    const d = event.data as unknown as Record<string, unknown>, meta = { id: event.id, timestamp: event.timestamp };
    switch (event.type) {
        case 'assistant.message_delta': return { ...meta, type: 'message.delta', messageId: String(d.messageId || fallbackMessage), text: plain(d.deltaContent) };
        case 'assistant.message': return { ...meta, type: 'message', messageId: String(d.messageId || fallbackMessage), text: plain(d.content), model: typeof d.model === 'string' ? d.model : undefined };
        case 'assistant.turn_start': return { ...meta, type: 'turn.start' };
        case 'assistant.turn_end': return { ...meta, type: 'turn.end' };
        case 'assistant.usage': return { ...meta, type: 'usage', model: d.model as string, inputTokens: d.inputTokens as number, outputTokens: d.outputTokens as number,
            cacheReadTokens: d.cacheReadTokens as number, cacheWriteTokens: d.cacheWriteTokens as number, premiumRequests: d.cost as number };
        case 'tool.execution_start': return { ...meta, type: 'tool.start', callId: String(d.toolCallId), name: String(d.toolName), input: d.arguments };
        case 'tool.shell_output': return { ...meta, type: 'tool.output', callId: String(d.toolCallId), text: plain(d.text) };
        case 'tool.execution_progress': return { ...meta, type: 'tool.output', callId: String(d.toolCallId), text: plain(d.progressMessage) };
        case 'tool.execution_partial_result': return { ...meta, type: 'tool.output', callId: String(d.toolCallId), text: plain(d.partialOutput) };
        case 'tool.execution_complete': return { ...meta, type: 'tool.end', callId: String(d.toolCallId), success: d.success !== false && !d.error, output: toolResult(d), error: d.error ? plain(d.error) : undefined };
        case 'session.error': return { ...meta, type: 'error', message: plain(d.message) };
    }
}

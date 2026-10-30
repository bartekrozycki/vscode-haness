import type { AgentDefinition, ToolDefinition } from './model';
export interface ExecutorPermissionRequest {
    kind: string;
    details?: unknown;
}
export type ExecutorPermissionResult = {
    kind: 'approve-once';
} | {
    kind: 'reject';
};
interface EventMeta {
    id?: string;
    timestamp?: string;
}
/** Incremental events. Usage values are deltas, never session-wide totals. */
export type ExecutorEvent = EventMeta & ({
    type: 'message.delta' | 'message';
    messageId: string;
    text: string;
    model?: string;
} | {
    type: 'turn.start' | 'turn.end';
} | {
    type: 'tool.start';
    callId: string;
    name: string;
    input?: unknown;
} | {
    type: 'tool.output';
    callId: string;
    text: string;
} | {
    type: 'tool.end';
    callId: string;
    success: boolean;
    output?: string;
    error?: string;
} | {
    type: 'usage';
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    /** Only when explicitly reported in this unit. Omit when unknown. */
    premiumRequests?: number;
    costUsd?: number;
} | {
    type: 'activity';
    text: string;
    waiting?: boolean;
} | {
    type: 'error';
    message: string;
});
export interface ExecutorTool {
    definition: ToolDefinition;
    invoke(input: Record<string, unknown>): Promise<unknown>;
}
export interface ExecutorRequest {
    root: string;
    run: string;
    item: string;
    role: string;
    actor: string;
    agent: AgentDefinition;
    model: string;
    prompt: string;
    systemPrompt: string;
    permissions: 'bypass' | 'ask';
    timeoutSeconds: number;
    options: Readonly<Record<string, unknown>>;
    tools: readonly ExecutorTool[];
    signal: AbortSignal;
    emit(event: ExecutorEvent): void;
    requestPermission(request: ExecutorPermissionRequest): Promise<ExecutorPermissionResult>;
    askUser(question: string, choices?: string[]): Promise<string | undefined>;
}
export interface ExecutorSession {
    id: string;
    /** Resolves once execution has finished; reject for transport/provider errors. */
    run(): Promise<void>;
    /** Must interrupt run promptly. Also honor request.signal during creation. */
    abort(): Promise<void>;
    /** Release resources owned by this session. Called once, also after failure. */
    dispose(): Promise<void>;
}
export interface AgentExecutor {
    apiVersion: 1;
    id: string;
    title: string;
    description?: string;
    createSession(request: ExecutorRequest): Promise<ExecutorSession>;
}
export interface ExecutorInfo {
    id: string;
    title: string;
    description?: string;
    module?: string;
}
export {};

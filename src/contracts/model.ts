export type Row = Record<string, string>;
export type Operation = Record<string, unknown> & {
    operation: string;
};
export interface Snapshot {
    tasks: Row[];
    history: Row[];
    metrics: Row[];
    questions: Row[];
    lessons: Row[];
    runs: Row[];
    config: ProjectConfig;
    projectUsage?: { sessions:number; active:number; inputTokens:number; outputTokens:number; durationMs:number; costUsd?:number; costKnown:number; premiumRequests?:number; premiumKnown:number; demo:number };
    /** Enriched by the extension host; the standalone Python snapshot omits this. */
    agentActions?: Record<string, AgentAction[]>;
}
export interface AgentAction {
    role: string;
    label: string;
    description: string;
    enabled: boolean;
    reason?: string;
    executor?: string;
}
export interface ProjectConfig {
    version: 1;
    models: Record<string, string>;
    session: {
        timeoutSeconds: number;
        maxOutputTokens: number;
        maxPremiumRequests?: number | null;
        permissions?: 'bypass' | 'ask';
    };
    gates: {
        name: string;
        command: string[];
        cwd?: string;
        timeoutSeconds?: number;
    }[];
    workflow?: {
        agentsByStatus?: Record<string, string[]>;
    };
    execution?: {
        default?: string;
        roles?: Record<string, string>;
        options?: Record<string, Record<string, unknown>>;
    };
}
export interface ToolDefinition {
    name: string;
    displayName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    readOnly: boolean;
    /** Operation-level confirmation policy for tools with both queries and commands. */
    readOnlyOperations?: string[];
    mutatingOperations?: string[];
    command?: string[];
    timeoutSeconds?: number;
}
export interface ToolContext {
    root: string;
    signal?: AbortSignal;
    actor?: string;
    role?: string;
    item?: string;
    approve?: (description: string) => Promise<boolean>;
}
export interface AgentDefinition {
    name: string;
    description: string;
    prompt: string;
    tools?: string[];
    model?: string;
    executor?: string;
}

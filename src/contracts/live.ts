export interface LiveEntry {
    id: string;
    timestamp: string;
    kind: 'message' | 'tool' | 'status' | 'error';
    title: string;
    text: string;
    status?: string;
    arguments?: string;
}
export interface LiveSession {
    run: string;
    item: string;
    role: string;
    model: string;
    permissions: string;
    started: string;
    updated: string;
    finished: string;
    session: string;
    status: string;
    activity: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    premiumRequests?: number;
    costUsd?: number;
    turns: number;
    toolCalls: number;
    entries: LiveEntry[];
    controllable: boolean;
    truncated?: boolean;
    storageError?: string;
    hasLog?: boolean;
    entriesLoaded?: boolean;
    stopReason?: string;
    executor?: string;
}
export interface LiveEvent {
    id?: string;
    type: string;
    timestamp?: string;
    data: unknown;
}

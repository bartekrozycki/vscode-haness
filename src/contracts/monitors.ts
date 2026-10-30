export type MonitorProvider = 'jira' | 'github' | 'bitbucket';
export interface MonitorDefinition {
    id: string; name: string; provider: MonitorProvider; connectionId: string;
    query: { jql?: string; owner?: string; project?: string; repo?: string; pullRequestId?: number; label?: string; commentContains?: string };
    intervalSeconds: number;
    action?: { kind: 'refine' | 'implement'; researchFocus?: string; taskId?: string; armed?: boolean; estimate?: number; timeoutSeconds?: number; maxTokens?: number; maxParallel?: number };
}
export interface MonitorObservation { id: string; version: string; kind: 'issue' | 'comment'; title?: string; body?: string; labels?: string[]; url?: string; updatedAt?: string }
export interface MonitorTrigger { monitorId: string; eventId: string; action: 'refine' | 'implement'; connectionId: string; remoteId: string; remoteText: string; researchFocus?: string; taskId?: string; armed: boolean; estimate?: number; timeoutSeconds?: number; maxTokens?: number; maxParallel?: number }
export interface MonitorEvent { id: string; monitorId: string; receivedAt: string; observation: MonitorObservation; trigger?: MonitorTrigger }
export interface MonitorRecord { definition: MonitorDefinition; active: boolean; baseline: boolean; seen: Record<string, string>; matched?: Record<string, boolean>; transitions?: Record<string, number>; lastPoll?: string; error?: string; pollCount?: number; errorCount?: number; lastDurationMs?: number }
export interface MonitorState { records: MonitorRecord[]; events: MonitorEvent[] }
export interface MonitorStore { read(root: string): Promise<MonitorState>; mutate<T>(root: string, fn: (state: MonitorState) => T | Promise<T>): Promise<T> }
export interface MonitorSource { poll(definition: MonitorDefinition): Promise<MonitorObservation[]> }

export type StudioKind = 'initiative' | 'specification' | 'report' | 'prototype' | 'decision' | 'proposal' | 'research';
export interface StudioRecord {
    id: string;
    kind: StudioKind;
    parent: string;
    title: string;
    status: string;
    revision: number;
    estimate?: number;
    data: Record<string, unknown>;
    body: string;
    file: string;
    updated: string;
}
export interface StudioStore {
    readonly owner: string;
    ownerAlive(owner: string): boolean;
    list(root: string): Promise<StudioRecord[]>;
    /** Serialize mutations across Extension Hosts; write immutable document revisions. */
    mutate<T>(root: string, action: (records: StudioRecord[]) => Promise<T>): Promise<T>;
}

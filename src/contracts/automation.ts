import type { ConnectionOperation, ConnectionParams } from './connections';
import type { MonitorTrigger } from './monitors';
export type AutomationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'uncertain' | 'dismissed';
export interface PublicationProposal { connectionId: string; operation: ConnectionOperation; params: ConnectionParams; taskId?: string }
export interface AutomationRequest {
    id: string; kind: 'refine' | 'implement' | 'publish'; status: AutomationStatus;
    createdAt: string; updatedAt: string; owner?: string; eventId?: string; trigger?: MonitorTrigger;
    publication?: PublicationProposal; result?: unknown; error?: string;
}
export interface AutomationState { requests: AutomationRequest[] }
export interface AutomationStore { readonly owner: string; ownerAlive(owner: string): boolean; read(root: string): Promise<AutomationState>; mutate<T>(root: string, fn: (state: AutomationState) => T | Promise<T>): Promise<T> }

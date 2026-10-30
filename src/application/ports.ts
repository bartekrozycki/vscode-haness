import type { AgentDefinition, Operation, ProjectConfig, Snapshot, ToolContext, ToolDefinition } from '../contracts/model';
import type { Disposable, ToolHandler } from '../contracts/api';
import type { LiveEvent, LiveSession } from '../contracts/live';
export interface ProjectAccess {
    initialized(): Promise<boolean>;
    config(): Promise<ProjectConfig>;
    agents(): Promise<AgentDefinition[]>;
    snapshot(signal?: AbortSignal): Promise<Snapshot>;
    invoke<T = unknown>(request: Operation, signal?: AbortSignal): Promise<T>;
}
export interface ProjectGateway {
    open(root: string): ProjectAccess;
    initialize(root: string): Promise<{
        created: string[];
        preserved: string[];
    }>;
}
export interface FileAccess {
    resolve(root: string, relative: string): Promise<string>;
    exists(file: string): Promise<boolean>;
}
export interface SchemaValidator {
    assertSchema(schema: Record<string, unknown>): void;
    validate(schema: Record<string, unknown>, input: Record<string, unknown>): void;
}
export interface ProjectToolCatalog {
    definitions(root: string): Promise<ToolDefinition[]>;
    execute(definition: ToolDefinition, input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}
export interface ToolService {
    definitions(root: string): Promise<ToolDefinition[]>;
    invoke(name: string, input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}
export interface ToolRegistrar extends ToolService {
    registerTool(definition: ToolDefinition, handler: ToolHandler): Disposable;
}
export interface SessionLog {
    begin(root: string, metadata: Pick<LiveSession, 'run' | 'item' | 'role' | 'model' | 'permissions'> & {
        executor?: string;
    }): void;
    connect(root: string, run: string, session: string): void;
    activity(root: string, run: string, text: string, waiting?: boolean): void;
    event(root: string, run: string, event: LiveEvent): void;
    finish(root: string, run: string, outcome: string, error?: unknown): Promise<void>;
    list(root: string): Promise<LiveSession[]>;
}

/** Public contract for companion extensions. Runtime implementations stay private. */
import type { Snapshot, ToolContext, ToolDefinition } from './model';
import type { AgentExecutor, ExecutorInfo } from './executor';
export type { Snapshot, ToolContext, ToolDefinition, AgentAction } from './model';
export type { AgentExecutor, ExecutorInfo, ExecutorEvent, ExecutorRequest, ExecutorSession, ExecutorTool, ExecutorPermissionRequest, ExecutorPermissionResult } from './executor';
export interface Disposable {
    dispose(): void;
}
export type ToolHandler = (input: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
export interface ModuleContext {
    root: string;
    /** Undefined until the user explicitly initializes the project. */
    snapshot?: Snapshot;
    /** Selected work item, only supplied to task contributions. */
    item?: string;
    signal: AbortSignal;
}
export type WidgetContent = {
    kind: 'text';
    text: string;
} | {
    kind: 'metrics';
    values: {
        label: string;
        value: string | number;
        detail?: string;
    }[];
} | {
    kind: 'table';
    columns: string[];
    rows: Record<string, string | number | boolean | null>[];
};
export interface ModuleWidget {
    id: string;
    title: string;
    /** Both slots are inside the single workbench; modules cannot create tabs. */
    placement: 'workspace' | 'task';
    order?: number;
    provide(context: ModuleContext): WidgetContent | undefined | Promise<WidgetContent | undefined>;
}
export interface ModuleAction {
    id: string;
    title: string;
    scope: 'workspace' | 'task';
    run(context: ModuleContext): unknown | Promise<unknown>;
}
export interface SdlcModule {
    /** Called when unregistered or the Extension Host shuts down. Cancel owned work. */
    onDispose?(): void;
    apiVersion: 1;
    /** Stable, namespaced identity, e.g. acme.quality. */
    id: string;
    title: string;
    version: string;
    description?: string;
    tools?: {
        definition: ToolDefinition;
        invoke: ToolHandler;
    }[];
    widgets?: ModuleWidget[];
    actions?: ModuleAction[];
    executors?: AgentExecutor[];
}
export interface ModuleInfo {
    id: string;
    title: string;
    version: string;
    description?: string;
    tools: string[];
    executors?: string[];
}
export interface ResolvedWidget {
    id: string;
    module: string;
    title: string;
    placement: 'workspace' | 'task';
    content?: WidgetContent;
    error?: string;
}
export interface WorkbenchContributions {
    modules: ModuleInfo[];
    widgets: ResolvedWidget[];
    actions: {
        id: string;
        module: string;
        title: string;
        scope: 'workspace' | 'task';
    }[];
}
export interface SessionInfo {
    run: string;
    item: string;
    role: string;
    model: string;
    session: string;
    status: string;
    activity: string;
    started: string;
    finished: string;
    inputTokens: number;
    outputTokens: number;
    controllable: boolean;
    stopReason?: string;
    executor?: string;
}
export type SdlcEvent = {
    type: 'workspace.changed';
    root?: string;
} | {
    type: 'session.changed';
    root: string;
    run?: string;
} | {
    type: 'modules.changed';
};
export interface SdlcApi {
    readonly version: 1;
    registerModule(module: SdlcModule): Disposable;
    /** Compatibility for integrations built against 0.1 / 0.2. Prefer modules. */
    registerTool(definition: ToolDefinition, handler: ToolHandler): Disposable;
    listModules(): ModuleInfo[];
    onDidEvent(listener: (event: SdlcEvent) => void): Disposable;
    /** Refresh contributions after your module's own data changes. */
    refresh(root?: string): void;
    getSnapshot(root: string): Promise<Snapshot | undefined>;
    invokeTool(root: string, name: string, input: Record<string, unknown>): Promise<unknown>;
    openWorkbench(root?: string, selection?: {
        item?: string;
        run?: string;
    }): Promise<void>;
    sessions: {
        list(root: string): Promise<SessionInfo[]>;
        /** Call only in response to an explicit user action. Consumes Copilot usage. */
        run(root: string, input: {
            id: string;
            role: string;
            prompt?: string;
            executor?: string;
        }): Promise<unknown>;
        stop(root: string, run: string): Promise<boolean>;
    };
    /** Available since extension 0.4. Older API-v1 hosts omit this capability. */
    executors?: {
        list(): ExecutorInfo[];
    };
}

export type { StudioRecord, StudioKind } from './studio';

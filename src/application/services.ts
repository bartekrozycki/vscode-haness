import type { AutomationService } from './automation/service';
import type { ConnectionService } from '../contracts/connections';
import type { MonitorEngine } from './monitors/engine';
import type { TaskSuggestions } from './launchpad/suggestions';
import type { StudioNotebook } from './studio/notebook';
import type { ProjectGateway, FileAccess } from './ports';
import type { ToolRegistry } from './tools/registry';
import type { ModuleRegistry } from './modules/registry';
import type { SessionRunner } from './sessions/runner';
import type { LiveSession } from '../contracts/live';
import type { Snapshot } from '../contracts/model';
import type { ResearchTeams } from './studio/research';
/** Application-facing capabilities consumed by host adapters. */
export interface AppServices {
    automation?: AutomationService;
    connections?: ConnectionService;
    monitors?: MonitorEngine;
    research?: ResearchTeams;
    suggestions?: TaskSuggestions;
    studio?: StudioNotebook;
    projects: ProjectGateway;
    files: FileAccess;
    tools: ToolRegistry;
    modules: ModuleRegistry;
    runner: SessionRunner;
    usage?(root:string,state:Snapshot,sessions:LiveSession[]):Promise<Snapshot>;
    snapshot(root: string, signal?: AbortSignal): Promise<Snapshot>;
    scaffold(target: string, id: string): Promise<string>;
    dispose(): void;
}

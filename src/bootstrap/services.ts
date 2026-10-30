import { matchesGrantedTrigger } from '../application/monitors/authorization';
import { AutomationService } from '../application/automation/service';
import { FileAutomationStore } from '../infrastructure/automation/store';
import { automationModule } from '../features/automation/module';
import type { ConnectionService } from '../contracts/connections';
import type { MonitorDefinition } from '../contracts/monitors';
import { MonitorEngine } from '../application/monitors/engine';
import { FileMonitorStore } from '../infrastructure/monitors/store';
import { ConnectionMonitorSource } from '../infrastructure/monitors/source';
import { monitorsModule } from '../features/monitors/module';
import { connectionsModule } from '../features/connections/module';
import { TaskSuggestions } from '../application/launchpad/suggestions';
import { launchpadModule } from '../features/launchpad/module';
import { projectUsage } from '../application/queries/project-usage';
import { FileStudioStore } from '../infrastructure/studio/store';
import { StudioNotebook } from '../application/studio/notebook';
import { ResearchTeams } from '../application/studio/research';
import { studioModules, studioAgents } from '../features/studio/module';
import { ToolRegistry } from '../application/tools/registry';
import { ModuleRegistry } from '../application/modules/registry';
import { SessionRunner, type RuntimeHost } from '../application/sessions/runner';
import { readProjectSnapshot } from '../application/queries/project-snapshot';
import { PythonProjectGateway } from '../infrastructure/project/gateway';
import { AjvValidator } from '../infrastructure/schema/ajv-validator';
import { JsonProjectTools } from '../infrastructure/project-tools/json-tools';
import { FileSessionLog } from '../infrastructure/sessions/file-session-log';
import { exists, projectPath } from '../infrastructure/files/project-paths';
import { workItemsModule } from '../features/work-items/module';
import { authorizeWorkItemTool, sessionTools } from '../features/work-items/tool-policy';
import { metricsModule } from '../features/metrics/module';
import { copilotSdkExecutor } from '../integrations/copilot-sdk/executor';
import { scaffoldModule } from '../infrastructure/scaffolding/module';
import type { AppServices } from '../application/services';
import type { ToolContext } from '../contracts/model';
/** Only this composition root selects concrete storage, validators, features and adapters. */
export function createServices(options: {
    connections?: ConnectionService;
    allowMonitorWorkflow?(root:string,definition:MonitorDefinition):Promise<boolean>;
    authorizeMonitor?(root:string,definition:MonitorDefinition):Promise<boolean>;
    resources: string;
    sdk: string;
    python: () => string;
    host: RuntimeHost;
    cliPath?: (root?:string) => string;
    processEnvironment?: (root:string)=>Promise<NodeJS.ProcessEnv>;
    runtimeOptions?: (root:string)=>Promise<{env?:NodeJS.ProcessEnv;gitHubToken?:string}>;
    publish?(root:string,message:Record<string,unknown>):void;
    beforeRun?(input: Record<string, unknown>, context: ToolContext): Promise<void>;
}): AppServices {
    const projects = new PythonProjectGateway(options.resources, options.python, options.processEnvironment);
    const tools = new ToolRegistry({ schemas: new AjvValidator(), projectTools: new JsonProjectTools(options.processEnvironment), authorize: authorizeWorkItemTool });
    const modules = new ModuleRegistry(tools, error => options.host.log(String(error)));
    const live = new FileSessionLog(root => options.host.liveChanged?.(root));
    const runner = new SessionRunner({ tools, projects, host: options.host, executors: modules.executors, live, sessionTools });
    const usageRecords = new Map<string, Awaited<ReturnType<StudioNotebook['list']>>>();
    const usage = async (root:string,state:import('../contracts/model').Snapshot,sessions:import('../contracts/live').LiveSession[]) => ({...state,projectUsage:projectUsage(state,usageRecords.get(root)||await notebook.list(root),sessions)});
    const snapshot = async (root: string, signal?: AbortSignal) => { const state = await readProjectSnapshot(projects, root, signal, modules.executors); const records=await notebook.list(root);usageRecords.set(root,records);return {...state, projectUsage: projectUsage(state, records, await live.list(root))}; };
    modules.register(workItemsModule({ projects, tools, snapshot, run: async (input, context) => {
            await options.beforeRun?.(input, context);
            return runner.run(input, context);
        } }));
    const notebook = new StudioNotebook(new FileStudioStore(), projects);
    const research = new ResearchTeams({ notebook, projects, tools, executors: modules.executors, live, agents: studioAgents, started: options.host.started, beforeStart: async root => { await options.beforeRun?.({}, {root}); }, changed: root => { options.host.liveChanged?.(root); modules.emit({ type: 'workspace.changed', root }); } });
    for (const module of studioModules(notebook, research)) modules.register(module);
    const suggestions = new TaskSuggestions(projects, notebook.store, (root,message) => options.publish?.(root,message));
    modules.register(launchpadModule(suggestions));
    const automation = options.connections ? new AutomationService({
        store: new FileAutomationStore(), projects, notebook, research, runner,
        connections: options.connections,
        changed: root => {
            modules.emit({ type: 'workspace.changed', root });
            void automation!.list(root).then(requests => options.publish?.(root, {
                type: 'automation',
                workflowActions: requests.map(request => ({ ...request, state: request.status,
                    title: request.trigger?.taskId || request.trigger?.researchFocus || request.publication?.operation || request.kind })),
            })).catch(error => options.host.log(String(error)));
        },
    }) : undefined;
    const monitors = options.connections ? new MonitorEngine(
        new FileMonitorStore(), new ConnectionMonitorSource(options.connections),
        async (root, trigger) => {
            const request = await automation?.receive(root, trigger);
            modules.emit({ type: 'workspace.changed', root });
            const definition = (await monitors!.list(root)).find(record => record.definition.id === trigger.monitorId)?.definition;
            if (request && definition && matchesGrantedTrigger(request, trigger, definition)
                && await options.allowMonitorWorkflow?.(root, definition)) {
                void automation!.runApproved(root, request.id, request).catch(error => options.host.log(String(error)));
            }
        },
        options.authorizeMonitor,
        root => {
            modules.emit({ type: 'workspace.changed', root });
            void Promise.all([monitors!.list(root), monitors!.events(root)])
                .then(([records, events]) => options.publish?.(root, { type: 'monitors', monitors: records, events }))
                .catch(error => options.host.log(String(error)));
        },
    ) : undefined;
    if (options.connections) modules.register(connectionsModule(options.connections));
    if (monitors) modules.register(monitorsModule(monitors));
    if (automation) modules.register(automationModule(automation));
    modules.register(metricsModule);
    modules.register({ apiVersion: 1, id: 'core.copilot', title: 'Copilot SDK', version: '1.0.0', executors: [copilotSdkExecutor({ cliPath: options.cliPath, runtimeOptions: options.runtimeOptions })] });
    return { automation, connections: options.connections, monitors, projects, tools, modules, runner, research, suggestions, studio: notebook, usage, snapshot, scaffold: (target, id) => scaffoldModule(target, options.resources, options.sdk, id), files: { resolve: projectPath, exists },
        dispose() { research.dispose(); runner.stop(); modules.dispose(); } };
}

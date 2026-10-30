import type { SdlcApi } from '../../contracts/api';
import type { AppServices } from '../../application/services';
import type { Snapshot } from '../../contracts/model';
import type { WorkspaceAccess } from './workspace';
import type { Workbench } from './workbench';
export function createPublicApi(services: AppServices, workspace: WorkspaceAccess, workbench: Workbench, snapshot: (root: string) => Promise<Snapshot | undefined>): SdlcApi {
    const { root, trust, approve } = workspace;
    const changed = (folder?: string) => services.modules.emit({ type: 'workspace.changed', root: folder });
    return {
        version: 1,
        executors: { list: () => services.modules.executors.list() },
        registerModule: module => services.modules.register(module),
        registerTool: (definition, handler) => { const registration = services.tools.registerTool(definition, handler); changed(); return registration; },
        listModules: () => services.modules.list(), onDidEvent: listener => services.modules.onDidEvent(listener), refresh: changed,
        getSnapshot: async (folder) => snapshot(await root(folder)),
        invokeTool: async (folder, name, input) => { trust(); const result = await services.tools.invoke(name, input, { root: await root(folder), approve }); changed(folder); return result; },
        openWorkbench: async (folder, selection) => workbench.open(await root(folder), selection),
        sessions: {
            list: async (folder) => { const selected = await root(folder); trust(); return (await services.runner.sessions(selected, await snapshot(selected))).map(({ entries: _entries, ...session }) => session); },
            run: async (folder, input) => { trust(); const selected = await root(folder); await workbench.open(selected, { item: input.id }); return services.runner.run(input, { root: selected, approve }); },
            stop: async (folder, run) => { trust(); const selected = await root(folder); return services.runner.stop(selected, run) || services.research?.stopRun(selected, run) || false; },
        },
    };
}

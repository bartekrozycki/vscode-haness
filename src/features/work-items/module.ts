import type { SdlcModule, ToolHandler } from '../../contracts/api';
import type { Snapshot } from '../../contracts/model';
import type { ProjectGateway, ToolService } from '../../application/ports';
import { catalog } from './catalog';
import { workItemPresentation } from './presentation';
export function workItemsModule(services: {
    projects: ProjectGateway;
    tools: ToolService;
    run: ToolHandler;
    snapshot(root: string, signal?: AbortSignal): Promise<Snapshot>;
}): SdlcModule {
    return { ...workItemPresentation, tools: catalog.map(definition => ({ definition, invoke: async (input, context) => {
                const project = services.projects.open(context.root);
                switch (definition.name) {
                    case 'sdlc_initialize':
                        if (context.role)
                            throw new Error('Initialization requires an explicit human request');
                        return services.projects.initialize(context.root);
                    case 'sdlc_metrics': return services.snapshot(context.root, context.signal);
                    case 'sdlc_run':
                        if (context.role)
                            throw new Error('Nested agent sessions are disabled');
                        return services.run(input, context);
                    case 'sdlc_project_tool': {
                        const custom = (await services.tools.definitions(context.root)).filter(t => !catalog.some(c => c.name === t.name));
                        if (input.operation === 'list')
                            return custom.map(({ command: _command, ...tool }) => tool);
                        if (typeof input.name !== 'string' || !custom.some(t => t.name === input.name))
                            throw new Error('Select a project tool from list');
                        return services.tools.invoke(input.name, (input.input || {}) as Record<string, unknown>, context);
                    }
                    default: {
                        const { workspacePath: _workspace, ...request } = input;
                        return project.invoke({ ...request, operation: String(input.operation), actor: context.actor || 'copilot-chat' }, context.signal);
                    }
                }
            } })) };
}

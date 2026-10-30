import type { ProjectGateway } from '../ports';
import type { ExecutorRegistry } from '../executors/registry';
import type { AgentDefinition } from '../../contracts/model';
import { withAgentActions } from '../../domain/agent-policy';
export async function readProjectSnapshot(projects: ProjectGateway, root: string, signal?: AbortSignal, executors?: ExecutorRegistry) {
    const project = projects.open(root), snapshot = await project.snapshot(signal);
    let agents: AgentDefinition[] = [], error: string | undefined;
    try {
        agents = await project.agents();
    }
    catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
    }
    const enriched = withAgentActions(snapshot, agents, error);
    return executors ? executors.annotate(enriched) : enriched;
}

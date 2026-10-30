import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { AgentDefinition } from '../../contracts/model';
import { isExecutorId } from '../../domain/execution-policy';
import { exists, projectPath } from '../files/project-paths';
export async function loadAgents(root: string): Promise<AgentDefinition[]> {
    const directory = await projectPath(root, '.github/agents');
    if (!(await exists(directory)))
        return [];
    const agents: AgentDefinition[] = [];
    for (const name of (await readdir(directory)).filter(name => name.startsWith('sdlc-') && name.endsWith('.agent.md')).sort()) {
        const text = await readFile(await projectPath(root, `.github/agents/${name}`), 'utf8');
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
        if (!match)
            throw new Error(`Invalid agent front matter: ${name}`);
        const metadata = parse(match[1]) as Record<string, unknown>;
        if (typeof metadata.name !== 'string' || typeof metadata.description !== 'string')
            throw new Error(`Agent needs name and description: ${name}`);
        if (metadata.executor !== undefined && !isExecutorId(metadata.executor))
            throw new Error(`Invalid agent executor: ${name}`);
        agents.push({ name: metadata.name, description: metadata.description, prompt: match[2], model: typeof metadata.model === 'string' ? metadata.model : undefined, executor: metadata.executor as string | undefined,
            tools: Array.isArray(metadata.tools) ? metadata.tools.map(String) : undefined });
    }
    if (new Set(agents.map(agent => agent.name)).size !== agents.length)
        throw new Error('Duplicate SDLC agent names');
    return agents;
}

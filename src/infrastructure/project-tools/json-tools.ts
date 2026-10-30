import { readFile, readdir } from 'node:fs/promises';
import type { ProjectToolCatalog } from '../../application/ports';
import type { ToolDefinition, ToolContext } from '../../contracts/model';
import { exists, projectPath } from '../files/project-paths';
import { execute } from '../process/execute';
export class JsonProjectTools implements ProjectToolCatalog {
    constructor(private readonly processEnvironment?: (root: string) => Promise<NodeJS.ProcessEnv>) {}
    async definitions(root: string): Promise<ToolDefinition[]> {
        const directory = await projectPath(root, '.copilot-sdlc/tools');
        if (!(await exists(directory)))
            return [];
        return Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).sort().map(async (file) => {
            const definition = JSON.parse(await readFile(await projectPath(root, `.copilot-sdlc/tools/${file}`), 'utf8')) as ToolDefinition;
            if (!/^[a-z][a-z0-9_]{2,63}$/.test(definition.name) || typeof definition.description !== 'string' || !Array.isArray(definition.command) || !definition.command.length || !definition.command.every(v => typeof v === 'string') || typeof definition.readOnly !== 'boolean')
                throw new Error(`Invalid project tool definition: ${file}`);
            return definition;
        }));
    }
    async execute(definition: ToolDefinition, input: Record<string, unknown>, context: ToolContext) {
        const command = definition.command!.map(arg => arg.replace(/\$\{projectRoot\}/g, context.root).replace(/\$\{input\.([a-zA-Z0-9_]+)\}/g, (_whole, key: string) => {
            if (!(key in input))
                throw new Error(`Missing command argument: ${key}`);
            return typeof input[key] === 'object' ? JSON.stringify(input[key]) : String(input[key]);
        }));
        const env = await this.processEnvironment?.(context.root);
        const executableKeys: Record<string, string> = { git: 'GIT', node: 'NODE', java: 'JAVA', python: 'PYTHON', python3: 'PYTHON' };
        const selected = executableKeys[command[0]];
        if (selected && env?.[`COPILOT_SDLC_${selected}_PATH`]) command[0] = env[`COPILOT_SDLC_${selected}_PATH`]!;
        if (!context.approve || !(await context.approve(`Run tool ${definition.name}?\n${command.join(' ')}`)))
            throw new Error('Project tool was not approved');
        return execute(command, context.root, '', context.signal, Math.min(definition.timeoutSeconds || 60, 3600) * 1000, env);
    }
}

import type { ProjectAccess } from '../../application/ports';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentDefinition, Operation, ProjectConfig, Snapshot } from '../../contracts/model';
import { execute } from '../process/execute';
import { validateAgentWorkflow } from '../../domain/agent-policy';
import { validateExecution } from '../../domain/execution-policy';
import { exists, projectPath } from '../files/project-paths';
import { loadAgents } from './agent-loader';
export function assertCompatibleGit(script: string, git: string | undefined, platform: NodeJS.Platform = process.platform): void {
    if (!git) return;
    const name = (platform === 'win32' ? path.win32 : path.posix).basename(git);
    const standard = platform === 'win32' ? name.toLowerCase() === 'git.exe' : name === 'git';
    if (!standard && !script.includes('COPILOT_SDLC_GIT_PATH'))
        throw new Error('This project has an older harness that cannot use the selected Git executable. Upgrade tools/work-items.py to support COPILOT_SDLC_GIT_PATH, or select a standard git executable.');
}
export class HarnessClient implements ProjectAccess {
    constructor(readonly root: string, readonly python = process.platform === 'win32' ? 'python' : 'python3', private readonly processEnvironment?: (root: string) => Promise<NodeJS.ProcessEnv>) { }
    async initialized(): Promise<boolean> { return exists(path.join(this.root, '.copilot-sdlc/config.json')); }
    async invoke<T = unknown>(request: Operation, signal?: AbortSignal): Promise<T> {
        if (!(await this.initialized()))
            throw new Error('Run SDLC: Initialize project harness first.');
        const script = await projectPath(this.root, 'tools/work-items.py');
        const env = await this.processEnvironment?.(this.root);
        if (env?.COPILOT_SDLC_GIT_PATH) assertCompatibleGit(await readFile(script, 'utf8'), env.COPILOT_SDLC_GIT_PATH);
        const text = await execute([env?.COPILOT_SDLC_PYTHON_PATH || this.python, script, 'api'], this.root, JSON.stringify(request), signal, request.operation === 'gates' ? 3600000 : 30000, env);
        return JSON.parse(text) as T;
    }
    snapshot(signal?: AbortSignal): Promise<Snapshot> { return this.invoke({ operation: 'snapshot' }, signal); }
    agents(): Promise<AgentDefinition[]> { return loadAgents(this.root); }
    async config(): Promise<ProjectConfig> {
        const value = JSON.parse(await readFile(await projectPath(this.root, '.copilot-sdlc/config.json'), 'utf8')) as ProjectConfig;
        if (value.version !== 1 || !value.models || !Array.isArray(value.gates) || !value.session ||
            !Number.isFinite(value.session.timeoutSeconds) || value.session.timeoutSeconds < 30 || value.session.timeoutSeconds > 7200 ||
            !Number.isFinite(value.session.maxOutputTokens) || value.session.maxOutputTokens <= 0 ||
            (value.session.maxPremiumRequests != null && (!Number.isFinite(value.session.maxPremiumRequests) || value.session.maxPremiumRequests <= 0)) ||
            (value.session.permissions !== undefined && !['bypass', 'ask'].includes(value.session.permissions)))
            throw new Error('Invalid .copilot-sdlc/config.json; check models, gates and session limits.');
        validateAgentWorkflow(value);
        validateExecution(value);
        return value;
    }
}

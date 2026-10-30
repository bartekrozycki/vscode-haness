import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { EnvironmentDiscovery, EnvironmentTool, ToolStatus } from '../../contracts/environment';

const names: Record<EnvironmentTool, string[]> = {
    git: ['git'], node: ['node'], java: ['java'], python: process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
};

/** Resolve executables ourselves; never invoke a shell or interpret a configured path as argv. */
export class LocalEnvironmentDiscovery implements EnvironmentDiscovery {
    constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly platform: NodeJS.Platform = process.platform) {}
    private async executable(candidate: string): Promise<boolean> {
        try {
            if (!(await stat(candidate)).isFile()) return false;
            await access(candidate, this.platform === 'win32' ? constants.F_OK : constants.X_OK);
            return true;
        } catch { return false; }
    }
    private async resolve(tool: EnvironmentTool, configured: string): Promise<string[]> {
        const win = this.platform === 'win32';
        const pathApi = win ? path.win32 : path.posix;
        const paths = (this.env.PATH ?? this.env.Path ?? this.env.path ?? '').split(win ? ';' : ':').filter(Boolean);
        if (tool === 'java' && !configured && this.env.JAVA_HOME) paths.unshift(pathApi.join(this.env.JAVA_HOME, 'bin'));
        const candidates = configured ? [configured] : names[tool];
        const found: string[] = [];
        for (const candidate of candidates) {
            const hasDirectory = pathApi.isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\');
            const extensions = win && !pathApi.extname(candidate) ? ['.exe', '.com'] : [''];
            for (const directory of hasDirectory ? [''] : paths) {
                for (const ext of extensions) {
                    const file = directory ? pathApi.join(directory, candidate + ext) : candidate + ext;
                    if (await this.executable(file)) {
                        if (configured) return [file];
                        found.push(file);
                    }
                }
            }
        }
        return [...new Set(found)];
    }
    async inspect(tool: EnvironmentTool, configuredPath: string): Promise<ToolStatus> {
        const configured = configuredPath.trim();
        const result: ToolStatus = { tool, configuredPath: configured };
        const executables = await this.resolve(tool, configured);
        if (!executables.length) return { ...result, error: 'Executable not found or not executable.' };
        const deadline = Date.now() + 5000;
        const check = (executable: string, argument: string): Promise<{ code: number | null; output: string; timedOut?: boolean; failed?: boolean }> => new Promise(resolve => {
            let output = '', settled = false;
            const finish = (value: { code: number | null; output: string; timedOut?: boolean; failed?: boolean }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
            const child = spawn(executable, [argument], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: this.env });
            const timer = setTimeout(() => { child.kill(); finish({ code: null, output: '', timedOut: true }); }, Math.max(1, deadline - Date.now()));
            const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(0, 4096); };
            child.stdout.on('data', collect); child.stderr.on('data', collect);
            child.on('error', () => finish({ code: null, output: '', failed: true }));
            child.on('close', code => finish({ code, output }));
        });
        let failure = 'Executable did not return a valid version.';
        for (const executable of executables) {
            if (Date.now() >= deadline) return { ...result, error: 'Version check timed out.' };
            let checked = await check(executable, '--version');
            if (tool === 'java' && checked.code !== 0 && !checked.failed && !checked.timedOut) checked = await check(executable, '-version');
            if (checked.timedOut) return { ...result, error: 'Version check timed out.' };
            if (checked.failed) { failure = 'Could not start executable.'; continue; }
            const version = checked.output.trim().split(/\r?\n/)[0];
            const expected = { git: /^git version\s+[0-9][\w.+-]*/i, node: /^v[0-9][\w.+-]*/i, java: /^(?:openjdk|java)(?:\s+version)?\s+["']?[0-9][\w.+-]*/i, python: /^Python\s+[0-9][\w.+-]*/i }[tool];
            const match = version.match(expected);
            if (checked.code !== 0 || !match) continue;
            if (tool === 'python' && !pythonVersionSupported(match[0])) { failure = 'Python 3.12 or newer is required.'; continue; }
            return { ...result, executable, version: match[0].replace(/["']$/, '') };
        }
        return { ...result, error: failure };
    }
}

/** Prepare a child-only environment; preserve the host PATH and never mutate process.env. */
export async function processEnvironment(discovery: EnvironmentDiscovery, selected: Record<EnvironmentTool, string>, env: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
    const statuses = await Promise.all((['git', 'node', 'java', 'python'] as const).map(tool => discovery.inspect(tool, selected[tool])));
    for (const status of statuses) if ((status.configuredPath || status.tool === 'python') && !status.executable) throw new Error(`${status.tool}: ${status.error}`);
    const next = { ...env };
    for (const tool of ['GIT', 'NODE', 'JAVA', 'PYTHON']) delete next[`COPILOT_SDLC_${tool}_PATH`];
    const git = statuses.find(item => item.tool === 'git')?.executable;
    if (git) next.COPILOT_SDLC_GIT_PATH = git;
    for (const status of statuses) if (status.executable) next[`COPILOT_SDLC_${status.tool.toUpperCase()}_PATH`] = status.executable;
    const dirs = statuses.flatMap(status => status.executable ? [path.dirname(status.executable)] : []);
    const pathKeys = Object.keys(next).filter(key => key.toLowerCase() === 'path');
    const pathKey = pathKeys.find(key => key === 'PATH') || pathKeys[0] || 'PATH';
    const originalPath = next[pathKey] || '';
    // Windows treats environment keys and directory names case-insensitively. Keep one PATH key.
    for (const key of pathKeys) if (key !== pathKey && process.platform === 'win32') delete next[key];
    const seen = new Set<string>();
    next[pathKey] = [...dirs, ...originalPath.split(path.delimiter)].filter(directory => {
        if (!directory) return false;
        const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
        if (seen.has(key)) return false;
        seen.add(key); return true;
    }).join(path.delimiter);
    const java = statuses.find(item => item.tool === 'java')?.executable;
    if (java && path.basename(path.dirname(java)).toLowerCase() === 'bin') next.JAVA_HOME = path.dirname(path.dirname(java));
    return next;
}

export function pythonVersionSupported(version: string): boolean {
    const match = /^Python\s+(\d+)\.(\d+)/i.exec(version);
    return !!match && (Number(match[1]) === 3 && Number(match[2]) >= 12);
}

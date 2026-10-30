import { spawn } from 'node:child_process';
import path from 'node:path';
import { access } from 'node:fs/promises';

/** Batch scripts require a shell, which cannot safely preserve arbitrary argument boundaries. */
export async function resolveWindowsCommand(command: string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (file: string) => Promise<boolean> = async file => { try { await access(file); return true; } catch { return false; } }): Promise<string[]> {
    if (platform !== 'win32') return command;
    const name = path.win32.basename(command[0]).toLowerCase();
    const tool = /^(npm|npx)(?:\.cmd)?$/.exec(name)?.[1];
    if (!tool) { validateExecutable(command[0], platform); return command; }
    const selected = env.COPILOT_SDLC_NODE_PATH;
    const node = selected || (path.win32.isAbsolute(command[0]) ? path.win32.join(path.win32.dirname(command[0]), 'node.exe') : undefined);
    if (!node || !(await exists(node))) throw new Error('Cannot locate Node for the Windows npm command. Configure the Node executable path.');
    const cli = path.win32.join(path.win32.dirname(node), 'node_modules', 'npm', 'bin', `${tool}-cli.js`);
    if (!(await exists(cli))) throw new Error(`Cannot find ${tool}-cli.js beside the selected Node installation. Install npm for this Node installation or invoke its CLI JavaScript directly.`);
    return [node, cli, ...command.slice(1)];
}

export function validateExecutable(command: string, platform: NodeJS.Platform = process.platform): void {
    if (platform === 'win32' && (/\.(?:cmd|bat)$/i.test(command) || /^(?:npm|npx|yarn|pnpm)$/i.test(command)))
        throw new Error('Windows batch commands are not supported. Invoke an executable directly, for example node with the package CLI JavaScript path.');
}
/** Argv-only execution; cancellation stops the process group or Windows process tree. */
export async function execute(command: string[], cwd: string, input = '', signal?: AbortSignal, timeoutMs = 30000, env?: NodeJS.ProcessEnv): Promise<string> {
    command = await resolveWindowsCommand(command, env);
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Cancelled'));
        try { validateExecutable(command[0]); } catch (error) { return reject(error); }
        const child = spawn(command[0], command.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env });
        let stdout = '', stderr = '', failure: Error | undefined, deadline: NodeJS.Timeout | undefined;
        const stop = () => {
            if (failure && deadline) return;
            failure ??= new Error(signal?.aborted ? 'Cancelled' : 'Process timed out');
            if (process.platform === 'win32' && child.pid) {
                const systemRoot = process.env.SystemRoot || 'C:\\Windows';
                const killer = spawn(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
                const fallback = () => { try { child.kill('SIGKILL'); } catch { /* exited */ } };
                killer.on('error', fallback);
                killer.on('close', code => { if (code !== 0) fallback(); });
                setTimeout(() => { try { killer.kill(); } catch { /* exited */ } fallback(); }, 3000).unref();
            } else {
                try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* exited */ }
                const pid = child.pid;
                setTimeout(() => { try { if (pid) process.kill(-pid, 'SIGKILL'); } catch { /* exited */ } }, 1500).unref();
            }
            deadline = setTimeout(() => { cleanup(); reject(failure); }, 4000);
        };
        const timer = setTimeout(stop, timeoutMs);
        signal?.addEventListener('abort', stop, { once: true });
        const cleanup = () => { clearTimeout(timer); if (deadline) clearTimeout(deadline); signal?.removeEventListener('abort', stop); };
        child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 16000000) { failure = new Error('Tool output exceeds 16 MB'); stop(); } });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
        child.on('error', error => { cleanup(); reject(new Error(`Cannot start ${command[0]}: ${error.message}`)); });
        child.on('close', code => {
            cleanup();
            if (failure) reject(failure);
            else if (code !== 0) {
                let message = stdout || stderr || `Exit ${code}`;
                try { message = JSON.parse(stdout).error || message; } catch { /* plain output */ }
                reject(new Error(String(message).slice(0, 20000)));
            } else resolve(stdout);
        });
        child.stdin.on('error', () => { });
        child.stdin.end(input);
    });
}

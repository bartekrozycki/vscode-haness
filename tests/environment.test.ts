import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalEnvironmentDiscovery, processEnvironment, pythonVersionSupported } from '../src/infrastructure/environment/discovery';
import { validateExecutable } from '../src/infrastructure/process/execute';
import type { EnvironmentDiscovery, EnvironmentPaths } from '../src/contracts/environment';

test('discovers executable paths containing spaces and validates version without a shell', { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc tool '));
    try {
        const executable = path.join(root, 'git');
        await writeFile(executable, '#!/bin/sh\nprintf "git version 2.42.0 extra output\\n"\n');
        await chmod(executable, 0o755);
        const discovery = new LocalEnvironmentDiscovery({ PATH: root });
        const auto = await discovery.inspect('git', '');
        assert.equal(auto.executable, executable);
        assert.equal(auto.version, 'git version 2.42.0');
        assert.equal((await discovery.inspect('git', `${executable}; touch injected`)).error, 'Executable not found or not executable.');
        assert.equal((await discovery.inspect('python', executable)).error, 'Executable did not return a valid version.');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('child environment retains PATH, sets selected Git and Java home, and rejects invalid explicit paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc env '));
    try {
        const bin = path.join(root, 'jdk', 'bin'); await mkdir(bin, { recursive: true });
        const selected: EnvironmentPaths = { git: '/custom/git', java: path.join(bin, 'java'), node: '', python: '/python' };
        const discovery: EnvironmentDiscovery = { async inspect(tool, configuredPath) { return { tool, configuredPath, ...(configuredPath === '/bad' ? {error:'invalid'} : configuredPath ? {executable: configuredPath, version:'1'} : {}) }; } };
        const env = await processEnvironment(discovery, selected, { PATH: '/original' });
        assert.equal(env.COPILOT_SDLC_GIT_PATH, '/custom/git');
        assert.equal(env.JAVA_HOME, path.join(root, 'jdk'));
        assert.ok(env.PATH?.endsWith('/original'));
        await assert.rejects(() => processEnvironment(discovery, { ...selected, git: '/bad' }, {}), /git: invalid/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('requires Python 3.12 or newer', async () => {
    assert.equal(pythonVersionSupported('Python 3.11.12'), false);
    assert.equal(pythonVersionSupported('Python 2.7.18'), false);
    assert.equal(pythonVersionSupported('Python 4.0.0'), false);
    assert.equal(pythonVersionSupported('Python 3.12.0'), true);
    assert.equal(pythonVersionSupported('Python 3.13.1'), true);
});

test('Windows batch wrappers are rejected without constructing a shell command', async () => {
    for (const name of ['npm', 'npx', 'C:\\Program Files\\nodejs\\npm.cmd', 'danger.bat']) assert.throws(() => validateExecutable(name, 'win32'), /batch commands/);
    assert.doesNotThrow(() => validateExecutable('C:\\Program Files\\nodejs\\node.exe', 'win32'));
});

test('Java 8 version check falls back to -version', { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc java '));
    try {
        const executable = path.join(root, 'java');
        await writeFile(executable, '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 1; fi\nprintf "java version \\"1.8.0_402\\"\\n" >&2\n');
        await chmod(executable, 0o755);
        const status = await new LocalEnvironmentDiscovery({ PATH: root }).inspect('java', executable);
        assert.equal(status.executable, executable); assert.equal(status.version, 'java version "1.8.0_402');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows cancellation terminates descendants', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
    const { execute } = await import('../src/infrastructure/process/execute.js');
    const { readFile } = await import('node:fs/promises');
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc tree '));
    try {
        const marker = path.join(root, 'pid');
        const source = `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
        await assert.rejects(execute([process.execPath, '-e', source, marker], root, '', undefined, 2000), /timed out/);
        const pid = Number(await readFile(marker, 'utf8'));
        assert.throws(() => process.kill(pid, 0));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows npm and npx launch their JavaScript with selected Node and preserve argv', async () => {
    const { resolveWindowsCommand } = await import('../src/infrastructure/process/execute.js');
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const npm = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    const npx = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';
    const exists = async (value: string) => [node, npm, npx].includes(value);
    const env = { COPILOT_SDLC_NODE_PATH: node };
    const args = ['test', 'argument with spaces', '&$(not-shell)'];
    assert.deepEqual(await resolveWindowsCommand(['npm', ...args], env, 'win32', exists), [node, npm, ...args]);
    assert.deepEqual(await resolveWindowsCommand(['npx.cmd', ...args], env, 'win32', exists), [node, npx, ...args]);
    await assert.rejects(resolveWindowsCommand(['npm'], {}, 'win32', exists), /Configure the Node/);
    await assert.rejects(resolveWindowsCommand(['npm'], env, 'win32', async value => value === node), /npm-cli/);
    await assert.rejects(resolveWindowsCommand(['yarn.cmd'], env, 'win32', exists), /batch commands/);
});

test('automatic Python discovery skips old and broken candidates, while explicit invalid selection fails', { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc pythons '));
    try {
        const first = path.join(root, 'first'), second = path.join(root, 'second'); await mkdir(first); await mkdir(second);
        const old = path.join(first, 'python3'), broken = path.join(second, 'python3'), newer = path.join(first, 'python');
        for (const [file, content] of [[old, 'echo Python 3.11.9'], [broken, 'exit 1'], [newer, 'echo Python 3.13.1']]) {
            await writeFile(file, `#!/bin/sh\n${content}\n`); await chmod(file, 0o755);
        }
        const discovery = new LocalEnvironmentDiscovery({ PATH: [first, second].join(path.delimiter) });
        assert.equal((await discovery.inspect('python', '')).executable, newer);
        assert.equal((await discovery.inspect('python', old)).error, 'Python 3.12 or newer is required.');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy harness rejects nonstandard Git names but accepts standard filenames and upgraded scripts', async () => {
    const { assertCompatibleGit } = await import('../src/infrastructure/project/client.js');
    assert.throws(() => assertCompatibleGit('legacy script', '/custom/renamed-git', 'linux'), /older harness/);
    assert.throws(() => assertCompatibleGit('legacy script', 'C:\\Tools\\custom.exe', 'win32'), /older harness/);
    assert.doesNotThrow(() => assertCompatibleGit('legacy script', 'C:\\Tools\\GIT.EXE', 'win32'));
    assert.doesNotThrow(() => assertCompatibleGit('legacy script', '/usr/bin/git', 'linux'));
    assert.doesNotThrow(() => assertCompatibleGit('COPILOT_SDLC_GIT_PATH', '/custom/renamed-git', 'linux'));
});

test('cancelling the harness stops a gate and its descendant on POSIX', { skip: process.platform === 'win32', timeout: 12000 }, async () => {
    const { execute } = await import('../src/infrastructure/process/execute.js');
    const { access } = await import('node:fs/promises');
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc cancel gate '));
    try {
        const marker = path.join(root, 'marker'), ready = path.join(root, 'ready');
        const modulePath = path.resolve('resources/project/tools/work-items.py');
        const child = "import pathlib,sys,time; time.sleep(3); pathlib.Path(sys.argv[1]).write_text('leaked')";
        const gate = "import subprocess,sys,time,pathlib; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); pathlib.Path(sys.argv[3]).write_text('ready'); time.sleep(20)";
        const runner = "import importlib.util,sys; s=importlib.util.spec_from_file_location('harness',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.run_gate_command([sys.executable,'-c',sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]],sys.argv[6],20)";
        const controller = new AbortController();
        const operation = execute(['python3', '-c', runner, modulePath, gate, child, marker, ready, root], root, '', controller.signal, 10000);
        const rejection = assert.rejects(operation, /Cancelled/);
        const deadline = Date.now() + 4000;
        while (true) { try { await access(ready); break; } catch { if (Date.now() > deadline) throw new Error('Gate did not start'); await new Promise(resolve => setTimeout(resolve, 50)); } }
        controller.abort(); await rejection;
        await new Promise(resolve => setTimeout(resolve, 3500));
        await assert.rejects(access(marker));
    } finally { await rm(root, { recursive: true, force: true }); }
});

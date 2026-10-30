import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
if (!process.env.SDLC_PACKAGED_EXTENSION) execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
await build({ entryPoints: ['examples/quality/src/extension.ts'], outfile: 'examples/quality/dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
await build({ entryPoints: ['tests/extension/suite.ts'], outfile: 'out/extension-suite.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
const project = await mkdtemp(path.join(os.tmpdir(), 'sdlc-vscode-'));
try {
  await runTests({ extensionDevelopmentPath: [process.env.SDLC_PACKAGED_EXTENSION || process.cwd(), path.resolve('examples/quality')], extensionTestsPath: path.resolve('out/extension-suite.cjs'),
    ...(process.env.VSCODE_EXECUTABLE_PATH ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH } : {}),
    launchArgs: [project, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-extensions', '--user-data-dir', path.join(project, 'profile')] });
} finally { await rm(project, { recursive: true, force: true }); }

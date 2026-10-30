import { build, context } from 'esbuild';
import { buildWebview, webviewBuild } from './build-webview.mjs';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await buildWebview();
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.api.json'], { stdio: 'inherit' });
await writeFile('sdk/package.json', JSON.stringify({ name: '@copilot-sdlc/api', version: '1.2.0', description: 'Type-only public contract for Copilot SDLC companion modules.', types: 'api.d.ts', files: ['**/*.d.ts'], license: 'MIT' }, null, 2) + '\n');
await writeFile('sdk/types.d.ts', "export type * from './contracts/model';\n");
await writeFile('sdk/executor-api.d.ts', "export type * from './contracts/executor';\n");
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/bootstrap/catalog.ts'], outfile: 'dist/catalog.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { catalog } = createRequire(import.meta.url)('../dist/catalog.cjs');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
manifest.contributes.languageModelTools = catalog.map(tool => ({ name: tool.name, displayName: tool.displayName, modelDescription: tool.description,
  userDescription: tool.description, canBeReferencedInPrompt: true, toolReferenceName: tool.name.replace('sdlc_', 'sdlc'), inputSchema: tool.inputSchema, when: 'isWorkspaceTrusted' }));
await writeFile('package.json', JSON.stringify(manifest, null, 2) + '\n');
const options = { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['vscode', '@github/copilot-sdk'], sourcemap: true };
if (process.argv.includes('--watch')) { const ctx = await context(options), ui = await context(webviewBuild); await Promise.all([ctx.watch(), ui.watch()]); } else await build(options);

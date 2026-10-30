import { build } from 'esbuild';
import { access, mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
await build({ entryPoints: ['src/infrastructure/scaffolding/module.ts'], outfile: 'out/scaffold.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { scaffoldModule } = createRequire(import.meta.url)('../out/scaffold.cjs');
await mkdir('examples', { recursive: true });
const target = path.resolve('examples/quality');
try { await access(path.join(target, 'package.json')); }
catch { await scaffoldModule(target, path.resolve('resources'), path.resolve('sdk'), 'example.quality'); }
await cp(path.resolve('sdk'), path.join(target, 'sdk'), { recursive: true });
execFileSync(process.execPath, [path.resolve('node_modules/typescript/bin/tsc'), '--noEmit', '-p', path.join(target, 'tsconfig.json')], { stdio: 'inherit' });
await build({ entryPoints: [path.join(target, 'src/extension.ts')], outfile: path.join(target, 'dist/extension.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
execFileSync(process.execPath, [path.resolve('node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--allow-missing-repository'], { cwd: target, stdio: 'inherit' });

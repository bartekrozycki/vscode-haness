import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Load host adapters against an explicit VS Code boundary, without an editor process. */
export async function loadHost<T>(entry: string, vscode: unknown): Promise<T> {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
  const module = { exports: {} }, require = createRequire(path.resolve('package.json'));
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (name: string) => name === 'vscode' ? vscode : require(name), module, module.exports,
  );
  return module.exports as T;
}

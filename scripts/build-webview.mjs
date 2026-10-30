import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const webviewBuild = { entryPoints: ['src/ui/webview/main.js'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife' };
export async function buildWebview() { await build(webviewBuild); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWebview();

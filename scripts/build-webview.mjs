import { build } from 'esbuild';
export const webviewBuild = { entryPoints: ['src/ui/webview/main.js'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife' };
export async function buildWebview() { await build(webviewBuild); }
if (process.argv[1]?.endsWith('/build-webview.mjs')) await buildWebview();

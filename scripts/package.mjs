import { execFileSync } from 'node:child_process';
const platform = process.platform === 'win32' ? 'win32' : process.platform;
const target = `${platform}-${process.arch}`;
execFileSync(process.execPath, ['node_modules/@vscode/vsce/vsce', 'package', '--target', target, '--allow-missing-repository'], { stdio: 'inherit' });

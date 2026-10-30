import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dashboardHtml as shell } from '../../src/ui/webview/shell';
import type { Snapshot } from '../../src/contracts/model';
import type { LiveSession } from '../../src/contracts/live';
const script = readFileSync(path.resolve('dist/webview.js'), 'utf8');
export const dashboardHtml = (csp: string, snapshot?: Snapshot, error?: string, live: LiveSession[] = [], tab?: string) => shell({ cspSource: csp, snapshot, error, live, initialTab: tab, script });

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const demoRoot = path.resolve(process.argv[2] || path.join(extensionRoot, '..', 'copilot-sdlc-demo'));
await mkdir(path.join(extensionRoot, 'out'), { recursive: true });
await build({ entryPoints: [path.join(extensionRoot, 'src/bootstrap/demo.ts')], outfile: path.join(extensionRoot, 'out/demo-helpers.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const { initialize, HarnessClient, exists } = createRequire(import.meta.url)('../out/demo-helpers.cjs');
const marker = path.join(demoRoot, '.copilot-sdlc/demo.json');
if (!(await exists(marker))) {
  if (await exists(demoRoot) && (await readdir(demoRoot)).length) throw new Error(`Katalog ${demoRoot} nie jest pustym projektem demo. Niczego nie nadpisano.`);
  await mkdir(demoRoot, { recursive: true });
  await initialize(demoRoot, path.join(extensionRoot, 'resources'));
  await mkdir(path.join(demoRoot, 'src'), { recursive: true });
  await mkdir(path.join(demoRoot, 'tests'), { recursive: true });
  const files = {
    'package.json': JSON.stringify({ name: 'copilot-sdlc-demo', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test', start: 'node src/demo.mjs' } }, null, 2) + '\n',
    '.gitignore': 'node_modules/\n.DS_Store\n__pycache__/\n',
    'AGENTS.md': "# Demo project rules\n\nWork only on approved tasks. This is a small Node.js module without dependencies.\nTests: `node --test`. Commit only your changes with `(WI-NNN)` in the subject.\nDo not push, publish or switch branches. Initial history and usage are sample data.\n",
    'src/tasks.mjs': `/** Filter demo tasks. The search enhancement is intentionally left for WI-004. */
export function filterTasks(tasks, query = '') {
  return tasks.filter(task => task.title.includes(query));
}

/** Count task statuses without modifying the input. */
export function summarizeTasks(tasks) {
  return tasks.reduce((result, task) => {
    result[task.status] = (result[task.status] || 0) + 1;
    return result;
  }, {});
}
`,
    'src/demo.mjs': `import { filterTasks, summarizeTasks } from './tasks.mjs';
const tasks = [
  { title: 'Order filter', status: 'ready' },
  { title: 'Session metrics', status: 'review' },
  { title: 'Permission checks', status: 'blocked' }
];
console.table(filterTasks(tasks, process.argv[2] || ''));
console.table(summarizeTasks(tasks));
`,
    'tests/tasks.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks, summarizeTasks } from '../src/tasks.mjs';

test('empty search returns every task', () => {
  const tasks = [{ title: 'Filtr', status: 'ready' }];
  assert.deepEqual(filterTasks(tasks), tasks);
});
test('search filters by an exact fragment', () => {
  const tasks = [{ title: 'Order filter' }, { title: 'Session metrics' }];
  assert.deepEqual(filterTasks(tasks, 'orders'), [tasks[0]]);
});
test('summary counts each status without changing the tasks', () => {
  const tasks = Object.freeze([Object.freeze({ status: 'ready' }), Object.freeze({ status: 'ready' }), Object.freeze({ status: 'review' })]);
  assert.deepEqual(summarizeTasks(tasks), { ready: 2, review: 1 });
});
`,
    'README.md': "# Copilot SDLC demo\n\nOpen **SDLC: Open workbench**. The single panel shows tasks, live sessions and usage.\nInitial history and usage are synthetic; creating this demo makes no model calls.\n\nWI-004 is a real implementation exercise: case-insensitive search with trimmed whitespace.\nApprove implementation, then select Implement. After handoff select Verify.\nGates run `node --test` against the committed snapshot.\n\nRun `npm test` or `npm start`. Project agent definitions are in `.github/agents/`;\nconfiguration is in `.copilot-sdlc/config.json`. See `.work-item/README.md` for the protocol.\n",
  };
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(demoRoot, name), contents, { flag: 'wx' });
  const configPath = path.join(demoRoot, '.copilot-sdlc/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.gates = [{ name: 'Node.js — testy', command: ['node', '--test'], timeoutSeconds: 60 }];
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const client = new HarnessClient(demoRoot);
  const call = (operation, values = {}) => client.invoke({ operation, actor: 'demo-fixture', ...values });
  const definitions = [
    ['Status summary', 'W1: summarizeTasks counts each occurrence of a status.\nW2: the function does not mutate its input.', 'SHOULD'],
    ['Task table in the terminal', 'W1: npm start displays the task list and summary.\nW2: the program requires no external packages.', 'SHOULD'],
    ['Empty list result', 'W1: summarizeTasks([]) returns an empty object.\nW2: a regression test covers an empty list.', 'MUST'],
    ['Case-insensitive search with trimmed whitespace', 'W1: filterTasks ignores case in the title and query.\nW2: leading and trailing query whitespace is ignored.\nW3: an empty query returns all tasks.\nW4: add regression tests; do not mutate input.\n\nContext: src/tasks.mjs, tests/tasks.test.mjs. Out of scope: new dependencies, UI and harness changes.', 'MUST'],
    ['Archive completed tasks', 'W1: archive behavior requires a human decision before implementation.', 'COULD'],
    ['Custom tool documentation', 'W1: README shows a JSON tool example.\n\nExample active task; no agent is currently running.', 'COULD'],
  ];
  for (const [title, requirements, priority] of definitions) await call('create', { title, requirements, priority, area: 'demo', estimate: 3 });
  const git = (...args) => execFileSync('git', args, { cwd: demoRoot, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '--', 'package.json', 'README.md', 'AGENTS.md', '.gitignore', 'src', 'tests', 'tools', '.copilot-sdlc', '.github', '.work-item');
  git('-c', 'user.name=Copilot SDLC Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-qm', 'chore: projekt demonstracyjny i harness');
  let serial = 0;
  async function finish(run, role, item, input, output, seconds) {
    await call('run_finish', { run, outcome: 'demo', actor: `sdk-${role}`, session: `demo-${role}-${++serial}`, model: 'demo / sample data',
      input_tokens: input, output_tokens: output, cache_read_tokens: input * 2, cache_write_tokens: 0,
      premium_requests: role === 'judge' ? 0.5 : 0.25, duration_ms: seconds * 1000, turns: 4, tool_calls: 7,
      report: `# ${item} — example\n\nDemonstration data. No model was called and no tokens were charged.\n` });
  }
  async function handoff(item, input, output, seconds) {
    await call('approve', { id: item });
    await call('update', { id: item, status: 'active', actor: 'sdk-worker' });
    const run = `demo-${item}-worker`;
    await call('run_start', { id: item, run, role: 'worker', actor: 'sdk-worker' });
    git('-c', 'user.name=Copilot SDLC Demo', '-c', 'user.email=demo@example.invalid', 'commit', '--allow-empty', '-qm', `demo: sample handoff (${item})`);
    const sha = git('rev-parse', 'HEAD');
    await call('gates', { id: item, commit: sha });
    await call('update', { id: item, status: 'review', actor: 'sdk-worker', commit: sha, evidence: 'Demonstration handoff. The real node --test gate passed; the agent response and usage are sample data.' });
    await finish(run, 'worker', item, input, output, seconds);
  }
  async function verdict(item, status, evidence) {
    const run = `demo-${item}-judge`;
    await call('run_start', { id: item, run, role: 'judge', actor: 'sdk-judge' });
    await call('update', { id: item, status, actor: 'sdk-judge', evidence: `Demonstration review: ${evidence}` });
    await finish(run, 'judge', item, 6200, 900, 34);
  }
  await handoff('WI-001', 12400, 2100, 73);
  await verdict('WI-001', 'accepted', 'The summary and absence of input mutation are covered by a real test.');
  await call('update', { id: 'WI-001', status: 'closed' });
  await handoff('WI-002', 8600, 1500, 52);
  await handoff('WI-003', 10400, 1800, 64);
  await verdict('WI-003', 'changes', 'Missing a dedicated empty-list regression test.');
  await call('ask', { id: 'WI-005', question: 'Should closed tasks remain in the main table?', options: { A: 'Keep them in TSV and filter them in the view', B: 'Move them to a separate archive table' }, recommended: 'A' });
  await call('update', { id: 'WI-005', status: 'blocked', reason: 'Human decision: archive behavior' });
  await call('approve', { id: 'WI-006' });
  await call('update', { id: 'WI-006', status: 'active', actor: 'demo-preview' });
  await call('lesson', { id: 'WI-003', actor: 'sdk-judge', rule: 'Aggregation tests must also cover an empty collection.', evidence: 'Example WI-003 review: missing empty-list coverage.', weight: 'high', target: 'test' });
  await writeFile(marker, JSON.stringify({ version: 1, syntheticMetrics: true, modelsInvoked: false }, null, 2) + '\n');
  git('add', '--', '.work-item', '.copilot-sdlc/config.json', '.copilot-sdlc/demo.json');
  git('-c', 'user.name=Copilot SDLC Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-qm', 'demo: sample states, history and synthetic usage');
  execFileSync('node', ['--test'], { cwd: demoRoot, stdio: 'inherit' });
  console.log(`Utworzono demo: ${demoRoot}`);
} else {
  console.log(`Opening the existing demo without resetting data: ${demoRoot}`);
}
const manifest = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
const vsix = path.join(extensionRoot, `copilot-sdk-sdlc-${process.platform}-${process.arch}-${manifest.version}.vsix`);
execFileSync('code', ['--install-extension', vsix, '--force'], { stdio: 'inherit' });
execFileSync('code', ['--new-window', demoRoot], { stdio: 'inherit' });
console.log(`DEMO_ROOT=${demoRoot}`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TestToolRegistry as ToolRegistry, testRunner, testRunnerServices } from './support/services';
import { ModuleRegistry } from '../src/application/modules/registry';
import { scaffoldModule } from '../src/infrastructure/scaffolding/module';
import type { ModuleContext, SdlcModule } from '../src/contracts/api';
import type { Snapshot, ToolDefinition } from '../src/contracts/model';

const definition = (name: string): ToolDefinition => ({ name, displayName: name, description: 'Example', readOnly: true, inputSchema: { type: 'object' } });
const descriptor = (id = 'acme.quality'): SdlcModule => ({ apiVersion: 1, id, title: 'Quality', version: '1.0.0' });
const ctx = (item?: string): ModuleContext => ({ root: os.tmpdir(), item, signal: new AbortController().signal, snapshot: { tasks: [{ id: 'WI-001', title: 'Original' }], history: [], metrics: [], questions: [], lessons: [], runs: [], config: {} } as unknown as Snapshot });
function registry() { const tools = new ToolRegistry(path.resolve('resources'), () => 'python3', async () => {}); return { tools, modules: new ModuleRegistry(tools) }; }

test('module registration is atomic and disposal cannot remove a new registration', async () => {
  const { tools, modules } = registry();
  const collision = tools.registerTool(definition('already_present'), async () => 'original');
  assert.throws(() => modules.register({ ...descriptor(), tools: [{ definition: definition('will_rollback'), invoke: async () => {} }, { definition: definition('already_present'), invoke: async () => {} }] }), /duplicate/);
  assert.deepEqual(modules.list(), []);
  await assert.rejects(tools.invoke('will_rollback', {}, { root: os.tmpdir() }), /Unknown tool/);
  collision.dispose();
  const first = modules.register({ ...descriptor(), tools: [{ definition: definition('acme_quality'), invoke: async () => 1 }] });
  assert.equal(await tools.invoke('acme_quality', {}, { root: os.tmpdir() }), 1);
  first.dispose();
  const second = modules.register({ ...descriptor(), tools: [{ definition: definition('acme_quality'), invoke: async () => 2 }] });
  first.dispose();
  assert.equal(await tools.invoke('acme_quality', {}, { root: os.tmpdir() }), 2);
  second.dispose();
  await assert.rejects(tools.invoke('acme_quality', {}, { root: os.tmpdir() }), /Unknown tool/);
});

test('widgets share a single layout, receive scoped copies, and fail independently', async () => {
  const { modules } = registry(), original = ctx('WI-001');
  modules.register({ ...descriptor(), widgets: [
    { id: 'workspace', title: 'Workspace', placement: 'workspace', provide: c => { assert.equal(c.item, undefined); c.snapshot!.tasks[0].title = 'Changed'; return { kind: 'text', text: '</script>example' }; } },
    { id: 'task', title: 'Task', placement: 'task', provide: c => { assert.equal(c.item, 'WI-001'); assert.equal(c.snapshot!.tasks[0].title, 'Original'); return { kind: 'metrics', values: [{ label: 'Task', value: c.item! }] }; } },
    { id: 'broken', title: 'Broken', placement: 'workspace', provide: () => { throw new Error('upstream unavailable'); } },
    { id: 'empty', title: 'Empty', placement: 'workspace', provide: () => undefined },
  ] });
  const result = await modules.resolve(original);
  assert.equal(result.widgets.length, 3);
  assert.equal(result.widgets.find(w => w.id.endsWith('/broken'))?.error, 'upstream unavailable');
  assert.equal(original.snapshot!.tasks[0].title, 'Original');
  assert.equal((await modules.resolve(ctx())).widgets.some(w => w.placement === 'task'), false);
});

test('actions are namespaced, require selection and refresh only their workspace', async () => {
  const { modules } = registry(), events: unknown[] = [];
  modules.onDidEvent(e => events.push(e));
  let selected = '';
  const handle = modules.register({ ...descriptor(), actions: [{ id: 'report', title: 'Report', scope: 'task', run: c => { selected = c.item!; return 'report'; } }] });
  await assert.rejects(modules.invoke('acme.quality/report', ctx()), /Select a task/);
  await assert.rejects(modules.invoke('acme.quality/report/extra', ctx('WI-001')), /Unknown/);
  assert.equal(await modules.invoke('acme.quality/report', ctx('WI-001')), 'report');
  assert.equal(selected, 'WI-001');
  assert.deepEqual(events.at(-1), { type: 'workspace.changed', root: os.tmpdir() });
  handle.dispose(); await assert.rejects(modules.invoke('acme.quality/report', ctx('WI-001')), /Unknown/);
});

test('module protocol rejects incompatible identities and unknown content', async () => {
  const { modules } = registry();
  assert.throws(() => modules.register({ ...descriptor(), apiVersion: 2 } as unknown as SdlcModule), /version/);
  assert.throws(() => modules.register(descriptor('invalid')), /id/);
  modules.register({ ...descriptor(), widgets: [{ id: 'html', title: 'HTML', placement: 'workspace', provide: () => ({ kind: 'html', html: '<script>test</script>' }) as any }] });
  assert.match((await modules.resolve(ctx())).widgets[0].error!, /Unsupported/);
});

test('subscriber failures and disposal do not block other subscribers', () => {
  const { modules } = registry(); let delivered = 0;
  modules.onDidEvent(() => { throw new Error('listener failed'); });
  const listener = modules.onDidEvent(() => delivered++);
  modules.emit({ type: 'session.changed', root: '/example', run: 'run' });
  listener.dispose(); modules.emit({ type: 'modules.changed' });
  assert.equal(delivered, 1);
});

test('explicit module scaffold is standalone, versioned, and never overwrites a folder', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'sdlc-module-')), target = path.join(parent, 'quality');
  try {
    await scaffoldModule(target, path.resolve('resources'), path.resolve('sdk'), 'acme.quality');
    const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.extensionDependencies, ['project-sdlc.copilot-sdk-sdlc']);
    assert.equal(manifest.publisher, 'acme');
    assert.ok((await readFile(path.join(target, 'src/extension.ts'), 'utf8')).includes("id: 'acme.quality'"));
    assert.ok((await readdir(path.join(target, 'sdk'))).includes('api.d.ts'));
    await assert.rejects(scaffoldModule(target, path.resolve('resources'), path.resolve('sdk'), 'acme.quality'), /EEXIST/);
    await assert.rejects(scaffoldModule(path.join(parent, 'bad'), '', '', '../escape'), /publisher.module/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('a stalled widget times out and signals cancellation without losing other widgets', async () => {
  const { modules } = registry(); let aborted = false;
  modules.register({ ...descriptor(), widgets: [
    { id: 'slow', title: 'Slow', placement: 'workspace', provide: ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ kind: 'text', text: 'too late' }); })) },
    { id: 'fast', title: 'Fast', placement: 'workspace', provide: () => ({ kind: 'text', text: 'ready' }) },
  ] });
  const result = await modules.resolve(ctx());
  assert.equal(aborted, true);
  assert.match(result.widgets.find(w => w.id.endsWith('/slow'))!.error!, /timed out/);
  assert.deepEqual(result.widgets.find(w => w.id.endsWith('/fast'))!.content, { kind: 'text', text: 'ready' });
  modules.dispose(); assert.deepEqual(modules.list(), []);
});

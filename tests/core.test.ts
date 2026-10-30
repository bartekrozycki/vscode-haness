import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialize, TestProjectClient as HarnessClient, loadAgents, projectPath, exists } from './support/project';
import { TestToolRegistry as ToolRegistry, testRunner, testRunnerServices } from './support/services';
import { Usage, summarize } from '../src/domain/usage';
import { dashboardHtml } from './support/dashboard';
import type { Snapshot } from '../src/contracts/model';

const resources = path.resolve('resources');
async function project(fn: (root: string, client: HarnessClient) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-test-'));
  try { await fn(root, new HarnessClient(root)); } finally { await rm(root, { recursive: true, force: true }); }
}

test('initialization is explicit, idempotent and preserves edited agents', async () => project(async (root, client) => {
  assert.equal(await client.initialized(), false);
  await assert.rejects(client.snapshot(), /Initialize project harness/);
  assert.deepEqual(await import('node:fs/promises').then(fs => fs.readdir(root)), []);
  const first = await initialize(root, resources);
  assert.ok(first.created.includes('tools/work-items.py'));
  const agent = path.join(root, '.github/agents/sdlc-worker.agent.md');
  const contents = await readFile(agent, 'utf8');
  await writeFile(agent, contents + '\nMy project rule.\n');
  const second = await initialize(root, resources);
  assert.equal(second.created.length, 0);
  assert.ok((await loadAgents(root)).find(a => a.name === 'sdlc-worker')!.prompt.includes('My project rule.'));
  assert.equal((await client.snapshot()).tasks.length, 0);
}));

test('symlinks and traversal cannot escape project during initialization', async () => project(async root => {
  await assert.rejects(projectPath(root, '../outside'), /leaves/);
  await symlink(os.tmpdir(), path.join(root, '.copilot-sdlc'));
  await assert.rejects(initialize(root, resources), /Symlink/);
}));

test('collision with an unrelated harness stops before creating configuration', async () => project(async root => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, 'tools'));
  await writeFile(path.join(root, 'tools/work-items.py'), '# existing unrelated tool\n');
  await assert.rejects(initialize(root, resources), /another harness/);
  assert.equal(await exists(path.join(root, '.copilot-sdlc')), false);
  assert.equal(await exists(path.join(root, '.github')), false);
}));

test('project tool JSON is immediately discoverable, validated and argv is not shell code', async () => project(async (root) => {
  await initialize(root, resources);
  const registry = new ToolRegistry(resources, () => 'python3', async () => {});
  const tool = { name: 'echo_argument', displayName: 'Echo', description: 'Echo an argument', readOnly: true,
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    command: ['python3', '-c', 'import sys; print(sys.argv[1])', '${input.text}'] };
  await writeFile(path.join(root, '.copilot-sdlc/tools/echo.json'), JSON.stringify(tool));
  const value = 'hello; touch /tmp/should-never-run $(false)';
  const output = await registry.invoke('echo_argument', { text: value }, { root, approve: async () => true });
  assert.equal(String(output).trim(), value);
  await assert.rejects(registry.invoke('echo_argument', { text: 5 }, { root }), /string/);
  await assert.rejects(registry.invoke('echo_argument', { text: 'x' }, { root, approve: async () => false }), /not approved/);
}));

test('SDK sessions cannot approve work, answer for user or review themselves through tools', async () => project(async root => {
  await initialize(root, resources);
  const registry = new ToolRegistry(resources, () => 'python3', async () => {});
  const context = { root, role: 'worker', item: 'WI-001', actor: 'sdk-worker' };
  await assert.rejects(registry.invoke('sdlc_update_task', { operation: 'approve', id: 'WI-001' }, context), /human/);
  await assert.rejects(registry.invoke('sdlc_questions', { operation: 'answer', id: 'WI-001', question_id: 'P1', answer: 'A' }, context), /human/);
  await assert.rejects(registry.invoke('sdlc_update_task', { operation: 'update', id: 'WI-002', status: 'active' }, context), /scoped/);
  await assert.rejects(registry.invoke('sdlc_update_task', { operation: 'update', id: 'WI-001', status: 'accepted' }, context), /cannot review/);
}));

test('usage deduplicates events and preserves unknown USD instead of using multiplier', () => {
  const usage = new Usage();
  const event = { id: '1', type: 'assistant.usage', data: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cost: 0.25, model: 'test' } };
  usage.add(event); usage.add(event);
  assert.equal(usage.fields().input_tokens, 100);
  assert.equal(usage.fields().premium_requests, 0.25);
  assert.equal(usage.fields().cost_usd, '');
  assert.equal(summarize([{ premium_requests: '', cost_usd: '' }]).costUsd, undefined);
});

test('dashboard escapes script injection and displays actual TSV field names', () => {
  const snapshot = { tasks: [{ id: 'WI-001', title: '</script><script>alert(1)</script>' }], metrics: [], questions: [], history: [], lessons: [], runs: [], config: {} } as unknown as Snapshot;
  const html = dashboardHtml('test:', snapshot);
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  assert.ok(html.includes('textContent'));
  assert.ok(html.includes('default-src \'none\''));
  assert.equal((html.match(/<script /g) || []).length, 1);
});

test('extension API accepts custom tools with disposable registration', async () => project(async root => {
  const registry = new ToolRegistry(resources, () => 'python3', async () => {});
  const handle = registry.registerTool({ name: 'test_plugin', displayName: 'Test', description: 'Test', readOnly: true, inputSchema: { type: 'object' } }, async () => ({ ok: true }));
  assert.deepEqual(await registry.invoke('test_plugin', {}, { root }), { ok: true });
  handle.dispose();
  await assert.rejects(registry.invoke('test_plugin', {}, { root }), /Unknown tool/);
}));

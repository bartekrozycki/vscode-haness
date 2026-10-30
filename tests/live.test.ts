import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Script } from 'node:vm';
import { FileSessionLog as LiveSessions } from '../src/infrastructure/sessions/file-session-log';
import { liveForView } from '../src/host/vscode/live-payload';
import { withRunHistory } from '../src/application/queries/run-history';
import { dashboardHtml } from './support/dashboard';
import type { Snapshot } from '../src/contracts/model';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-live-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const meta = (run = 'run-1') => ({ run, item: 'WI-001', role: 'worker', model: 'auto', permissions: 'bypass' });

test('opening a live view never initializes a project or writes files', async () => fixture(async root => {
  assert.deepEqual(await new LiveSessions().list(root), []);
  assert.deepEqual(await readdir(root), []);
}));

test('streaming messages, shell output, failures and usage update before the session ends', async () => fixture(async root => {
  let notifications = 0;
  const live = new LiveSessions(() => notifications++);
  live.begin(root, meta()); live.connect(root, 'run-1', 'sdk-session');
  live.event(root, 'run-1', { id: 'a', type: 'assistant.message_delta', data: { messageId: 'm', deltaContent: 'Sprawdzam ' } });
  live.event(root, 'run-1', { id: 'b', type: 'assistant.message_delta', data: { messageId: 'm', deltaContent: 'testy.' } });
  live.event(root, 'run-1', { id: 'c', type: 'assistant.message', data: { messageId: 'm', content: 'Sprawdzam testy.' } });
  live.event(root, 'run-1', { id: 'd', type: 'tool.execution_start', data: { toolCallId: 't', toolName: 'bash', arguments: { command: 'node --test' } } });
  live.event(root, 'run-1', { id: 'e', type: 'tool.shell_output', data: { toolCallId: 't', text: 'TAP version 13\n' } });
  const usage = { id: 'usage', type: 'assistant.usage', data: { inputTokens: 200, outputTokens: 50, cacheReadTokens: 100, model: 'test-model', cost: 0.25 } };
  live.event(root, 'run-1', usage); live.event(root, 'run-1', usage);
  let session = (await live.list(root))[0];
  assert.equal(session.finished, '');
  assert.equal(session.controllable, true);
  assert.equal(session.entries.filter(e => e.kind === 'message').length, 1);
  assert.equal(session.entries.find(e => e.kind === 'message')!.text, 'Sprawdzam testy.');
  assert.equal(session.entries.find(e => e.kind === 'tool')!.status, 'running');
  assert.equal(session.inputTokens, 200);
  assert.equal(session.model, 'test-model');
  assert.equal(session.premiumRequests, 0.25);
  live.event(root, 'run-1', { type: 'tool.execution_complete', data: { toolCallId: 't', success: false, error: { message: 'Test failed' }, result: { content: '1 failed' } } });
  session = (await live.list(root))[0];
  assert.equal(session.entries.find(e => e.kind === 'tool')!.status, 'failed');
  assert.match(session.entries.find(e => e.kind === 'tool')!.text, /1 failed/);
  assert.ok(notifications >= 8);
  await live.finish(root, 'run-1', 'failed', new Error('Test failed'));
}));

test('TSV log restores a completed transcript and excludes private or binary payloads', async () => fixture(async root => {
  const live = new LiveSessions(); live.begin(root, meta()); live.connect(root, 'run-1', 'sdk-session');
  live.event(root, 'run-1', { type: 'assistant.message', data: { messageId: 'm', content: 'Tekst\t"cytat"\nNowa linia', reasoningText: 'PRIVATE_TRACE', encryptedContent: 'SECRET_BINARY' } });
  live.event(root, 'run-1', { type: 'assistant.reasoning_delta', data: { deltaContent: 'PRIVATE_TRACE' } });
  live.event(root, 'run-1', { type: 'tool.execution_complete', data: { toolCallId: 'tool', success: true, result: { content: [{ type: 'image', data: 'SECRET_IMAGE' }, { type: 'text', text: 'text output' }] } } });
  live.event(root, 'run-1', { id: 'u', type: 'assistant.usage', data: { inputTokens: 100, outputTokens: 20, model: 'test' } });
  await live.finish(root, 'run-1', 'completed');
  const content = await readFile(path.join(root, '.work-item/live/run-1.tsv'), 'utf8');
  assert.ok(content.startsWith('timestamp\tevent\tdata\n'));
  assert.ok(!content.includes('PRIVATE_TRACE'));
  assert.ok(!content.includes('SECRET_BINARY'));
  assert.ok(!content.includes('SECRET_IMAGE'));
  const restored = (await new LiveSessions().list(root))[0];
  assert.equal(restored.status, 'completed'); assert.equal(restored.controllable, false);
  assert.equal(restored.inputTokens, 100);
  assert.equal(restored.entries.find(e => e.kind === 'message')!.text, 'Tekst\t"cytat"\nNowa linia');
  assert.equal(restored.entries.find(e => e.kind === 'tool')!.text, 'text output');
}));

test('different sessions remain isolated and waiting/cancelled states are visible', async () => fixture(async root => {
  const live = new LiveSessions(); live.begin(root, meta('a')); live.begin(root, { ...meta('b'), item: 'WI-002' });
  live.activity(root, 'a', 'Question for the user', true);
  live.event(root, 'b', { type: 'assistant.message', data: { messageId: 'b-message', content: 'Only B' } });
  assert.equal((await live.list(root)).find(s => s.run === 'a')!.status, 'waiting');
  assert.ok(!(await live.list(root)).find(s => s.run === 'a')!.entries.some(e => e.text === 'Only B'));
  await live.finish(root, 'a', 'cancelled');
  assert.equal((await live.list(root)).find(s => s.run === 'a')!.controllable, false);
  await live.finish(root, 'b', 'completed');
}));

test('older runs appear explicitly without an invented live transcript', () => {
  const snapshot = { runs: [{ id: 'old', item: 'WI-001', role: 'worker', started: '2026-10-29T12:00:00Z', finished: '2026-10-29T12:01:00Z', outcome: 'completed', session: 'sdk-id' }], metrics: [{ run: 'old', model: 'test', input_tokens: '120' }] } as unknown as Snapshot;
  const session = withRunHistory([], snapshot)[0];
  assert.equal(session.inputTokens, 120); assert.equal(session.entries.length, 0);
  assert.equal(session.controllable, false); assert.match(session.activity, /predates/);
});

test('webview script parses and uses incremental messages with isolated session controls', () => {
  const html = dashboardHtml('test:', undefined, undefined, [], 'live');
  const source = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1];
  assert.doesNotThrow(() => new Script(source));
  assert.ok(source.length > 1000, 'Includes the compiled renderer, not only the HTML shell');
  assert.ok(!/require\(["']vscode/.test(source));
});

test('live updates send only the selected transcript while retaining all session summaries', async () => fixture(async root => {
  const live = new LiveSessions(); live.begin(root, meta('a')); live.begin(root, meta('b'));
  live.event(root, 'a', { type: 'assistant.message', data: { messageId: 'a', content: 'First session' } });
  live.event(root, 'b', { type: 'assistant.message', data: { messageId: 'b', content: 'Second session' } });
  const payload = liveForView(await live.list(root), 'b');
  assert.equal(payload.length, 2);
  assert.equal(payload.find(s => s.run === 'a')!.entries.length, 0);
  assert.equal(payload.find(s => s.run === 'a')!.hasLog, true);
  assert.ok(payload.find(s => s.run === 'b')!.entries.some(e => e.text === 'Second session'));
  await live.finish(root, 'a', 'completed'); await live.finish(root, 'b', 'completed');
}));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CopilotSession, SessionEvent } from '@github/copilot-sdk';
import { closeCopilotSession, runCopilotSession } from '../src/integrations/copilot-sdk/completion';

const event = (type: string, data: unknown = {}, agentId?: string) => ({ type, data, agentId }) as SessionEvent;
function session(send: () => Promise<unknown> = () => new Promise(() => {})) {
  let listener = (_event: SessionEvent) => {}, unsubscribed = false;
  const sdk = { on: (fn: typeof listener) => { listener = fn; return () => { unsubscribed = true; }; }, sendAndWait: send } as unknown as Pick<CopilotSession, 'on' | 'sendAndWait'>;
  return { sdk, emit: (value: SessionEvent) => listener(value), detached: () => unsubscribed };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('idle completes the adapter even when the SDK completion RPC remains pending', async () => {
  const fake = session(), seen: string[] = [];
  const job = runCopilotSession(fake.sdk, 'Run', new AbortController().signal, 1000, e => seen.push(e.type));
  fake.emit(event('session.idle'));
  await job;
  assert.deepEqual(seen, ['session.idle']); assert.equal(fake.detached(), true);
});

test('a final main-agent turn recovers missing idle; tool turns and subagents do not finish the run', async () => {
  const fake = session(); let finished = false;
  const job = runCopilotSession(fake.sdk, 'Run', new AbortController().signal, 1000, () => {}, 5).then(() => { finished = true; });
  fake.emit(event('assistant.message', { content: 'Checking', toolRequests: [{ toolCallId: 't' }] }));
  fake.emit(event('tool.execution_start', { toolCallId: 't' }));
  fake.emit(event('assistant.turn_end'));
  fake.emit(event('assistant.message', { content: 'Child done', toolRequests: [] }, 'child'));
  fake.emit(event('assistant.turn_end', {}, 'child'));
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(finished, false);
  fake.emit(event('tool.execution_complete', { toolCallId: 't' }));
  fake.emit(event('assistant.turn_start'));
  fake.emit(event('assistant.message', { content: 'Done', toolRequests: [] }));
  await nextTurn(); assert.equal(finished, false, 'A message alone is not completion');
  fake.emit(event('assistant.turn_end'));
  await job; assert.equal(fake.detached(), true);
});

test('a continuation cancels the final-turn fallback', async () => {
  const fake = session(); let finished = false;
  const job = runCopilotSession(fake.sdk, 'Run', new AbortController().signal, 1000, () => {}, 5).then(() => { finished = true; });
  fake.emit(event('assistant.message', { content: 'Done', toolRequests: [] }));
  fake.emit(event('assistant.turn_end'));
  fake.emit(event('assistant.turn_start'));
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(finished, false);
  fake.emit(event('session.idle')); await job;
});

test('cancellation settles a stuck SDK call immediately and releases its listener', async () => {
  const fake = session(), controller = new AbortController();
  const job = runCopilotSession(fake.sdk, 'Run', controller.signal, 900000, () => {});
  controller.abort(new Error('User stopped'));
  await assert.rejects(job, /User stopped/); assert.equal(fake.detached(), true);
});

test('provider and transport errors remain failures', async () => {
  const fake = session();
  const job = runCopilotSession(fake.sdk, 'Run', new AbortController().signal, 1000, () => {});
  fake.emit(event('session.error', { message: 'Quota unavailable' }));
  await assert.rejects(job, /Quota unavailable/);
  const transport = session(async () => { throw new Error('Disconnected'); });
  await assert.rejects(runCopilotSession(transport.sdk, 'Run', new AbortController().signal, 1000, () => {}), /Disconnected/);
  assert.equal(transport.detached(), true);
});

test('unresponsive disconnect is bounded and force-stops the owned client', async () => {
  let forced = 0;
  await closeCopilotSession({ stop: async () => [], forceStop: async () => { forced++; } }, { disconnect: () => new Promise(() => {}) }, 5);
  assert.equal(forced, 1);
});

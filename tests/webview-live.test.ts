import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLiveUpdate } from '../src/ui/webview/live-update';
import type { LiveSession } from '../src/contracts/live';

const session = (run: string, status = 'running') => ({ run, item: 'WI-001', status, entries: [{ kind: 'message', text: run }] }) as LiveSession;
test('new session data and selection replace the previously selected historical run together', () => {
  const old = session('old', 'completed'), current = session('new');
  const state = { live: [old], liveVersion: 1, selectedItem: old.item, selectedRun: old.run };
  assert.ok(applyLiveUpdate(state, { live: [current, old], liveVersion: 2, selection: { item: current.item, run: current.run } }));
  assert.equal(state.selectedRun, 'new'); assert.equal(state.live.find(s => s.run === state.selectedRun)?.entries[0].text, 'new');
});

test('a slow snapshot cannot restore a running session after its completion update', () => {
  const state = { live: [session('new')], liveVersion: 2, selectedItem: 'WI-001', selectedRun: 'new' };
  applyLiveUpdate(state, { live: [session('new', 'completed')], liveVersion: 4 });
  assert.equal(applyLiveUpdate(state, { live: [session('new')], liveVersion: 3, selection: { run: 'old' } }), false);
  assert.equal(state.live[0].status, 'completed'); assert.equal(state.selectedRun, 'new');
  assert.equal(applyLiveUpdate(state, {}), false); assert.equal(state.live[0].status, 'completed');
});

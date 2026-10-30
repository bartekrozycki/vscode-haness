import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration } from '../src/ui/webview/duration';

const start = '2026-01-01T00:00:00Z';
test('terminal sessions freeze at finished or last update instead of advancing', () => {
    const now = Date.parse('2026-01-01T00:10:00Z');
    for (const status of ['interrupted', 'failed', 'cancelled', 'completed', 'limit']) {
        assert.equal(duration({ started: start, updated: '2026-01-01T00:01:12Z', status }, now), '1:12');
        assert.equal(duration({ started: start, status }, now), '—');
    }
    assert.equal(duration({ started: start, finished: '2026-01-01T00:00:30Z', updated: '2026-01-01T00:01:12Z', status: 'completed' }, now), '0:30');
    assert.equal(duration({ started: start, status: 'running' }, now), '10:00');
    assert.equal(duration({ started: '', status: 'running' }, now), '—');
});

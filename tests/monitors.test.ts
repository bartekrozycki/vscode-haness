import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConnectionMonitorSource } from '../src/infrastructure/monitors/source';
import { FileMonitorStore } from '../src/infrastructure/monitors/store';
import { MonitorEngine } from '../src/application/monitors/engine';
import type { MonitorDefinition, MonitorObservation } from '../src/contracts/monitors';
const definition: MonitorDefinition = { id: 'issues', name: 'Issues', provider: 'jira', connectionId: 'jira', intervalSeconds: 60, query: { jql: 'project = EXAMPLE', label: 'ready' }, action: { kind: 'refine', researchFocus: 'Review acceptance criteria' } };
test('baseline and durable receipts suppress replay across restarts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let items: MonitorObservation[] = [{ id: 'A-1', version: '1', kind: 'issue', labels: [] }]; let calls = 0;
    const store = new FileMonitorStore(), source = { poll: async () => items }, first = new MonitorEngine(store, source, () => { calls++; });
    try {
        assert.deepEqual(await first.list(root), []); await assert.rejects(access(path.join(root, '.work-item')));
        await first.define(root, definition); await first.activate(root, 'issues'); assert.deepEqual(await first.poll(root, 'issues'), []); assert.equal(calls, 0);
        items = [{ ...items[0], version: '2', labels: ['ready'] }]; assert.equal((await first.poll(root, 'issues')).length, 1); assert.equal(calls, 1);
        const second = new MonitorEngine(store, source, () => { calls++; }); assert.deepEqual(await second.poll(root, 'issues'), []); assert.equal((await second.events(root)).length, 1); assert.equal(calls, 1); await second.pause(root, 'issues'); await assert.rejects(second.poll(root, 'issues'), /Activate/); second.dispose();
    } finally { first.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('implementation triggers require locally mapped task and matching label', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let items: MonitorObservation[] = []; const engine = new MonitorEngine(new FileMonitorStore(), { poll: async () => items });
    try { await engine.define(root, { ...definition, query: { jql: 'project = EXAMPLE' }, action: { kind: 'implement', taskId: 'WI-1' } }); await engine.activate(root, 'issues'); await engine.poll(root, 'issues'); items = [{ id: 'A-1', version: '1', kind: 'issue', labels: [] }]; assert.equal((await engine.poll(root, 'issues')).length, 0); items = [{ ...items[0], version: '2', labels: ['hanes-implement'] }]; assert.equal((await engine.poll(root, 'issues'))[0].trigger?.taskId, 'WI-1'); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('armed workflows require private host authorization', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); const source = { poll: async () => [] }; const armed = { ...definition, action: { kind: 'refine' as const, researchFocus: 'Inspect evidence', armed: true } };
    try { const denied = new MonitorEngine(new FileMonitorStore(), source); await assert.rejects(denied.define(root, armed), /host authorization/); await assert.rejects(access(path.join(root, '.work-item'))); const allowed = new MonitorEngine(new FileMonitorStore(), source, undefined, async (_root, proposed) => proposed.id === 'issues'); await allowed.define(root, armed); assert.equal((await allowed.list(root))[0].definition.action?.armed, true); } finally { await rm(root, { recursive: true, force: true }); }
});
test('provider reads bounded pages without committing incomplete results', async () => {
    const calls: string[] = [];
    const connections = { list: async () => [{ id: 'gh', provider: 'github' as const, baseUrl: 'https://example.com', auth: 'token' as const, credentialPresent: true }], save: async () => [], remove: async () => [], execute: async (_id: string, operation: string) => { calls.push(operation); return operation === 'comments' ? [{ id: 1, body: 'Conversation', updated_at: '1' }] : [{ id: 1, body: 'Review', updated_at: '1' }]; } };
    const source = new ConnectionMonitorSource(connections); const results = await source.poll({ id: 'pr', name: 'PR', provider: 'github', connectionId: 'gh', intervalSeconds: 60, query: { owner: 'owner', repo: 'repo', pullRequestId: 1 } });
    assert.deepEqual(calls, ['comments', 'reviewComments']); assert.deepEqual(results.map(r => r.id), ['comments:1', 'reviewComments:1']);
});
test('page limit failure preserves baseline and checkpoint', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let fail = false;
    const connections = { list: async () => [{ id: 'gh', provider: 'github' as const, baseUrl: 'https://example.com', auth: 'token' as const, credentialPresent: true }], save: async () => [], remove: async () => [], execute: async (_id: string, _op: string, p: Record<string, unknown>) => fail ? Array.from({ length: 50 }, (_, i) => ({ id: `${p.page}-${i}`, body: 'x' })) : [] };
    const engine = new MonitorEngine(new FileMonitorStore(), new ConnectionMonitorSource(connections));
    try { await engine.define(root, { id: 'pr', name: 'PR', provider: 'github', connectionId: 'gh', intervalSeconds: 60, query: { owner: 'owner', repo: 'repo', pullRequestId: 1 } }); await engine.activate(root, 'pr'); fail = true; await assert.rejects(engine.poll(root, 'pr'), /page limit/); assert.equal((await engine.list(root))[0].baseline, false); assert.deepEqual(await engine.events(root), []); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('label entry is edge-triggered including removal and re-entry', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let item: MonitorObservation = { id: 'A-1', version: '1', kind: 'issue', labels: [] }; const source = { poll: async () => [item] }; const store = new FileMonitorStore(); const engine = new MonitorEngine(store, source);
    try { await engine.define(root, definition); await engine.activate(root, 'issues'); await engine.poll(root, 'issues'); item = { ...item, version: '2', labels: ['ready'] }; assert.equal((await engine.poll(root, 'issues')).length, 1); item = { ...item, version: '3' }; assert.equal((await engine.poll(root, 'issues')).length, 0); item = { ...item, version: '4', labels: [] }; await engine.poll(root, 'issues'); const restarted = new MonitorEngine(store, source); item = { ...item, version: '2', labels: ['ready'] }; assert.equal((await restarted.poll(root, 'issues')).length, 1); restarted.dispose(); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('Bitbucket follows nextPageStart and rejects non-advancing cursors', async () => {
    const starts: unknown[] = []; let bad = false;
    const connections = { list: async () => [{ id: 'bb', provider: 'bitbucket' as const, baseUrl: 'https://example.com', auth: 'token' as const, credentialPresent: true }], save: async () => [], remove: async () => [], execute: async (_id: string, _op: string, p: Record<string, unknown>) => { starts.push(p.start); return p.start === 0 ? { values: [{ comment: { id: 1, text: 'a' } }], isLastPage: false, nextPageStart: bad ? 0 : 73 } : { values: [{ comment: { id: 2, text: 'b' } }], isLastPage: true }; } };
    const source = new ConnectionMonitorSource(connections); const d: MonitorDefinition = { id: 'pr', name: 'PR', provider: 'bitbucket', connectionId: 'bb', intervalSeconds: 60, query: { project: 'P', repo: 'repo', pullRequestId: 1 } }; assert.equal((await source.poll(d)).length, 2); assert.deepEqual(starts, [0, 73]); bad = true; await assert.rejects(source.poll(d), /cursor/);
});
test('monitor notifications include empty polls and failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let count = 0, fail = false;
    const engine = new MonitorEngine(new FileMonitorStore(), { poll: async () => { if (fail) throw new Error('offline'); return []; } }, undefined, undefined, changedRoot => { assert.equal(changedRoot, root); count++; });
    try { await engine.define(root, definition); await engine.activate(root, 'issues'); await engine.poll(root, 'issues'); assert.equal(count, 3); fail = true; await assert.rejects(engine.poll(root, 'issues'), /offline/); assert.equal(count, 4); await engine.pause(root, 'issues'); assert.equal(count, 5); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('GitHub label filters require parent labels and duplicate items are collapsed', async () => {
    let labels = true; const c = { list: async () => [{ id: 'gh', provider: 'github' as const, baseUrl: 'https://example.com', auth: 'token' as const, credentialPresent: true }], save: async () => [], remove: async () => [], execute: async (_id: string, op: string) => op === 'readPullRequest' ? (labels ? { labels: [{ name: 'ready' }] } : {}) : op === 'comments' ? [{ id: 1, body: 'hi' }, { id: 1, body: 'hi' }] : [] }; const source = new ConnectionMonitorSource(c); const d: MonitorDefinition = { id: 'pr', name: 'PR', provider: 'github', connectionId: 'gh', intervalSeconds: 60, query: { owner: 'owner', repo: 'repo', pullRequestId: 1, label: 'ready' } }; const result = await source.poll(d); assert.equal(result.length, 2); assert.deepEqual(result[0].labels, ['ready']); labels = false; await assert.rejects(source.poll(d), /labels are unavailable/);
});
test('GitHub parent label changes trigger once even when comments change', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let labels: string[] = [], comments = [{ id: 1, body: 'first' }]; const c = { list: async () => [{ id: 'gh', provider: 'github' as const, baseUrl: 'https://example.com', auth: 'token' as const, credentialPresent: true }], save: async () => [], remove: async () => [], execute: async (_id: string, op: string) => op === 'readPullRequest' ? { title: 'PR', labels: labels.map(name => ({ name })) } : op === 'comments' ? comments : [] }; const engine = new MonitorEngine(new FileMonitorStore(), new ConnectionMonitorSource(c));
    try { await engine.define(root, { id: 'pr', name: 'PR', provider: 'github', connectionId: 'gh', intervalSeconds: 60, query: { owner: 'owner', repo: 'repo', pullRequestId: 1 }, action: { kind: 'implement', taskId: 'WI-1' } }); await engine.activate(root, 'pr'); await engine.poll(root, 'pr'); labels = ['hanes-implement']; assert.equal((await engine.poll(root, 'pr')).filter(e => e.trigger).length, 1); comments = [...comments, { id: 2, body: 'second' }]; assert.equal((await engine.poll(root, 'pr')).filter(e => e.trigger).length, 0); labels = []; await engine.poll(root, 'pr'); labels = ['hanes-implement']; assert.equal((await engine.poll(root, 'pr')).filter(e => e.trigger).length, 1); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('stopping a root prevents a queued timer from polling again', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let calls = 0, callback: (() => void) | undefined; const originalSet = global.setTimeout, originalClear = global.clearTimeout;
    const engine = new MonitorEngine(new FileMonitorStore(), { poll: async () => { calls++; return []; } });
    try { await engine.define(root, definition); await engine.activate(root, 'issues'); global.setTimeout = ((fn: () => void) => { callback = fn; return 1 as unknown as NodeJS.Timeout; }) as typeof setTimeout; global.clearTimeout = (() => {}) as typeof clearTimeout; await engine.start(root); assert.ok(callback); engine.stopRoot(root); callback(); await Promise.resolve(); assert.equal(calls, 0); } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('monitor evidence includes provenance and bounded source content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); let obs: MonitorObservation[] = []; const engine = new MonitorEngine(new FileMonitorStore(), { poll: async () => obs });
    try { await engine.define(root, { ...definition, query: { jql: 'project = EXAMPLE' } }); await engine.activate(root, 'issues'); await engine.poll(root, 'issues'); obs = [{ id: 'EX-1', version: '1', kind: 'issue', title: 'Title', body: '"'.repeat(300000), url: 'https://jira.example.test/browse/EX-1' }]; const result = await engine.poll(root, 'issues'); const text = result[0].trigger!.remoteText; assert.ok(text.length <= 200000); const evidence = JSON.parse(text); assert.equal(evidence.connectionId, 'jira'); assert.equal(evidence.sourceURL, 'https://jira.example.test/browse/EX-1'); assert.equal(evidence.title, 'Title'); assert.match(evidence.body, /truncated/); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('unsupported implementation monitor combinations are rejected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monitors-')); const engine = new MonitorEngine(new FileMonitorStore(), { poll: async () => [] });
    try { await assert.rejects(engine.define(root, { ...definition, query: { jql: 'project = EX', commentContains: 'go' }, action: { kind: 'implement', taskId: 'WI-1' } }), /cannot use a comment filter/); await assert.rejects(engine.define(root, { ...definition, provider: 'bitbucket', query: { project: 'EX', repo: 'repo', pullRequestId: 1 }, action: { kind: 'implement', taskId: 'WI-1' } }), /requires a Jira or GitHub/); } finally { engine.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('source maps Jira descriptions and GitHub pull request bodies', async () => {
    const c = { list: async () => [{ id: 'jira', provider: 'jira' as const, baseUrl: 'https://jira.example.test', auth: 'token' as const, credentialPresent: true }, { id: 'gh', provider: 'github' as const, baseUrl: 'https://github.example.test', auth: 'token' as const, credentialPresent: true }], save: async () => [], remove: async () => [], execute: async (id: string, op: string) => id === 'jira' ? { startAt: 0, total: 1, issues: [{ key: 'EX-1', self: 'https://jira.example.test/EX-1', fields: { summary: 'Issue', description: 'Issue description', labels: [] } }] } : op === 'readPullRequest' ? { title: 'PR', body: 'PR description', labels: [] } : [] }; const source = new ConnectionMonitorSource(c); assert.equal((await source.poll(definition))[0].body, 'Issue description'); const pr = await source.poll({ id: 'pr', name: 'PR', provider: 'github', connectionId: 'gh', intervalSeconds: 60, query: { owner: 'a', repo: 'b', pullRequestId: 1, label: 'ready' } }); assert.equal(pr[0].body, 'PR description');
});

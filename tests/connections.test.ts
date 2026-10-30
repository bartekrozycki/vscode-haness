import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RestConnectionService, validateConnection } from '../src/infrastructure/connections/service';
import { ConnectionMonitorSource } from '../src/infrastructure/monitors/source';
import { connectionsModule } from '../src/features/connections/module';
import { ConnectionNotSentError } from '../src/contracts/connections';
import type { ConnectionCredential, ConnectionMetadata, ConnectionStorage } from '../src/contracts/connections';

function fixture(fetcher: typeof fetch, approve: ConstructorParameters<typeof RestConnectionService>[1] = async () => true) {
    let entries: ConnectionMetadata[] = []; const secrets = new Map<string, ConnectionCredential>();
    const storage: ConnectionStorage = { async load() { return entries; }, async save(v) { entries = v; }, async getCredential(id) { return secrets.get(id); }, async setCredential(id, v) { secrets.set(id, v); }, async deleteCredential(id) { secrets.delete(id); } };
    return { storage, service: new RestConnectionService(storage, approve, fetcher) };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const failFetch: typeof fetch = async () => { throw new Error('Unexpected network'); };
test('URL validation accepts contexts and localhost only, and rejects credentials', () => {
    const base = { id: 'jira', provider: 'jira' as const, auth: 'token' as const, baseUrl: 'https://example.test/jira/' };
    assert.equal(validateConnection(base).baseUrl, 'https://example.test/jira');
    assert.equal(validateConnection({ ...base, baseUrl: 'http://localhost:8080/jira' }).baseUrl, 'http://localhost:8080/jira');
    for (const url of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/?token=x', 'https://example.test/#secret']) assert.throws(() => validateConnection({ ...base, baseUrl: url }));
});
test('Jira basic authentication and pagination keep context, metadata excludes secret', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const { storage, service } = fixture(async (url, init) => { seen = { url: String(url), init }; return json({ issues: [] }); });
    await service.save({ id: 'jira', provider: 'jira', auth: 'basic', baseUrl: 'https://example.test/jira' });
    await storage.setCredential('jira', { username: 'alice', password: 'private' });
    assert.deepEqual(await service.execute('jira', 'search', { jql: 'project = TEST', start: 25, limit: 25 }), { issues: [] });
    assert.equal(seen?.url, 'https://example.test/jira/rest/api/2/search?jql=project+%3D+TEST&startAt=25&maxResults=25');
    assert.equal((seen?.init?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('alice:private').toString('base64')}`);
    assert.equal(JSON.stringify(await service.list()).includes('private'), false);
});
test('reject redirects without following, sanitize provider errors and clear secrets on destination change', async () => {
    const { storage, service } = fixture(async (_url, init) => { assert.equal(init?.redirect, 'manual'); return new Response('secret response', { status: 302, headers: { location: 'https://other.test' } }); });
    await service.save({ id: 'x', provider: 'jira', auth: 'token', baseUrl: 'https://example.test' }); await storage.setCredential('x', { token: 'secret' });
    await assert.rejects(service.execute('x', 'read', { issueKey: 'X-1' }), /redirect rejected/);
    await service.save({ id: 'x', provider: 'jira', auth: 'token', baseUrl: 'https://other.test' });
    assert.equal((await service.list())[0].credentialPresent, false);
});
test('provider writes require approval and send documented payloads', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []; let approved = false;
    const { storage, service } = fixture(async (url, init) => { calls.push({ url: String(url), init }); return json({ id: 1 }); }, async request => { assert.equal(request.operation, 'update'); return approved; });
    await service.save({ id: 'wiki', provider: 'confluence', auth: 'token', baseUrl: 'https://example.test/wiki' }); await storage.setCredential('wiki', { token: 'secret' });
    const p = { pageId: '123', title: 'Title', version: 3, body: '<p>Content</p>' };
    await assert.rejects(service.execute('wiki', 'update', p), error => error instanceof ConnectionNotSentError && /declined/.test(error.message)); assert.equal(calls.length, 0);
    approved = true; await service.execute('wiki', 'update', p);
    assert.equal(calls[0].url, 'https://example.test/wiki/rest/api/content/123');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { id: '123', type: 'page', title: 'Title', version: { number: 3 }, body: { storage: { value: '<p>Content</p>', representation: 'storage' } } });
});
test('GitHub and Bitbucket calls use provider-specific paths and bounded paging', async () => {
    const urls: string[] = []; const { storage, service } = fixture(async url => { urls.push(String(url)); return json([]); });
    await service.save({ id: 'gh', provider: 'github', auth: 'token', baseUrl: 'https://api.github.com' }); await storage.setCredential('gh', { token: 'gh-token' });
    await service.execute('gh', 'comments', { owner: 'org', repo: 'repo', pullRequestId: '2', page: 2, limit: 20 });
    await service.save({ id: 'bb', provider: 'bitbucket', auth: 'token', baseUrl: 'https://example.test/bitbucket' }); await storage.setCredential('bb', { token: 'bb-token' });
    await service.execute('bb', 'pullRequests', { project: 'ABC', repo: 'repo', start: 25, limit: 25 });
    assert.deepEqual(urls, ['https://api.github.com/repos/org/repo/issues/2/comments?page=2&per_page=20', 'https://example.test/bitbucket/rest/api/1.0/projects/ABC/repos/repo/pull-requests?start=25&limit=25']);
    await assert.rejects(service.execute('bb', 'pullRequests', { project: '..', repo: 'repo' }), /Invalid project/);
    await assert.rejects(service.execute('bb', 'pullRequests', { project: 'ABC', repo: 'repo', limit: 101 }), /Invalid limit/);
});
test('limits response bodies and suppresses transport details', async () => {
    let { storage, service } = fixture(async () => new Response('x'.repeat(2_000_001)));
    await service.save({ id: 'a', provider: 'jira', auth: 'token', baseUrl: 'https://example.test' }); await storage.setCredential('a', { token: 'secret' });
    await assert.rejects(service.execute('a', 'read', { issueKey: 'A-1' }), /size limit/);
    ({ storage, service } = fixture(async () => { throw new Error('secret transport detail'); }));
    await service.save({ id: 'a', provider: 'jira', auth: 'token', baseUrl: 'https://example.test' }); await storage.setCredential('a', { token: 'secret' });
    await assert.rejects(service.execute('a', 'read', { issueKey: 'A-1' }), error => error instanceof Error && !error.message.includes('secret'));
    assert.ok(failFetch);
});

test('numeric pull-request IDs are accepted and unsafe IDs rejected', async () => {
    const urls: string[] = []; const { storage, service } = fixture(async url => { urls.push(String(url)); return json([]); });
    await service.save({ id: 'gh', provider: 'github', auth: 'token', baseUrl: 'https://api.github.com' }); await storage.setCredential('gh', { token: 'x' });
    await service.execute('gh', 'comments', { owner: 'team', repo: 'repo', pullRequestId: 42 });
    assert.match(urls[0], /issues\/42\/comments/);
    for (const id of [0, -1, 2.3, Number.MAX_SAFE_INTEGER + 1, '../42']) await assert.rejects(service.execute('gh', 'comments', { owner: 'team', repo: 'repo', pullRequestId: id }), /Invalid pullRequestId/);
});

test('monitor source reads Jira issues and comments through the actual REST service', async () => {
    const urls: string[] = [];
    const { storage, service } = fixture(async url => {
        const u = new URL(String(url)); urls.push(u.pathname + u.search);
        if (u.pathname.endsWith('/search')) return json({ issues: [{ key: 'ABC-7', fields: { summary: 'Work', labels: ['ready'] } }], startAt: 0, total: 1 });
        if (u.pathname.endsWith('/ABC-7/comment')) return json({ comments: [{ id: '9', body: 'requested change', updated: '2026-01-01' }], startAt: 0, total: 1 });
        throw new Error('Unexpected request');
    });
    await service.save({ id: 'jira', provider: 'jira', auth: 'token', baseUrl: 'https://example.test/jira' }); await storage.setCredential('jira', { token: 'x' });
    const observations = await new ConnectionMonitorSource(service).poll({ id: 'issues', name: 'Issues', provider: 'jira', connectionId: 'jira', intervalSeconds: 60, query: { jql: 'project = EXAMPLE', commentContains: 'change' } });
    assert.equal(observations[0].id, 'ABC-7:comment:9');
    assert.equal(observations[0].body, 'requested change');
    assert.match(urls[0], /rest\/api\/2\/search\?/);
    assert.match(urls[1], /rest\/api\/2\/issue\/ABC-7\/comment\?startAt=0&maxResults=50/);
});

test('connection tool only permits read operations even when called outside schema validation', async () => {
    let writes = 0;
    const { service } = fixture(async () => { writes++; return json({}); });
    const tool = connectionsModule(service).tools![0];
    await assert.rejects(tool.invoke({ operation: 'create', connectionId: 'id', params: {} }, {} as never), /Unsupported/);
    assert.equal(writes, 0);
});

test('approval receives the immutable exact request even if caller changes parameters while awaiting', async () => {
    let release!: (answer: boolean) => void; let entered!: () => void;
    const approvalEntered = new Promise<void>(resolve => { entered = resolve; });
    const answer = new Promise<boolean>(resolve => { release = resolve; });
    let actualBody = ''; let approvalBody: unknown; let approvalPath = ''; let approvalMethod = '';
    const { storage, service } = fixture(async (_url, init) => { actualBody = String(init?.body); return json({ id: 1 }); }, async request => {
        approvalMethod = request.method; approvalPath = request.path; approvalBody = request.body;
        assert.equal(Object.isFrozen(request), true); assert.equal(Object.isFrozen(request.body), true);
        assert.equal(Object.isFrozen((request.body.body as Record<string, unknown>).storage), true);
        entered(); return answer;
    });
    await service.save({ id: 'wiki', provider: 'confluence', auth: 'token', baseUrl: 'https://example.test/wiki' }); await storage.setCredential('wiki', { token: 'secret' });
    const params = { pageId: '123', title: 'Original', version: 2, body: '<p>Original</p>' };
    const pending = service.execute('wiki', 'update', params);
    params.body = '<p>Changed before approval</p>'; params.title = 'Changed';
    await approvalEntered; params.body = '<p>Changed during approval</p>'; release(true); await pending;
    assert.equal(approvalMethod, 'PUT'); assert.equal(approvalPath, '/wiki/rest/api/content/123');
    assert.deepEqual(JSON.parse(actualBody), approvalBody);
    assert.equal(JSON.parse(actualBody).title, 'Original');
    assert.equal(JSON.parse(actualBody).body.storage.value, '<p>Original</p>');
});

test('changing a connection during approval prevents the approved request reaching the network', async () => {
    let release!: (answer: boolean) => void; let entered!: () => void;
    const approvalEntered = new Promise<void>(resolve => { entered = resolve; });
    const answer = new Promise<boolean>(resolve => { release = resolve; });
    let calls = 0;
    const { storage, service } = fixture(async () => { calls++; return json({}); }, async () => { entered(); return answer; });
    await service.save({ id: 'wiki', provider: 'confluence', auth: 'token', baseUrl: 'https://example.test/wiki' }); await storage.setCredential('wiki', { token: 'secret' });
    const pending = service.execute('wiki', 'create', { title: 'Title', spaceKey: 'SPACE', body: '<p>Body</p>' });
    await approvalEntered;
    await service.save({ id: 'wiki', provider: 'confluence', auth: 'token', baseUrl: 'https://other.test/wiki' });
    release(true);
    await assert.rejects(pending, /Connection changed while awaiting approval/); assert.equal(calls, 0);
});

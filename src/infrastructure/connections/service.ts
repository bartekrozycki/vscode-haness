import { ConnectionNotSentError } from '../../contracts/connections';
import type { ConnectionApproval, ConnectionAuth, ConnectionCredential, ConnectionMetadata, ConnectionOperation, ConnectionParams, ConnectionProvider, ConnectionService, ConnectionStorage } from '../../contracts/connections';

const providers: ConnectionProvider[] = ['jira', 'confluence', 'bitbucket', 'github'];
const mutations = new Set<ConnectionOperation>(['create', 'update', 'createPullRequest', 'createComment']);
const MAX_BODY = 2_000_000;
function validId(id: unknown): asserts id is string { if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid connection ID.'); }
export function validateConnection(input: ConnectionMetadata): ConnectionMetadata {
    if (!input || typeof input !== 'object') throw new Error('Invalid connection.');
    validId(input.id);
    if (!providers.includes(input.provider) || !(['token', 'basic'] as ConnectionAuth[]).includes(input.auth)) throw new Error('Invalid connection provider or authentication.');
    if (input.provider === 'github' && input.auth !== 'token') throw new Error('GitHub requires token authentication.');
    if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) throw new Error('Invalid connection URL.');
    let url: URL; try { url = new URL(input.baseUrl); } catch { throw new Error('Invalid connection URL.'); }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS, or HTTP on localhost, without URL credentials, query or fragment.');
    return { id: input.id, provider: input.provider, baseUrl: url.toString().replace(/\/$/, ''), auth: input.auth };
}
function required(p: ConnectionParams, key: string, max = 2000): string { const v = p[key]; if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${key}.`); return v; }
function segment(p: ConnectionParams, key: string): string { const v = required(p, key, 200); if (v === '.' || v === '..' || /[\\/]/.test(v)) throw new Error(`Invalid ${key}.`); return encodeURIComponent(v); }
function pullRequestId(p: ConnectionParams): string { const value = p.pullRequestId; if (typeof value === 'number') { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid pullRequestId.'); return String(value); } const id = required(p, 'pullRequestId', 20); if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid pullRequestId.'); return id; }
function integer(p: ConnectionParams, key: string, fallback: number, max: number): number { const v = p[key] ?? fallback; if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw new Error(`Invalid ${key}.`); return v; }
function bodyText(p: ConnectionParams, key: string): string { return required(p, key, 200_000); }
function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
    if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value); for (const child of Object.values(value)) freezeDeep(child, seen); Object.freeze(value); }
    return value;
}
interface Request { path: string; query?: Record<string, string | number>; method?: 'POST' | 'PUT'; body?: object; }
function requestFor(c: ConnectionMetadata, op: ConnectionOperation, p: ConnectionParams): Request {
    const page = () => ({ start: integer(p, 'start', 0, 100000), limit: integer(p, 'limit', 25, 100) || 25 });
    if (c.provider === 'jira') {
        if (op === 'search') { const { start, limit } = page(); return { path: '/rest/api/2/search', query: { jql: required(p, 'jql'), startAt: start, maxResults: limit } }; }
        if (op === 'read') return { path: `/rest/api/2/issue/${segment(p, 'issueKey')}` };
        if (op === 'comments') { const { start, limit } = page(); return { path: `/rest/api/2/issue/${segment(p, 'issueKey')}/comment`, query: { startAt: start, maxResults: limit } }; }
    }
    if (c.provider === 'confluence') {
        if (op === 'search') return { path: '/rest/api/content/search', query: { cql: required(p, 'cql'), ...page() } };
        if (op === 'read') return { path: `/rest/api/content/${segment(p, 'pageId')}`, query: { expand: 'body.storage,version,space' } };
        if (op === 'create') { const parent = p.parentId === undefined ? {} : { ancestors: [{ id: required(p, 'parentId', 200) }] }; return { path: '/rest/api/content', method: 'POST', body: { type: 'page', title: required(p, 'title'), space: { key: required(p, 'spaceKey', 200) }, ...parent, body: { storage: { value: bodyText(p, 'body'), representation: 'storage' } } } }; }
        if (op === 'update') return { path: `/rest/api/content/${segment(p, 'pageId')}`, method: 'PUT', body: { id: required(p, 'pageId', 200), type: 'page', title: required(p, 'title'), version: { number: integer(p, 'version', 0, 1_000_000) || (() => { throw new Error('Version must be positive.'); })() }, body: { storage: { value: bodyText(p, 'body'), representation: 'storage' } } } };
    }
    if (c.provider === 'bitbucket') {
        const root = `/rest/api/1.0/projects/${segment(p, 'project')}/repos/${segment(p, 'repo')}/pull-requests`;
        if (op === 'pullRequests') return { path: root, query: page() };
        if (op === 'readPullRequest') return { path: `${root}/${pullRequestId(p)}` };
        if (op === 'comments') return { path: `${root}/${pullRequestId(p)}/activities`, query: page() };
        if (op === 'createComment') return { path: `${root}/${pullRequestId(p)}/comments`, method: 'POST', body: { text: bodyText(p, 'body') } };
        if (op === 'createPullRequest') { const repository = { slug: required(p, 'repo', 200), project: { key: required(p, 'project', 200) } }; return { path: root, method: 'POST', body: { title: required(p, 'title'), description: p.body === undefined ? '' : bodyText(p, 'body'), fromRef: { id: required(p, 'head', 300), repository }, toRef: { id: required(p, 'base', 300), repository } } }; }
    }
    if (c.provider === 'github') {
        const root = `/repos/${segment(p, 'owner')}/${segment(p, 'repo')}`;
        const paging = () => ({ page: integer(p, 'page', 1, 10000) || 1, per_page: integer(p, 'limit', 25, 100) || 25 });
        if (op === 'pullRequests') return { path: `${root}/pulls`, query: paging() };
        if (op === 'readPullRequest') return { path: `${root}/pulls/${pullRequestId(p)}` };
        if (op === 'comments') return { path: `${root}/issues/${pullRequestId(p)}/comments`, query: paging() };
        if (op === 'reviewComments') return { path: `${root}/pulls/${pullRequestId(p)}/comments`, query: paging() };
        if (op === 'createComment') return { path: `${root}/issues/${pullRequestId(p)}/comments`, method: 'POST', body: { body: bodyText(p, 'body') } };
        if (op === 'createPullRequest') return { path: `${root}/pulls`, method: 'POST', body: { title: required(p, 'title'), body: p.body === undefined ? '' : bodyText(p, 'body'), head: required(p, 'head', 300), base: required(p, 'base', 300) } };
    }
    throw new Error('Unsupported provider operation.');
}
function authorization(c: ConnectionMetadata, secret: ConnectionCredential | undefined): string {
    if (c.auth === 'token' && secret?.token && !/[\r\n]/.test(secret.token)) return `Bearer ${secret.token}`;
    if (c.auth === 'basic' && secret?.username && secret.password && !secret.username.includes(':')) return `Basic ${Buffer.from(`${secret.username}:${secret.password}`, 'utf8').toString('base64')}`;
    throw new Error('Connection credential is missing or invalid.');
}
async function boundedText(response: Response): Promise<string> {
    if (Number(response.headers.get('content-length')) > MAX_BODY) throw new Error('Provider response exceeds size limit.');
    if (!response.body) return '';
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > MAX_BODY) { await reader.cancel(); throw new Error('Provider response exceeds size limit.'); } chunks.push(value); } } finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString('utf8');
}
export class RestConnectionService implements ConnectionService {
    constructor(private readonly storage: ConnectionStorage, private readonly approve: (request: ConnectionApproval) => Promise<boolean>, private readonly fetcher: typeof fetch = fetch) {}
    async list() { const items = await this.storage.load(); return Promise.all(items.map(async item => ({ ...validateConnection(item), credentialPresent: !!(await this.storage.getCredential(item.id)) }))); }
    async save(input: ConnectionMetadata) { const item = validateConnection(input); const all = await this.storage.load(); const old = all.find(x => x.id === item.id); if (old && (old.baseUrl !== item.baseUrl || old.provider !== item.provider || old.auth !== item.auth)) await this.storage.deleteCredential(item.id); await this.storage.save([...all.filter(x => x.id !== item.id), item]); return this.list(); }
    async remove(id: string) { validId(id); await this.storage.save((await this.storage.load()).filter(x => x.id !== id)); await this.storage.deleteCredential(id); return this.list(); }
    async execute(id: string, operation: ConnectionOperation, params: ConnectionParams): Promise<unknown> {
        const { req, auth, url, serializedBody } = await (async () => {
            try {
                validId(id); if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid operation parameters.');
                const snapshot = freezeDeep(structuredClone(params));
                const found = (await this.storage.load()).find(x => x.id === id); if (!found) throw new Error('Connection not found.');
                const c = validateConnection(found); const req = requestFor(c, operation, snapshot);
                const url = new URL(c.baseUrl + req.path); for (const [key, value] of Object.entries(req.query ?? {})) url.searchParams.set(key, String(value));
                const serializedBody = req.body ? JSON.stringify(req.body) : undefined;
                const secret = await this.storage.getCredential(id);
                const auth = authorization(c, secret);
                if (mutations.has(operation)) {
                    if (!req.method || !serializedBody) throw new Error('Invalid provider write.');
                    const approval = freezeDeep({ connection: { ...c }, operation, params: snapshot, method: req.method, path: url.pathname + url.search, body: JSON.parse(serializedBody) as Record<string, unknown> });
                    if (!(await this.approve(approval))) throw new Error('Provider write was declined.');
                    const current = (await this.storage.load()).find(x => x.id === id);
                    const currentSecret = await this.storage.getCredential(id);
                    if (!current || JSON.stringify(validateConnection(current)) !== JSON.stringify(c) || JSON.stringify(currentSecret) !== JSON.stringify(secret)) throw new Error('Connection changed while awaiting approval.');
                }
                return { req, auth, url, serializedBody };
            } catch (error) {
                throw new ConnectionNotSentError(error instanceof Error ? error.message : String(error));
            }
        })();
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await this.fetcher(url, { method: req.method ?? 'GET', headers: { Authorization: auth, Accept: 'application/json', ...(req.body ? { 'Content-Type': 'application/json' } : {}) }, body: serializedBody, redirect: 'manual', signal: controller.signal });
            if (response.status >= 300 && response.status < 400) throw new Error('Provider redirect rejected.');
            if (!response.ok) throw new Error(`Provider request failed (HTTP ${response.status}).`);
            const text = await boundedText(response); if (!text) return null;
            try { return JSON.parse(text) as unknown; } catch { throw new Error('Provider returned invalid JSON.'); }
        } catch (error) { if (error instanceof Error && (error.message.startsWith('Provider ') || error.message === 'Connection credential is missing or invalid.')) throw error; throw new Error('Provider request failed or timed out.'); } finally { clearTimeout(timer); }
    }
}

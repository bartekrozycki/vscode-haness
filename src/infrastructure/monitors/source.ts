import { createHash } from 'node:crypto';
import type { ConnectionService, ConnectionOperation } from '../../contracts/connections';
import type { MonitorDefinition, MonitorObservation, MonitorSource } from '../../contracts/monitors';
const str = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const bounded = (v: unknown) => { const text = str(v); return text.length > 100000 ? text.slice(0, 100000) + '…[truncated]' : text; };
const version = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class ConnectionMonitorSource implements MonitorSource {
    constructor(private connections: ConnectionService) {}
    async poll(d: MonitorDefinition): Promise<MonitorObservation[]> {
        const connection = (await this.connections.list()).find(c => c.id === d.connectionId);
        if (!connection || connection.provider !== d.provider) throw new Error('Monitor connection is missing or has a different provider');
        const q = d.query, output: MonitorObservation[] = [], limit = 50, maxPages = 10;
        if (d.provider === 'bitbucket' && q.label) throw new Error('Bitbucket label filters are not supported');
        const base = { owner: q.owner, project: q.project, repo: q.repo, pullRequestId: q.pullRequestId };
        let labels: string[] = [];
        if (d.provider === 'github' && (q.label || d.action?.kind === 'implement')) {
            const pr: any = await this.connections.execute(d.connectionId, 'readPullRequest', base);
            if (!Array.isArray(pr?.labels)) throw new Error('GitHub pull request labels are unavailable');
            labels = pr.labels.map((l: any) => str(l.name)).filter(Boolean);
            output.push({ id: `pull:${q.pullRequestId}`, version: version({ labels, updated: pr.updated_at, title: pr.title }), kind: 'issue', title: bounded(pr.title), body: bounded(pr.body), labels, updatedAt: str(pr.updated_at), url: str(pr.html_url) });
        }
        const paged = async (operation: ConnectionOperation, params: Record<string, unknown>, mode: 'jira-search' | 'jira-comments' | 'github' | 'bitbucket'): Promise<any[]> => {
            const result: any[] = []; let start = 0; const seen = new Set<number>();
            for (let page = 1; page <= maxPages; page++) {
                if (seen.has(start)) throw new Error('Provider pagination repeated a cursor'); seen.add(start);
                const raw: any = await this.connections.execute(d.connectionId, operation, { ...params, start, page, limit });
                const items: any[] = mode === 'github' ? raw : mode === 'jira-search' ? raw?.issues : mode === 'jira-comments' ? raw?.comments : raw?.values;
                if (!Array.isArray(items)) throw new Error('Unexpected provider response'); result.push(...items);
                if (mode === 'github') { if (items.length < limit) return result; start += items.length; continue; }
                if (mode === 'bitbucket') {
                    if (typeof raw.isLastPage !== 'boolean') throw new Error('Missing Bitbucket pagination metadata');
                    if (raw.isLastPage) return result;
                    if (!Number.isInteger(raw.nextPageStart) || raw.nextPageStart <= start || items.length === 0) throw new Error('Invalid Bitbucket pagination cursor');
                    start = raw.nextPageStart; continue;
                }
                if (!Number.isInteger(raw.startAt) || raw.startAt !== start || !Number.isInteger(raw.total) || raw.total < 0) throw new Error('Invalid Jira pagination metadata');
                if (start + items.length >= raw.total) return result;
                if (!items.length) throw new Error('Jira pagination did not advance'); start += items.length;
            }
            throw new Error('Monitor exceeded the 500 item page limit; narrow its query');
        };
        if (d.provider === 'jira') {
            const issues = await paged('search', { jql: q.jql }, 'jira-search');
            for (const item of issues) {
                const fields = item.fields || {}, issueLabels = Array.isArray(fields.labels) ? fields.labels.map(str) : [];
                if (q.commentContains) {
                    const comments = await paged('comments', { issueKey: item.key }, 'jira-comments');
                    for (const comment of comments) output.push({ id: `${str(item.key)}:comment:${str(comment.id)}`, version: version(comment), kind: 'comment', title: str(fields.summary), body: bounded(comment.body), labels: issueLabels, updatedAt: str(comment.updated), url: str(item.self) });
                } else output.push({ id: str(item.key), version: version({ updated: fields.updated, labels: issueLabels, summary: fields.summary }), kind: 'issue', title: bounded(fields.summary), body: bounded(fields.description), labels: issueLabels, updatedAt: str(fields.updated), url: str(item.self) });
            }
        } else {
            for (const operation of d.provider === 'github' ? ['comments', 'reviewComments'] as const : ['comments'] as const) {
                const items = await paged(operation, base, d.provider);
                for (const item of items) { const comment = d.provider === 'bitbucket' ? item.comment : item; if (!comment) continue; output.push({ id: `${operation}:${str(comment.id)}`, version: version(comment), kind: 'comment', body: bounded(comment.body || comment.text), labels, updatedAt: str(comment.updated_at || comment.updatedDate), url: str(comment.html_url || comment.links?.self?.[0]?.href) }); }
            }
        }
        const unique = new Map<string, MonitorObservation>();
        for (const item of output) { const existing = unique.get(item.id); if (existing && existing.version !== item.version) throw new Error('Provider returned conflicting versions of the same item'); if (!existing) unique.set(item.id, item); }
        return [...unique.values()];
    }
}

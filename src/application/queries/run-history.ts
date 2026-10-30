import type { LiveSession } from '../../contracts/live';
import type { Row, Snapshot } from '../../contracts/model';
/** Runs predating live capture still appear, with an explicit missing-stream message. */
export function withRunHistory(sessions: LiveSession[], snapshot?: Snapshot): LiveSession[] {
    if (!snapshot)
        return sessions;
    const result = [...sessions];
    for (const run of snapshot.runs) {
        if (result.some(session => session.run === run.id))
            continue;
        const metric: Row = snapshot.metrics.find(row => row.run === run.id) || {};
        result.push({ run: run.id, item: run.item, role: run.role, model: metric.model || '—', permissions: '—', started: run.started,
            updated: run.finished || run.started, finished: run.finished, session: run.session, status: run.finished ? run.outcome : 'interrupted',
            activity: run.finished ? 'This run predates live capture; a final report is available' : 'Unfinished ledger record; live ownership is unknown', inputTokens: Number(metric.input_tokens) || 0,
            outputTokens: Number(metric.output_tokens) || 0, cacheReadTokens: Number(metric.cache_read_tokens) || 0,
            premiumRequests: metric.premium_requests ? Number(metric.premium_requests) : undefined, turns: Number(metric.turns) || 0,
            toolCalls: Number(metric.tool_calls) || 0, entries: [], controllable: false });
    }
    return result.sort((a, b) => Number(!b.finished) - Number(!a.finished) || b.started.localeCompare(a.started)).slice(0, 60);
}

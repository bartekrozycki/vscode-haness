/** Display a running clock only for sessions that can still make progress. */
export function duration(session: { started?: string; finished?: string; updated?: string; status?: string }, now = Date.now()): string {
    const terminal = ['interrupted', 'failed', 'cancelled', 'completed', 'limit'].includes(session.status || '');
    const endValue = session.finished || (terminal ? session.updated : undefined);
    if (!session.started || (terminal && !endValue)) return '—';
    const start = Date.parse(session.started.replace(' ', 'T'));
    const end = endValue ? Date.parse(endValue.replace(' ', 'T')) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

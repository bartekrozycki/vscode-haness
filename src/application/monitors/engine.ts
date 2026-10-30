import type { MonitorDefinition, MonitorEvent, MonitorObservation, MonitorRecord, MonitorSource, MonitorStore, MonitorTrigger } from '../../contracts/monitors';
const receiptId = (id: string, observation: MonitorObservation) => encodeURIComponent(JSON.stringify([id, observation.id, observation.version]));
function validate(d: MonitorDefinition) {
    if (!d || Object.keys(d).some(k => !['id', 'name', 'provider', 'connectionId', 'query', 'intervalSeconds', 'action'].includes(k)) || !/^[a-zA-Z0-9_-]{1,64}$/.test(d.id) || !d.name?.trim() || !d.connectionId?.trim() || !['jira', 'github', 'bitbucket'].includes(d.provider)) throw new Error('Invalid monitor identity or connection');
    if (!Number.isInteger(d.intervalSeconds) || d.intervalSeconds < 60 || d.intervalSeconds > 86400) throw new Error('Interval must be 60–86400 seconds');
    if (!d.query || (d.provider === 'jira' ? !d.query.jql?.trim() : !d.query.repo?.trim() || !Number.isInteger(d.query.pullRequestId) || (d.query.pullRequestId || 0) < 1 || !(d.provider === 'github' ? d.query.owner : d.query.project))) throw new Error('Monitor query is incomplete');
    if (Object.keys(d.query).some(k => !['jql', 'owner', 'project', 'repo', 'pullRequestId', 'label', 'commentContains'].includes(k)) || (d.action && Object.keys(d.action).some(k => !['kind', 'researchFocus', 'taskId', 'armed', 'estimate', 'timeoutSeconds', 'maxTokens', 'maxParallel'].includes(k)))) throw new Error('Unexpected monitor fields');
    if (d.provider === 'bitbucket' && d.query.label) throw new Error('Bitbucket label filters are not supported');
    if (d.action?.kind === 'implement' && (d.provider === 'bitbucket' || d.query.commentContains)) throw new Error('Implementation monitoring requires a Jira or GitHub label and cannot use a comment filter');
    if (d.action && ((d.action.estimate !== undefined && ![1,2,3,5,8,13,21,34,55].includes(d.action.estimate)) || (d.action.timeoutSeconds !== undefined && (!Number.isInteger(d.action.timeoutSeconds) || d.action.timeoutSeconds < 5 || d.action.timeoutSeconds > 1800)) || (d.action.maxTokens !== undefined && (!Number.isInteger(d.action.maxTokens) || d.action.maxTokens < 1 || d.action.maxTokens > 1000000)) || (d.action.maxParallel !== undefined && (!Number.isInteger(d.action.maxParallel) || d.action.maxParallel < 1 || d.action.maxParallel > 5)))) throw new Error('Invalid research estimate or budget');
    if (d.action && (!['refine', 'implement'].includes(d.action.kind) || (d.action.kind === 'refine' && !d.action.researchFocus?.trim()) || (d.action.kind === 'implement' && !d.action.taskId?.trim()))) throw new Error('Action requires a locally configured research focus or task ID');
}
export class MonitorEngine {
    private timers = new Map<string, ReturnType<typeof setTimeout>>(); private started = new Set<string>(); private running = new Set<string>(); private disposed = false;
    constructor(private store: MonitorStore, private source: MonitorSource, private onTrigger?: (root: string, trigger: MonitorTrigger) => Promise<void> | void, private authorizeArmed?: (root: string, definition: MonitorDefinition) => Promise<boolean>, private changed?: (root: string) => void) {}
    async list(root: string) { return (await this.store.read(root)).records.map(({ seen, ...record }) => record); }
    async events(root: string, id?: string) { return (await this.store.read(root)).events.filter(e => !id || e.monitorId === id); }
    async define(root: string, definition: MonitorDefinition) { validate(definition); if (definition.action?.armed && (!this.authorizeArmed || !await this.authorizeArmed(root, structuredClone(definition)))) throw new Error('Explicit host authorization is required to arm a monitor'); const result = await this.store.mutate(root, state => { if (state.records.some(r => r.definition.id === definition.id)) throw new Error('Monitor already exists'); const record: MonitorRecord = { definition: structuredClone(definition), active: false, baseline: false, seen: {} }; state.records.push(record); return record; }); this.notify(root); return result; }
    async activate(root: string, id: string) { const result = await this.store.mutate(root, state => { const r = this.find(state.records, id); r.active = true; return r; }); if (this.started.has(root)) this.schedule(root, result); this.notify(root); return result; }
    async pause(root: string, id: string) { const result = await this.store.mutate(root, state => { const r = this.find(state.records, id); r.active = false; return r; }); this.clear(root, id); this.notify(root); return result; }
    /** Call only for trusted roots while the extension is alive. Reads never create files. */
    async start(root: string) { this.disposed = false; this.started.add(root); for (const record of (await this.store.read(root)).records) if (record.active) this.schedule(root, record); }
    stopRoot(root: string) { this.started.delete(root); for (const key of this.timers.keys()) if (key.startsWith(root + '\0')) { clearTimeout(this.timers.get(key)); this.timers.delete(key); } }
    dispose() { this.disposed = true; this.started.clear(); for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
    async poll(root: string, id: string) {
        const key = root + '\0' + id; if (this.running.has(key)) throw new Error('Monitor is already polling'); this.running.add(key);
        const started = Date.now();
        try {
            const before = this.find((await this.store.read(root)).records, id); if (!before.active) throw new Error('Activate the monitor before polling');
            const observations = await this.source.poll(before.definition);
            const fresh = await this.store.mutate(root, state => {
                const record = this.find(state.records, id); if (!record.active) return [] as MonitorEvent[];
                const events: MonitorEvent[] = []; record.matched ||= {}; record.transitions ||= {}; const present = new Set<string>(); const known = new Set(state.events.map(e => e.id));
                for (const observation of observations) {
                    if (!observation.id || !observation.version) throw new Error('Provider returned an observation without stable identity and version');
                    present.add(observation.id);
                    const match = matches(record.definition, observation);
                    const labelEntry = (record.definition.query.label || record.definition.action?.kind === 'implement') && observation.kind === 'issue';
                    const changed = labelEntry ? !record.matched![observation.id] && match : record.seen[observation.id] !== observation.version && match;
                    if (record.baseline && changed && labelEntry) record.transitions[observation.id] = (record.transitions[observation.id] || 0) + 1;
                    const eventId = receiptId(id, labelEntry ? { ...observation, version: `${observation.version}:${record.transitions[observation.id] || 0}` } : observation);
                    if (record.baseline && changed && !known.has(eventId)) {
                        const action = record.definition.action;
                        const trigger: MonitorTrigger | undefined = action && (action.kind !== 'implement' || (observation.kind === 'issue' && observation.labels?.includes('hanes-implement'))) ? { monitorId: id, eventId, action: action.kind, connectionId: record.definition.connectionId, remoteId: observation.id, remoteText: evidence(record.definition.connectionId, observation), researchFocus: action.researchFocus, taskId: action.taskId, armed: action.armed === true, estimate: action.estimate, timeoutSeconds: action.timeoutSeconds, maxTokens: action.maxTokens, maxParallel: action.maxParallel } : undefined;
                        const event = { id: eventId, monitorId: id, receivedAt: new Date().toISOString(), observation, trigger }; events.push(event); known.add(eventId);
                    }
                    record.seen[observation.id] = observation.version; record.matched![observation.id] = !!match;
                }
                if (record.definition.query.label || record.definition.action?.kind === 'implement') for (const key of Object.keys(record.matched)) if (!present.has(key)) record.matched[key] = false;
                record.baseline = true; record.pollCount = (record.pollCount || 0) + 1; record.lastDurationMs = Date.now() - started; record.lastPoll = new Date().toISOString(); delete record.error; state.events.push(...events); return events;
            });
            for (const event of fresh) if (event.trigger) await this.onTrigger?.(root, event.trigger);
            return fresh;
        } catch (error) { await this.store.mutate(root, state => { const r = this.find(state.records, id); r.error = error instanceof Error ? error.message : String(error); r.pollCount = (r.pollCount || 0) + 1; r.errorCount = (r.errorCount || 0) + 1; r.lastDurationMs = Date.now() - started; r.lastPoll = new Date().toISOString(); }); throw error; }
        finally { this.running.delete(key); this.notify(root); }
    }
    private notify(root: string) { try { this.changed?.(root); } catch { /* UI notifications cannot change persisted monitor results. */ } }
    private find(records: MonitorRecord[], id: string) { const r = records.find(r => r.definition.id === id); if (!r) throw new Error('Monitor not found'); return r; }
    private clear(root: string, id: string) { const key = root + '\0' + id; const t = this.timers.get(key); if (t) clearTimeout(t); this.timers.delete(key); }
    private schedule(root: string, record: MonitorRecord) { this.clear(root, record.definition.id); if (this.disposed) return; const key = root + '\0' + record.definition.id; this.timers.set(key, setTimeout(async () => { this.timers.delete(key); if (!this.started.has(root)) return; try { await this.poll(root, record.definition.id); } catch {} if (!this.disposed && this.started.has(root)) { const current = (await this.store.read(root)).records.find(r => r.definition.id === record.definition.id); if (current?.active && this.started.has(root)) this.schedule(root, current); } }, record.definition.intervalSeconds * 1000)); }
}
function matches(d: MonitorDefinition, o: MonitorObservation) { return (!(d.query.label && !d.query.commentContains && o.kind === 'comment')) && (!d.query.label || o.labels?.includes(d.query.label)) && (d.action?.kind !== 'implement' || o.kind !== 'issue' || o.labels?.includes('hanes-implement')) && (!d.query.commentContains || (o.kind === 'comment' && (o.body || '').includes(d.query.commentContains))); }

function evidence(connectionId: string, observation: MonitorObservation) {
    const clip = (value: string | undefined, max: number) => { const text = value || ''; return text.length > max ? text.slice(0, max) + '…[truncated]' : text; };
    const data = { connectionId: clip(connectionId, 1000), sourceURL: clip(observation.url, 8000), title: clip(observation.title, 8000), body: clip(observation.body, 100000) };
    let json = JSON.stringify(data); while (json.length > 200000) { data.body = clip(data.body, Math.floor(data.body.length / 2)); json = JSON.stringify(data); } return json;
}

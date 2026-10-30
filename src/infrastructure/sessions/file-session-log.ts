import type { SessionLog } from '../../application/ports';
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { exists, projectPath } from '../files/project-paths';
import { Usage } from '../../domain/usage';
import { applyLiveEvent, liveText, type Capture } from '../../domain/live-session';
import type { LiveEntry, LiveSession, LiveEvent } from '../../contracts/live';
const MAX_LOG = 8000000;
const HEADER = 'timestamp\tevent\tdata\n';
const now = () => new Date().toISOString();
const cell = (value: string) => /[\t\r\n"]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
const row = (event: LiveEvent) => [cell(event.timestamp || now()), cell(event.type), cell(JSON.stringify(event.data))].join('\t') + '\n';
/** Parses the quoted TSV records written here, including old Windows line endings. */
function records(source: string): LiveEvent[] {
    const rows: string[][] = [];
    let current: string[] = [], field = '', quoted = false;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (char === '"' && (quoted || !field)) {
            if (quoted && source[index + 1] === '"') {
                field += '"';
                index++;
            }
            else
                quoted = !quoted;
        }
        else if (!quoted && (char === '\t' || char === '\n')) {
            current.push(field.replace(/\r$/, ''));
            field = '';
            if (char === '\n') {
                rows.push(current);
                current = [];
            }
        }
        else
            field += char;
    }
    return rows.slice(1).flatMap(([timestamp, type, data]) => {
        try {
            return timestamp && type && data ? [{ timestamp, type, data: JSON.parse(data) }] : [];
        }
        catch {
            return [];
        }
    });
}
function alive(pid: number): boolean { try {
    process.kill(pid, 0);
    return true;
}
catch {
    return false;
} }
export class FileSessionLog implements SessionLog {
    private readonly captures = new Map<string, Capture>();
    private readonly writes = new Map<string, Promise<void>>();
    private readonly cache = new Map<string, {
        size: number;
        mtime: number;
        capture: Capture;
    }>();
    constructor(readonly changed: (root: string) => void = () => { }) { }
    begin(root: string, meta: Pick<LiveSession, 'run' | 'item' | 'role' | 'model' | 'permissions'> & {
        executor?: string;
    }): void {
        const timestamp = now();
        const capture: Capture = { state: { ...meta, started: timestamp, updated: timestamp, finished: '', session: '',
                status: 'starting', activity: 'Starting executor', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
                turns: 0, toolCalls: 0, entries: [], controllable: true }, usage: new Usage(), seen: new Set(), bytes: 0, omitted: false, ownerPid: process.pid };
        this.captures.set(this.key(root, meta.run), capture);
        this.record(root, meta.run, { timestamp, type: 'live.start', data: { ...meta, ownerPid: process.pid } });
    }
    connect(root: string, run: string, session: string): void { this.record(root, run, { type: 'live.connect', data: { session } }); }
    activity(root: string, run: string, activity: string, waiting = false): void { this.record(root, run, { type: 'live.activity', data: { activity, waiting } }); }
    event(root: string, run: string, event: LiveEvent): void {
        // Capture public responses and tool activity only; opaque/reasoning payloads are excluded.
        const data = event.data as Record<string, unknown>;
        let output: Record<string, unknown>;
        switch (event.type) {
            case 'assistant.message_delta':
                output = { messageId: data.messageId, deltaContent: liveText(data.deltaContent) };
                break;
            case 'assistant.message':
                output = { messageId: data.messageId, content: liveText(data.content), model: data.model };
                break;
            case 'assistant.turn_start':
            case 'assistant.turn_end':
            case 'session.idle':
                output = {};
                break;
            case 'assistant.usage':
                output = { inputTokens: data.inputTokens, outputTokens: data.outputTokens, cacheReadTokens: data.cacheReadTokens, cacheWriteTokens: data.cacheWriteTokens, cost: data.cost, costUsd: data.costUsd, model: data.model };
                break;
            case 'tool.execution_start':
                output = { toolCallId: data.toolCallId, toolName: data.toolName, arguments: liveText(data.arguments, 12000) };
                break;
            case 'tool.execution_progress':
                output = { toolCallId: data.toolCallId, progressMessage: liveText(data.progressMessage, 12000) };
                break;
            case 'tool.execution_partial_result':
                output = { toolCallId: data.toolCallId, partialOutput: liveText(data.partialOutput, 12000) };
                break;
            case 'tool.shell_output':
                output = { toolCallId: data.toolCallId, text: liveText(data.text, 16000) };
                break;
            case 'tool.execution_complete': {
                const result = data.result as Record<string, unknown> | undefined;
                const blocks = Array.isArray(data.content) ? data.content : Array.isArray(result?.content) ? result.content : [];
                const plain = blocks.flatMap(block => {
                    const part = block as Record<string, unknown>;
                    return ['text', 'terminal', 'shell_exit'].includes(String(part.type)) ? [liveText(part.text || part.outputPreview || '', 16000)] : [];
                }).join('\n');
                output = { toolCallId: data.toolCallId, success: data.success, error: liveText(data.error, 12000), result: liveText(result?.content && !Array.isArray(result.content) ? result.content : plain || result?.detailedContent || result?.text || '', 16000) };
                break;
            }
            case 'session.error':
                output = { message: liveText(data.message, 12000) };
                break;
            default: return;
        }
        this.record(root, run, { ...event, data: output });
    }
    async finish(root: string, run: string, outcome: string, error?: unknown): Promise<void> {
        this.record(root, run, { type: 'live.finish', data: { outcome, error: error ? liveText(error instanceof Error ? error.message : String(error), 12000) : '' } });
        await this.writes.get(this.key(root, run));
        const completed = [...this.captures.entries()].filter(([, capture]) => capture.state.finished).sort((a, b) => b[1].state.started.localeCompare(a[1].state.started));
        for (const [key] of completed.slice(40)) {
            this.captures.delete(key);
            this.writes.delete(key);
        }
    }
    async flush(): Promise<void> { await Promise.all(this.writes.values()); }
    private key(root: string, run: string): string { return `${root}\0${run}`; }
    private record(root: string, run: string, event: LiveEvent): void {
        const key = this.key(root, run), capture = this.captures.get(key);
        if (!capture || capture.state.finished || (event.id && capture.seen.has(event.id)))
            return;
        const normalized = { ...event, timestamp: event.timestamp || now() };
        applyLiveEvent(capture, normalized);
        const encoded = row(normalized);
        if (capture.bytes < MAX_LOG || ['live.finish', 'live.truncated', 'session.error', 'assistant.usage'].includes(event.type)) {
            capture.bytes += Buffer.byteLength(encoded);
            const first = event.type === 'live.start';
            const pending = (this.writes.get(key) || Promise.resolve()).then(async () => {
                const file = await projectPath(root, `.work-item/live/${run}.tsv`);
                await mkdir(path.dirname(file), { recursive: true });
                await appendFile(file, (first ? HEADER : '') + encoded, 'utf8');
            }).catch(error => { capture.state.storageError = String(error); this.changed(root); });
            this.writes.set(key, pending);
        }
        else {
            capture.state.truncated = true;
            if (!capture.omitted) {
                capture.omitted = true;
                this.record(root, run, { type: 'live.truncated', data: {} });
            }
        }
        this.changed(root);
    }
    async list(root: string): Promise<LiveSession[]> {
        const own = [...this.captures.entries()].filter(([key]) => key.startsWith(root + '\0')).map(([, capture]) => capture.state);
        const directory = await projectPath(root, '.work-item/live');
        const historic: LiveSession[] = [];
        if (await exists(directory)) {
            const files = (await readdir(directory)).filter(name => /^[a-zA-Z0-9_-]{1,120}\.tsv$/.test(name));
            const sorted = await Promise.all(files.map(async (name) => ({ name, info: await stat(await projectPath(root, `.work-item/live/${name}`)) })));
            for (const { name, info } of sorted.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, 40)) {
                const run = name.slice(0, -4);
                if (own.some(s => s.run === run))
                    continue;
                const file = await projectPath(root, `.work-item/live/${name}`);
                let cached = this.cache.get(file);
                if (!cached || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
                    if (info.size > MAX_LOG + 2000000)
                        continue;
                    const events = records(await readFile(file, 'utf8'));
                    const start = events.find(event => event.type === 'live.start');
                    if (!start)
                        continue;
                    const meta = start.data as Pick<LiveSession, 'run' | 'item' | 'role' | 'model' | 'permissions'> & {
                        ownerPid: number;
                    };
                    const capture: Capture = { state: { ...meta, started: start.timestamp!, updated: start.timestamp!, finished: '', session: '', status: 'starting', activity: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, turns: 0, toolCalls: 0, entries: [], controllable: false }, usage: new Usage(), seen: new Set(), bytes: info.size, omitted: false, ownerPid: meta.ownerPid };
                    for (const event of events)
                        applyLiveEvent(capture, event);
                    cached = { mtime: info.mtimeMs, size: info.size, capture };
                    this.cache.set(file, cached);
                }
                const state = structuredClone(cached.capture.state);
                state.controllable = false;
                if (!state.finished) {
                    state.status = alive(cached.capture.ownerPid) ? 'external' : 'interrupted';
                    state.activity = state.status === 'external' ? 'This session is running in another VS Code window' : 'Session interrupted; saved transcript';
                }
                historic.push(state);
            }
        }
        return structuredClone([...own, ...historic].sort((a, b) => Number(!b.finished) - Number(!a.finished) || b.started.localeCompare(a.started)).slice(0, 60));
    }
}

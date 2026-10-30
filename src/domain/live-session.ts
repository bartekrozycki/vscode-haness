import { Usage } from './usage';
import type { LiveEntry, LiveSession, LiveEvent } from '../contracts/live';
export interface Capture {
    state: LiveSession;
    usage: Usage;
    seen: Set<string>;
    fallbackMessage?: string;
    bytes: number;
    omitted: boolean;
    ownerPid: number;
}
const MAX_ENTRIES = 300;
const MAX_TEXT = 60000;
const now = () => new Date().toISOString();
export const liveText = (value: unknown, max = MAX_TEXT): string => {
    const result = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2);
    return result.length > max ? '… [earlier content omitted]\n' + result.slice(-max) : result;
};
export function applyLiveEvent(capture: Capture, event: LiveEvent): void {
    if (event.id) {
        capture.seen.add(event.id);
        if (capture.seen.size > 10000)
            capture.seen.delete(capture.seen.values().next().value!);
    }
    const state = capture.state, data = event.data as Record<string, unknown>, timestamp = event.timestamp || now();
    state.updated = timestamp;
    const add = (entry: LiveEntry) => { state.entries.push(entry); if (state.entries.length > MAX_ENTRIES) {
        state.entries.shift();
        state.truncated = true;
    } };
    const statusEntry = (title: string, detail = '', kind: 'status' | 'error' = 'status') => add({ id: event.id || `${event.type}:${state.entries.length}:${timestamp}`, timestamp, kind, title, text: detail });
    switch (event.type) {
        case 'live.start':
            state.executor = String(data.executor || 'copilot-sdk');
            statusEntry('Starting executor', state.executor);
            break;
        case 'live.connect':
            state.session = String(data.session);
            state.status = 'running';
            state.activity = 'Session connected';
            statusEntry('Session connected', state.session);
            break;
        case 'live.activity':
            state.status = data.waiting ? 'waiting' : 'running';
            state.activity = String(data.activity);
            statusEntry(state.activity);
            break;
        case 'assistant.turn_start':
            state.status = 'running';
            state.activity = 'Agent working';
            capture.fallbackMessage = undefined;
            break;
        case 'assistant.message_delta':
        case 'assistant.message': {
            let id = data.messageId ? `message:${data.messageId}` : capture.fallbackMessage;
            if (!id)
                id = `message:${event.id || timestamp}`;
            capture.fallbackMessage = id;
            let entry = state.entries.find(e => e.id === id);
            if (!entry) {
                entry = { id, timestamp, kind: 'message', title: 'Agent response', text: '' };
                add(entry);
            }
            entry.text = liveText(event.type === 'assistant.message' ? data.content : entry.text + String(data.deltaContent || ''));
            if (data.model)
                state.model = String(data.model);
            state.activity = 'Agent responding';
            break;
        }
        case 'tool.execution_start': {
            const name = String(data.toolName || 'tool');
            add({ id: `tool:${data.toolCallId}`, timestamp, kind: 'tool', title: name, text: '', arguments: String(data.arguments || ''), status: 'running' });
            state.activity = `Tool: ${name}`;
            break;
        }
        case 'tool.execution_progress':
        case 'tool.execution_partial_result':
        case 'tool.shell_output':
        case 'tool.execution_complete': {
            const id = `tool:${data.toolCallId}`;
            let entry = state.entries.find(e => e.id === id);
            if (!entry) {
                entry = { id, timestamp, kind: 'tool', title: String(data.toolCallId || 'tool'), text: '', status: 'running' };
                add(entry);
            }
            if (event.type === 'tool.execution_complete') {
                entry.status = data.success === false || data.error ? 'failed' : 'completed';
                entry.text = liveText([entry.text, data.result, data.error].filter(Boolean).join('\n'));
                state.activity = state.entries.some(e => e.kind === 'tool' && e.status === 'running') ? 'Tools running' : 'Agent working';
            }
            else {
                entry.text = liveText(entry.text + String(data.text || data.partialOutput || data.progressMessage || ''));
                state.activity = `Tool: ${entry.title}`;
            }
            break;
        }
        case 'assistant.usage':
            if (data.model)
                state.model = String(data.model);
            break;
        case 'session.idle':
            state.activity = 'Waiting for session completion';
            break;
        case 'session.error':
            statusEntry('Session error', String(data.message || ''), 'error');
            state.activity = 'Session error';
            break;
        case 'live.truncated':
            state.truncated = true;
            statusEntry('Log size limit', 'Live text remains visible; long fragments are omitted from the saved log.');
            break;
        case 'live.finish':
            state.status = String(data.outcome);
            state.finished = timestamp;
            state.controllable = false;
            state.activity = data.outcome === 'limit' ? 'Session stopped by an extension limit' : 'Session completed';
            if (data.error)
                state.stopReason = String(data.error);
            statusEntry(`Finished: ${data.outcome}`, String(data.error || ''), data.outcome === 'failed' ? 'error' : 'status');
            for (const entry of state.entries)
                if (entry.kind === 'tool' && entry.status === 'running')
                    entry.status = 'interrupted';
            break;
    }
    capture.usage.add(event);
    let characters = state.entries.reduce((sum, entry) => sum + entry.text.length + (entry.arguments?.length || 0), 0);
    while (characters > 250000 && state.entries.length > 1) {
        const removed = state.entries.shift()!;
        characters -= removed.text.length + (removed.arguments?.length || 0);
        state.truncated = true;
    }
    Object.assign(state, { inputTokens: capture.usage.input, outputTokens: capture.usage.output, cacheReadTokens: capture.usage.cacheRead,
        premiumRequests: capture.usage.premium, costUsd: capture.usage.costUsd, turns: capture.usage.turns, toolCalls: capture.usage.calls });
}

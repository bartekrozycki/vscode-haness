import type { ExecutorEvent } from '../../contracts/executor';
import type { LiveEvent } from '../../contracts/live';
/** Stable internal log protocol preserves existing TSV streams across adapter changes. */
export function liveEvent(event: ExecutorEvent): LiveEvent | undefined {
    const meta = { id: event.id, timestamp: event.timestamp };
    switch (event.type) {
        case 'activity': return undefined;
        case 'message.delta': return { ...meta, type: 'assistant.message_delta', data: { messageId: event.messageId, deltaContent: event.text } };
        case 'message': return { ...meta, type: 'assistant.message', data: { messageId: event.messageId, content: event.text, model: event.model } };
        case 'turn.start': return { ...meta, type: 'assistant.turn_start', data: {} };
        case 'turn.end': return { ...meta, type: 'assistant.turn_end', data: {} };
        case 'tool.start': return { ...meta, type: 'tool.execution_start', data: { toolCallId: event.callId, toolName: event.name, arguments: event.input } };
        case 'tool.output': return { ...meta, type: 'tool.shell_output', data: { toolCallId: event.callId, text: event.text } };
        case 'tool.end': return { ...meta, type: 'tool.execution_complete', data: { toolCallId: event.callId, success: event.success, error: event.error, result: { content: event.output } } };
        case 'usage': return { ...meta, type: 'assistant.usage', data: { model: event.model, inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens, cost: event.premiumRequests, costUsd: event.costUsd } };
        case 'error': return { ...meta, type: 'session.error', data: { message: event.message } };
        default: throw new Error('Unknown executor event');
    }
}

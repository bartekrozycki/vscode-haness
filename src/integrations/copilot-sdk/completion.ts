import type { CopilotClient, CopilotSession, SessionEvent } from '@github/copilot-sdk';

/** Watch public events independently of the SDK's completion RPC, which can
 * remain pending even after the final response has been delivered. */
export async function runCopilotSession(
    session: Pick<CopilotSession, 'on' | 'sendAndWait'>,
    prompt: string,
    signal: AbortSignal,
    timeoutMs: number,
    onEvent: (event: SessionEvent) => void,
    finalTurnGraceMs = 1000,
): Promise<void> {
    let complete!: () => void, fail!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const pendingTools = new Set<string>();
    let finalResponse = false, fallback: ReturnType<typeof setTimeout> | undefined;
    const cancelFallback = () => { clearTimeout(fallback); fallback = undefined; };
    const abort = () => fail(signal.reason || new Error('Session stopped.'));
    const unsubscribe = session.on(event => {
        onEvent(event);
        if (event.agentId)
            return;
        switch (event.type) {
            case 'assistant.turn_start':
                cancelFallback();
                finalResponse = false;
                break;
            case 'assistant.message':
                finalResponse = !!event.data.content.trim() && !event.data.toolRequests?.length;
                break;
            case 'tool.execution_start':
                cancelFallback();
                finalResponse = false;
                pendingTools.add(event.data.toolCallId);
                break;
            case 'tool.execution_complete':
                pendingTools.delete(event.data.toolCallId);
                break;
            case 'assistant.turn_end':
                // A tool-using turn is intermediate. Only a main-agent final
                // response with no outstanding tools may recover a missing idle.
                if (finalResponse && !pendingTools.size) {
                    cancelFallback();
                    fallback = setTimeout(complete, finalTurnGraceMs);
                }
                break;
            case 'session.idle':
                if (event.data.aborted)
                    fail(new Error('Copilot aborted the session.'));
                else
                    complete();
                break;
            case 'session.error':
                fail(new Error(event.data.message));
                break;
        }
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
        signal.throwIfAborted();
        await Promise.race([session.sendAndWait({ prompt }, timeoutMs), completion]);
    }
    finally {
        cancelFallback();
        signal.removeEventListener('abort', abort);
        unsubscribe();
    }
}

export async function within<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Copilot connection shutdown timed out.')), timeoutMs);
        })]);
    }
    finally { clearTimeout(timer); }
}

/** Never let an unresponsive detach/shutdown RPC keep a finished task running. */
export async function closeCopilotSession(
    client: Pick<CopilotClient, 'stop' | 'forceStop'> | undefined,
    session: Pick<CopilotSession, 'disconnect'> | undefined,
    timeoutMs = 3000,
): Promise<void> {
    try {
        await within(async () => {
            try { await session?.disconnect(); }
            finally { await client?.stop(); }
        }, timeoutMs);
    }
    catch (error) {
        if (!client)
            throw error;
        await within(() => client.forceStop(), timeoutMs);
    }
}

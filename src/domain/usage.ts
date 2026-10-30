import type { Row } from '../contracts/model';
export class Usage {
    input = 0;
    output = 0;
    cacheRead = 0;
    cacheWrite = 0;
    turns = 0;
    calls = 0;
    premium: number | undefined;
    costUsd: number | undefined;
    readonly models = new Set<string>();
    private seen = new Set<string>();
    add(event: {
        id?: string;
        type: string;
        data: unknown;
    }): void {
        if (event.id && this.seen.has(event.id))
            return;
        if (event.id)
            this.seen.add(event.id);
        const data = event.data as Record<string, unknown>;
        if (['assistant.message', 'assistant.usage'].includes(event.type) && typeof data.model === 'string' && data.model)
            this.models.add(data.model);
        if (event.type === 'assistant.usage') {
            const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
            this.input += amount(data.inputTokens);
            this.output += amount(data.outputTokens);
            this.cacheRead += amount(data.cacheReadTokens);
            this.cacheWrite += amount(data.cacheWriteTokens);
            if (typeof data.cost === 'number' && Number.isFinite(data.cost) && data.cost >= 0)
                this.premium = (this.premium ?? 0) + data.cost;
            if (typeof data.costUsd === 'number' && Number.isFinite(data.costUsd) && data.costUsd >= 0)
                this.costUsd = (this.costUsd ?? 0) + data.costUsd;
            if (typeof data.model === 'string')
                this.models.add(data.model);
        }
        if (event.type === 'assistant.turn_start')
            this.turns++;
        if (event.type === 'tool.execution_start')
            this.calls++;
    }
    fields(): Record<string, string | number> {
        return { input_tokens: this.input, output_tokens: this.output, cache_read_tokens: this.cacheRead,
            cache_write_tokens: this.cacheWrite, premium_requests: this.premium ?? '', cost_usd: this.costUsd ?? '', turns: this.turns, tool_calls: this.calls };
    }
}
export function summarize(rows: Row[]) {
    const sum = (key: string) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    return { sessions: rows.length, input: sum('input_tokens'), output: sum('output_tokens'), cache: sum('cache_read_tokens'),
        durationMs: sum('duration_ms'), premium: rows.some(row => row.premium_requests !== '') ? sum('premium_requests') : undefined,
        costUsd: rows.some(row => row.cost_usd !== '') ? sum('cost_usd') : undefined };
}

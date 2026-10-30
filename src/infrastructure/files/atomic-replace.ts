import { rename } from 'node:fs/promises';

/** Preserve the old destination until an atomic rename succeeds. Windows readers may transiently block replacement. */
export async function atomicReplace(source: string, destination: string, options: {
    platform?: NodeJS.Platform;
    rename?: (source: string, destination: string) => Promise<void>;
    wait?: (milliseconds: number) => Promise<void>;
} = {}): Promise<void> {
    const move = options.rename ?? rename, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const delays = [10, 20, 40, 80, 160, 320, 320];
    for (let attempt = 0; ; attempt++) {
        try { await move(source, destination); return; }
        catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if ((options.platform ?? process.platform) !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= delays.length) throw error;
            await wait(delays[attempt]);
        }
    }
}

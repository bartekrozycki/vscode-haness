import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicReplace } from '../src/infrastructure/files/atomic-replace';
const error = (code: string) => Object.assign(new Error(code), { code });
async function fixture(run: (source: string, destination: string) => Promise<void>) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'atomic-replace-'));
    try { const source = path.join(dir, 'new'), destination = path.join(dir, 'old'); await writeFile(source, 'new'); await writeFile(destination, 'old'); await run(source, destination); }
    finally { await rm(dir, { recursive: true, force: true }); }
}
test('transient Windows rename preserves existing target and retries atomically', async () => fixture(async (source, destination) => {
    let calls = 0; const waits: number[] = [];
    await atomicReplace(source, destination, { platform: 'win32', wait: async ms => { waits.push(ms); assert.equal(await readFile(destination, 'utf8'), 'old'); }, rename: async (a,b) => { if (++calls === 1) throw error('EPERM'); await rename(a,b); } });
    assert.equal(calls, 2); assert.deepEqual(waits, [10]); assert.equal(await readFile(destination, 'utf8'), 'new');
}));
test('permanent Windows lock exhausts bounded retries while preserving old target', async () => fixture(async (source, destination) => {
    let calls = 0; const waits: number[] = [];
    await assert.rejects(atomicReplace(source, destination, { platform: 'win32', wait: async ms => { waits.push(ms); }, rename: async () => { calls++; throw error('EACCES'); } }), /EACCES/);
    assert.equal(calls, 8); assert.equal(waits.reduce((a,b) => a+b, 0), 950); assert.equal(await readFile(destination, 'utf8'), 'old'); assert.equal(await readFile(source, 'utf8'), 'new');
}));
test('non-transient and non-Windows errors are not retried', async () => fixture(async (source, destination) => {
    for (const [platform, code] of [['win32', 'ENOENT'], ['linux', 'EPERM']] as const) { let calls = 0; await assert.rejects(atomicReplace(source, destination, { platform, wait: async () => { throw new Error('unexpected wait'); }, rename: async () => { calls++; throw error(code); } }), new RegExp(code)); assert.equal(calls, 1); }
    assert.equal(await readFile(destination, 'utf8'), 'old');
}));

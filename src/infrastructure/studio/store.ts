import { atomicReplace } from '../files/atomic-replace';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { StudioRecord, StudioStore } from '../../contracts/studio';
import { projectPath } from '../files/project-paths';
const columns = ['id', 'kind', 'parent', 'title', 'status', 'revision', 'estimate', 'updated', 'file', 'data'];
const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
function fields(line: string): string[] {
    const output: string[] = [];
    let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (quoted && line[i + 1] === '"') {
                value += '"';
                i++;
            }
            else
                quoted = !quoted;
        }
        else if (c === '\t' && !quoted) {
            output.push(value);
            value = '';
        }
        else
            value += c;
    }
    output.push(value);
    return output;
}
export class FileStudioStore implements StudioStore {
    readonly owner = String(process.pid);
    ownerAlive(owner: string): boolean {
        if (!/^[0-9]+$/.test(owner)) return false;
        try { process.kill(Number(owner), 0); return true; } catch { return false; }
    }
    async list(root: string): Promise<StudioRecord[]> {
        const file = await projectPath(root, '.work-item/studio/records.tsv');
        let source: string;
        try {
            source = await readFile(file, 'utf8');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return [];
            throw error;
        }
        return Promise.all(source.trimEnd().split('\n').slice(1).filter(Boolean).map(async (line) => {
            const cells = fields(line);
            const row = Object.fromEntries(columns.map((key, i) => [key, cells[i]]));
            const record = { ...row, revision: Number(row.revision), estimate: row.estimate ? Number(row.estimate) : undefined, data: JSON.parse(row.data) } as StudioRecord;
            record.body = await readFile(await projectPath(root, record.file), 'utf8');
            return record;
        }));
    }
    async mutate<T>(root: string, action: (records: StudioRecord[]) => Promise<T>): Promise<T> {
        const directory = await projectPath(root, '.work-item/studio');
        await mkdir(directory, { recursive: true });
        const lock = path.join(directory, '.lock');
        const deadline = Date.now() + 15000;
        while (true) {
            try {
                await mkdir(lock);
                break;
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                    throw error;
                // Never steal a lock: after a crash an operator can inspect its owner.
                if (Date.now() > deadline)
                    throw new Error('Studio is locked by another writer. Inspect .work-item/studio/.lock/owner.json.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
        try {
            await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
            const records = await this.list(root), result = await action(records);
            for (const record of records) {
                const extension = record.kind === 'prototype' && record.data.format === 'html' ? 'html' : 'md';
                record.file = `.work-item/studio/docs/${record.id}.r${record.revision}-${createHash('sha256').update(record.body).digest('hex').slice(0, 12)}.${extension}`;
                const file = await projectPath(root, record.file);
                await mkdir(path.dirname(file), { recursive: true });
                try {
                    await writeFile(file, record.body, { flag: 'wx' });
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(file, 'utf8') !== record.body)
                        throw error;
                }
            }
            const output = columns.join('\t') + '\n' + records.map(r => columns.map(k => cell(k === 'data' ? JSON.stringify(r.data) : r[k as keyof StudioRecord])).join('\t')).join('\n') + '\n';
            const temporary = path.join(directory, `records.${process.pid}.tmp`);
            await writeFile(temporary, output);
            await atomicReplace(temporary, path.join(directory, 'records.tsv'));
            return result;
        }
        finally {
            await rm(lock, { recursive: true, force: true });
        }
    }
}

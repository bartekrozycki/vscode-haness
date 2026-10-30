import { atomicReplace } from '../files/atomic-replace';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectPath } from '../files/project-paths';
import type { AutomationState, AutomationStore } from '../../contracts/automation';
export class FileAutomationStore implements AutomationStore {
    readonly owner = String(process.pid);
    ownerAlive(owner: string): boolean {
        if (!/^[0-9]+$/.test(owner)) return false;
        try { process.kill(Number(owner), 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
    }
    async read(root: string): Promise<AutomationState> {
        const file = await projectPath(root, '.work-item/automation/state.json');
        try { const data = JSON.parse(await readFile(file, 'utf8')); if (!Array.isArray(data.requests)) throw new Error('Invalid automation state'); return data; }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { requests: [] }; throw e; }
    }
    async mutate<T>(root: string, fn: (state: AutomationState) => T | Promise<T>): Promise<T> {
        const dir = await projectPath(root, '.work-item/automation'); await mkdir(dir, { recursive: true });
        const lock = path.join(dir, '.lock'), deadline = Date.now() + 15000;
        while (true) { try { await mkdir(lock); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; try { const age = Date.now() - (await stat(lock)).mtimeMs; if (age > 30000) { let owner: { pid?: number } = {}; try { owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')); } catch (ownerError) { if ((ownerError as NodeJS.ErrnoException).code === 'ENOENT' && age > 60000) { await rm(lock, { recursive: true, force: true }); continue; } } if (typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0) { let alive = true; try { process.kill(owner.pid!, 0); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ESRCH') alive = false; } if (!alive) { await rm(lock, { recursive: true, force: true }); continue; } } } } catch {} if (Date.now() > deadline) throw new Error('Automation state is locked; inspect .work-item/automation/.lock'); await new Promise(r => setTimeout(r, 25)); } }
        try { await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString() })); const state = await this.read(root); const result = await fn(state); const temp = path.join(dir, `state.${randomUUID()}.tmp`); try { await writeFile(temp, JSON.stringify(state, null, 2)); await atomicReplace(temp, path.join(dir, 'state.json')); } finally { await rm(temp, { force: true }); } return result; }
        finally { await rm(lock, { recursive: true, force: true }); }
    }
}

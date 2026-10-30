import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, projectPath } from '../files/project-paths';
/** Explicit, additive initialization: existing project files are never replaced. */
export async function initialize(root: string, resourceRoot: string): Promise<{
    created: string[];
    preserved: string[];
}> {
    const result = { created: [] as string[], preserved: [] as string[] };
    const existingScript = await projectPath(root, 'tools/work-items.py');
    if (await exists(existingScript)) {
        const content = await readFile(existingScript, 'utf8');
        if (!content.includes('Project-owned Copilot harness.'))
            throw new Error('tools/work-items.py already exists and belongs to another harness. No files were changed; select a separate project or prepare an explicit migration.');
    }
    async function copy(directory: string, prefix = ''): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await copy(path.join(directory, entry.name), relative);
                continue;
            }
            const target = await projectPath(root, relative);
            await mkdir(path.dirname(target), { recursive: true });
            try {
                await writeFile(target, await readFile(path.join(directory, entry.name)), { flag: 'wx' });
                result.created.push(relative);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                    throw error;
                result.preserved.push(relative);
            }
        }
    }
    await copy(path.join(resourceRoot, 'project'));
    return result;
}

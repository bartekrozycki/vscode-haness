import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
/** Explicit scaffold into a new folder; never runs or installs the generated code. */
export async function scaffoldModule(target: string, resources: string, sdk: string, id: string) {
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(id))
        throw new Error('Use a publisher.module ID, for example acme.quality.');
    const [publisher, name] = id.split('.');
    // exclusive mkdir makes a mistaken destination fail before any existing file is touched
    await mkdir(target);
    const values: Record<string, string> = { id, publisher, name, title: name, tool: id.replace(/[.-]/g, '_') + '_summary' };
    async function copy(source: string, destination: string, template: boolean) {
        for (const entry of await readdir(source, { withFileTypes: true })) {
            const file = path.join(destination, entry.name), original = path.join(source, entry.name);
            if (entry.isDirectory()) {
                await mkdir(file);
                await copy(original, file, template);
            }
            else {
                const text = await readFile(original, 'utf8');
                await writeFile(file, template ? text.replace(/\{\{([a-z]+)\}\}/g, (_, key: string) => values[key] || '') : text, { flag: 'wx' });
            }
        }
    }
    await copy(path.join(resources, 'module'), target, true);
    await mkdir(path.join(target, 'sdk'));
    await copy(sdk, path.join(target, 'sdk'), false);
    await writeFile(path.join(target, 'LICENSE'), await readFile(path.join(resources, '..', 'LICENSE')), { flag: 'wx' });
    return target;
}

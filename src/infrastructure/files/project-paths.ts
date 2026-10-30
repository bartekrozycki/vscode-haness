import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
export async function exists(file: string): Promise<boolean> { try {
    await access(file);
    return true;
}
catch {
    return false;
} }
export async function projectPath(root: string, relative: string): Promise<string> {
    const base = await realpath(root);
    const target = path.resolve(base, relative);
    const inside = (value: string) => value === base || (!path.relative(base, value).startsWith(`..${path.sep}`) && path.relative(base, value) !== '..' && !path.isAbsolute(path.relative(base, value)));
    if (!inside(target))
        throw new Error('Path leaves the project');
    let ancestor = target;
    while (!(await exists(ancestor)))
        ancestor = path.dirname(ancestor);
    if (!inside(await realpath(ancestor)))
        throw new Error('Symlink leaves the project');
    return target;
}

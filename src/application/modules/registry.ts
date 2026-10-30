import type { ModuleContext, ModuleInfo, SdlcEvent, SdlcModule, WorkbenchContributions, WidgetContent } from '../../contracts/api';
import type { ToolRegistrar } from '../ports';
import { ExecutorRegistry } from '../executors/registry';
/** No dependency on VS Code or a UI renderer. One lifecycle for every contribution. */
export class ModuleRegistry {
    private readonly modules = new Map<string, SdlcModule>();
    private readonly listeners = new Set<(event: SdlcEvent) => void>();
    private readonly handles = new Set<{
        dispose(): void;
    }>();
    constructor(private readonly tools: ToolRegistrar, private readonly log: (error: unknown) => void = () => { }, readonly executors = new ExecutorRegistry()) { }
    onDidEvent(listener: (event: SdlcEvent) => void) {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }
    emit(event: SdlcEvent) {
        for (const listener of [...this.listeners])
            try {
                listener(event);
            }
            catch (error) {
                this.log(error);
            }
    }
    list(): ModuleInfo[] {
        return [...this.modules.values()].map(m => ({ id: m.id, title: m.title, version: m.version, description: m.description, tools: (m.tools || []).map(t => t.definition.name), executors: (m.executors || []).map(e => e.id) }));
    }
    register(module: SdlcModule) {
        if (module.apiVersion !== 1)
            throw new Error('Unsupported SDLC module API version');
        if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(module.id) || this.modules.has(module.id))
            throw new Error('Invalid or duplicate module id');
        if (!module.title || !module.version)
            throw new Error('Module needs title and version');
        for (const entries of [module.widgets || [], module.actions || []]) {
            const ids = new Set<string>();
            for (const entry of entries) {
                if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id))
                    throw new Error('Invalid or duplicate contribution id');
                ids.add(entry.id);
            }
        }
        for (const w of module.widgets || [])
            if (!['workspace', 'task'].includes(w.placement) || typeof w.provide !== 'function')
                throw new Error('Invalid widget');
        for (const a of module.actions || [])
            if (!['workspace', 'task'].includes(a.scope) || typeof a.run !== 'function')
                throw new Error('Invalid action');
        const registrations: {
            dispose(): void;
        }[] = [];
        try {
            for (const tool of module.tools || [])
                registrations.push(this.tools.registerTool(tool.definition, tool.invoke));
            for (const executor of module.executors || [])
                registrations.push(this.executors.register(executor, module.id));
        }
        catch (error) {
            registrations.reverse().forEach(r => r.dispose());
            throw error;
        }
        // Freeze the registration shape so outside mutation cannot change its ownership.
        const owned = { ...module, tools: (module.tools || []).map(t => ({ ...t, definition: structuredClone(t.definition) })), widgets: (module.widgets || []).map(w => ({ ...w })), actions: (module.actions || []).map(a => ({ ...a })), executors: (module.executors || []).map(e => ({ ...e, id: e.id, title: e.title, apiVersion: e.apiVersion, createSession: e.createSession.bind(e) })) };
        this.modules.set(module.id, owned);
        this.emit({ type: 'modules.changed' });
        let disposed = false;
        const handle = { dispose: () => {
                if (disposed)
                    return;
                disposed = true;
                try { owned.onDispose?.(); } catch (error) { this.log(error); }
                this.modules.delete(owned.id);
                this.handles.delete(handle);
                registrations.reverse().forEach(r => r.dispose());
                this.emit({ type: 'modules.changed' });
            } };
        this.handles.add(handle);
        return handle;
    }
    async resolve(context: ModuleContext): Promise<WorkbenchContributions> {
        const registered = [...this.modules.values()];
        const widgets = registered.flatMap(module => (module.widgets || []).map(widget => ({ module, widget })))
            .filter(({ widget }) => widget.placement === 'workspace' || context.item)
            .sort((a, b) => (a.widget.order || 0) - (b.widget.order || 0));
        const resolved = await Promise.all(widgets.map(async ({ module, widget }) => {
            const base = { id: `${module.id}/${widget.id}`, module: module.id, title: widget.title, placement: widget.placement };
            const controller = new AbortController();
            const abort = () => controller.abort();
            context.signal.addEventListener('abort', abort, { once: true });
            if (context.signal.aborted)
                controller.abort();
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                const result = await Promise.race([
                    Promise.resolve().then(() => widget.provide({ ...context, snapshot: context.snapshot && structuredClone(context.snapshot), item: widget.placement === 'task' ? context.item : undefined, signal: controller.signal })),
                    new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Module provider timed out (3s)')); }, 3000); }),
                ]);
                if (result === undefined)
                    return undefined;
                return { ...base, content: validateContent(result) };
            }
            catch (error) {
                this.log(error);
                return { ...base, error: String(error instanceof Error ? error.message : error) };
            }
            finally {
                clearTimeout(timeout);
                context.signal.removeEventListener('abort', abort);
            }
        }));
        return {
            modules: this.list(), widgets: resolved.filter(w => w !== undefined),
            actions: registered.flatMap(m => (m.actions || []).filter(a => a.scope === 'workspace' || context.item).map(a => ({ id: `${m.id}/${a.id}`, module: m.id, title: a.title, scope: a.scope }))),
        };
    }
    async invoke(id: string, context: ModuleContext): Promise<unknown> {
        const [owner, name] = id.split('/'), module = this.modules.get(owner), action = module?.actions?.find(a => a.id === name);
        if (!action || id !== `${owner}/${action.id}`)
            throw new Error('Unknown module action');
        if (action.scope === 'task' && !context.item)
            throw new Error('Select a task first');
        try {
            return await action.run({ ...context, snapshot: context.snapshot && structuredClone(context.snapshot), item: action.scope === 'task' ? context.item : undefined });
        }
        finally {
            this.emit({ type: 'workspace.changed', root: context.root });
        }
    }
    dispose() { for (const handle of [...this.handles])
        handle.dispose(); this.listeners.clear(); }
}
function validateContent(value: WidgetContent): WidgetContent {
    // Data-only protocol. No HTML, scripts or callbacks cross the webview boundary.
    if (!value || typeof value !== 'object')
        throw new Error('Invalid widget content');
    if (value.kind === 'text' && typeof value.text === 'string')
        return { kind: 'text', text: value.text.slice(0, 40000) };
    if (value.kind === 'metrics' && Array.isArray(value.values))
        return { kind: 'metrics', values: value.values.slice(0, 20).map(v => ({ label: String(v.label).slice(0, 100), value: String(v.value).slice(0, 500), ...(v.detail ? { detail: String(v.detail).slice(0, 500) } : {}) })) };
    if (value.kind === 'table' && Array.isArray(value.columns) && Array.isArray(value.rows)) {
        const columns = value.columns.slice(0, 20).map(String);
        return { kind: 'table', columns, rows: value.rows.slice(0, 200).map(row => Object.fromEntries(columns.map(key => [key, String(row[key] ?? '').slice(0, 4000)]))) };
    }
    throw new Error('Unsupported widget content');
}

import * as vscode from 'vscode';
import path from 'node:path';
import type { Snapshot } from '../../contracts/model';
import type { ModuleRegistry } from '../../application/modules/registry';
import type { LiveSession } from '../../contracts/live';
import { liveForView } from './live-payload';
import { dashboardHtml } from '../../ui/webview/shell';
export interface WorkbenchHost {
    snapshot(root: string): Promise<Snapshot | undefined>;
    sessions(root: string, snapshot?: Snapshot): Promise<LiveSession[]>;
    action(root: string, message: Record<string, unknown>): Promise<void>;
    log(error: unknown): void;
    onReady?(root:string):void;
    usage?(root:string,snapshot:Snapshot,sessions:LiveSession[]):Promise<Snapshot>;
}
interface View {
    root: string;
    panel: vscode.WebviewPanel;
    ready: boolean;
    revision: number;
    liveRevision: number;
    refreshError?: string;
    snapshot?: Snapshot;
    item?: string;
    run?: string;
    navigateRun?: string;
    controller?: AbortController;
    actions: Map<string, AbortController>;
    timer?: ReturnType<typeof setTimeout>;
    usageBusy?: boolean;
    usageAt?: number;
    liveTimer?: ReturnType<typeof setTimeout>;
}
/** Owns presentation lifecycle only. Domain commands and runtime are injected. */
export class Workbench {
    private readonly views = new Map<string, View>();
    private readonly pending = new Map<string, Map<string, Record<string, unknown>>>();
    post(root: string, message: Record<string, unknown>) {
        const view = this.views.get(root);
        if (view?.ready) { void Promise.resolve(view.panel.webview.postMessage(message)).catch(error => this.host.log(error)); return; }
        const queue = this.pending.get(root) || new Map<string, Record<string, unknown>>();
        queue.set(String(message.type), message); this.pending.set(root, queue);
    }
    constructor(private readonly host: WorkbenchHost, private readonly modules: ModuleRegistry, private readonly script: string) { }
    async open(root: string, selection?: {
        item?: string;
        run?: string;
    }): Promise<void> {
        let view = this.views.get(root);
        if (!view) {
            const panel = vscode.window.createWebviewPanel('copilotSdlc.dashboard', `SDLC · ${path.basename(root)}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
            view = { root, panel, ready: false, revision: 0, liveRevision: 0, actions: new Map() };
            const owned = view;
            this.views.set(root, view);
            panel.webview.options = { enableScripts: true, localResourceRoots: [] };
            const listener = panel.webview.onDidReceiveMessage(message => {
                void this.receive(owned, message).catch(error => {
                    this.host.log(error);
                    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                });
            });
            panel.onDidDispose(() => { owned.controller?.abort(); for (const action of owned.actions.values())
                action.abort(); clearTimeout(owned.timer); clearTimeout(owned.liveTimer); listener.dispose(); this.views.delete(root); });
            panel.webview.html = dashboardHtml({ cspSource: panel.webview.cspSource, script: this.script });
        }
        else
            view.panel.reveal();
        if (selection?.item) {
            view.item = selection.item;
            if (!selection.run) {
                view.run = undefined;
                view.navigateRun = undefined;
            }
        }
        if (selection?.run) {
            view.run = selection.run;
            const session = (await this.host.sessions(root, view.snapshot)).find(s => s.run === selection.run);
            if (session)
                view.item = session.item;
        }
        if (view.ready) {
            await this.refresh(view);
            await this.navigate(view);
        }
    }
    private async navigate(view: View) {
        if (view.run)
            this.liveChanged(view.root, view.run);
        else
            await view.panel.webview.postMessage({ type: 'navigate', item: view.item });
    }
    changed(root?: string) {
        for (const view of this.views.values())
            if (!root || view.root === root) {
                clearTimeout(view.timer);
                view.timer = setTimeout(() => { void this.refresh(view); }, 150);
            }
    }
    liveChanged(root: string, run?: string) {
        const view = this.views.get(root);
        if (!view)
            return;
        if (run) {
            view.run = run;
            view.navigateRun = run;
        }
        if (view.liveTimer)
            return;
        view.liveTimer = setTimeout(async () => {
            view.liveTimer = undefined;
            if (!view.ready || !this.views.has(root))
                return;
            const liveVersion = ++view.liveRevision;
            const selectedRun = view.run;
            try {
                const sessions = await this.host.sessions(root, view.snapshot);
                if (!this.views.has(root))
                    return;
                let selection: { item?: string; run: string } | undefined;
                if (view.navigateRun && view.run === selectedRun) {
                    const target = view.navigateRun;
                    view.navigateRun = undefined;
                    view.item = sessions.find(s => s.run === target)?.item || view.item;
                    selection = { item: view.item, run: target };
                }
                // Selection and transcript must arrive together: rendering a navigation
                // against the old list otherwise selects the previous run again.
                await view.panel.webview.postMessage({ type: 'live', liveVersion, live: liveForView(sessions, selectedRun), selection });
                if (this.host.usage && view.snapshot && !view.usageBusy && Date.now()-(view.usageAt||0)>=500) {
                    view.usageBusy=true;view.usageAt=Date.now();const previous=view.snapshot;
                    try { const updated=await this.host.usage(root,previous,sessions);if(view.snapshot===previous&&this.views.has(root)){view.snapshot=updated;await this.contributions(view);} }
                    finally {view.usageBusy=false;}
                }
            }
            catch (error) {
                this.host.log(error);
            }
        }, 100);
    }
    private async receive(view: View, message: Record<string, unknown>) {
        if (!message || typeof message.action !== 'string')
            return;
        if (message.action === 'ready') {
            view.ready = true;
            this.host.onReady?.(view.root);
            for (const message of this.pending.get(view.root)?.values() || []) await view.panel.webview.postMessage(message);
            this.pending.delete(view.root);
            await this.refresh(view);
            await this.navigate(view);
            return;
        }
        if (message.action === 'selectTask' || message.action === 'selectSession') {
            if (typeof message.id === 'string' && view.snapshot?.tasks.some(t => t.id === message.id))
                view.item = message.id;
            if (typeof message.run === 'string') {
                const session = (await this.host.sessions(view.root, view.snapshot)).find(s => s.run === message.run);
                if (session) {
                    view.run = session.run;
                    view.item = session.item;
                }
            }
            await this.contributions(view);
            this.liveChanged(view.root);
            return;
        }
        if (message.action === 'moduleAction') {
            if (!vscode.workspace.isTrusted)
                throw new Error('Trust this workspace before running a module.');
            if (typeof message.contribution !== 'string')
                return;
            const key = `${message.contribution}:${view.item || ''}`;
            if (view.actions.has(key))
                return;
            const controller = new AbortController();
            view.actions.set(key, controller);
            try {
                await this.modules.invoke(message.contribution, { root: view.root, snapshot: view.snapshot, item: view.item, signal: controller.signal });
            }
            finally {
                view.actions.delete(key);
            }
            this.changed(view.root);
            return;
        }
        if (message.action === 'refresh') {
            await view.panel.webview.postMessage({ type: 'refreshState', busy: true });
            try { await this.refresh(view, true); }
            finally { await view.panel.webview.postMessage({ type: 'refreshState', busy: false, error: view.refreshError }); }
            return;
        }
        await this.host.action(view.root, message);
    }
    private async contributions(view: View) {
        if (!vscode.workspace.isTrusted)
            return;
        const item = view.item, revision = view.revision, snapshot = view.snapshot;
        const contributions = await this.modules.resolve({ root: view.root, snapshot: view.snapshot, item, signal: view.controller?.signal || new AbortController().signal });
        if (revision === view.revision && snapshot === view.snapshot && item === view.item && this.views.has(view.root))
            await view.panel.webview.postMessage({ type: 'contributions', contributions, item });
    }
    private async refresh(view: View, manual = false) {
        if (!view.ready)
            return;
        const revision = ++view.revision;
        view.controller?.abort();
        view.controller = new AbortController();
        let error: string | undefined, live: LiveSession[] | undefined, liveVersion: number | undefined;
        try {
            const snapshot = await this.host.snapshot(view.root);
            if (revision !== view.revision)
                return;
            view.snapshot = snapshot;
            liveVersion = ++view.liveRevision;
            live = snapshot ? await this.host.sessions(view.root, snapshot) : [];
        }
        catch (cause) {
            error = String(cause);
            if (revision === view.revision)
                view.snapshot = undefined;
        }
        if (revision !== view.revision || !this.views.has(view.root))
            return;
        view.refreshError = error;
        await view.panel.webview.postMessage({ type: 'snapshot', manual, snapshot: view.snapshot, error, liveVersion, live: live && liveForView(live, view.run), project: path.basename(view.root) });
        await this.contributions(view);
    }
    dispose() { for (const view of [...this.views.values()])
        view.panel.dispose(); }
}

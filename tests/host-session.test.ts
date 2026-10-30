import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppServices } from '../src/application/services';
import type { ModuleRegistry } from '../src/application/modules/registry';
import type { Snapshot } from '../src/contracts/model';
import type { LiveSession } from '../src/contracts/live';
import type { WorkspaceAccess } from '../src/host/vscode/workspace';
import type { Workbench as WorkbenchType } from '../src/host/vscode/workbench';
import type { createCommands as CommandsType } from '../src/host/vscode/commands';
import { loadHost } from './support/vscode-host';

const old = { run: 'old', item: 'WI-001', entries: [], status: 'completed' } as unknown as LiveSession;
const current = { run: 'new', item: 'WI-001', entries: [{ text: 'Working' }], controllable: true } as LiveSession;

test('starting a session publishes its transcript and navigation atomically to an already open workbench', async () => {
  const messages: Record<string, any>[] = [];
  let receive = (_message: unknown) => {}, dispose = () => {}, sessions = [old];
  const waiting: { type: string; resolve: (value: Record<string, any>) => void }[] = [];
  const next = (type: string) => new Promise<Record<string, any>>(resolve => waiting.push({ type, resolve }));
  const panel = { webview: { cspSource: 'test', onDidReceiveMessage: (fn: typeof receive) => { receive = fn; return { dispose() {} }; },
    postMessage: async (message: Record<string, any>) => { messages.push(message); const index = waiting.findIndex(w => w.type === message.type); if (index >= 0) waiting.splice(index, 1)[0].resolve(message); return true; } },
    onDidDispose: (fn: typeof dispose) => { dispose = fn; }, dispose: () => dispose(), reveal() {} };
  const { Workbench } = await loadHost<{ Workbench: typeof WorkbenchType }>('src/host/vscode/workbench.ts', {
    window: { createWebviewPanel: () => panel }, ViewColumn: { Active: 1 }, workspace: { isTrusted: true },
  });
  const modules = { resolve: async () => ({ modules: [], widgets: [], actions: [] }) } as unknown as ModuleRegistry;
  const workbench = new Workbench({ snapshot: async () => ({ tasks: [{ id: 'WI-001' }] }) as unknown as Snapshot,
    sessions: async () => sessions, action: async () => {}, log: error => { throw error; } }, modules, '');
  try {
    await workbench.open('/project');
    const initial = next('snapshot'); receive({ action: 'ready' }); await initial;
    const refreshed = next('snapshot'); receive({ action: 'refresh' });
    assert.equal((await refreshed).manual, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(messages.some(m => m.type === 'refreshState' && m.busy === true));
    assert.ok(messages.some(m => m.type === 'refreshState' && m.busy === false));
    sessions = [current, old];
    const update = next('live'); workbench.liveChanged('/project', current.run);
    const message = await update;
    assert.deepEqual(message.selection, { item: 'WI-001', run: 'new' });
    assert.equal(message.live.find((s: LiveSession) => s.run === 'new').entries[0].text, 'Working');
    assert.ok(message.liveVersion > 0);
    assert.equal(messages.some(m => m.type === 'navigate' && m.run === 'new'), false, 'No navigation before the transcript arrives');
  } finally { workbench.dispose(); }
});

test('the run action uses panel progress without creating a separate notification', async () => {
  const { createCommands } = await loadHost<{ createCommands: typeof CommandsType }>('src/host/vscode/commands.ts', {
    window: { withProgress: () => { throw new Error('Unexpected progress notification'); } }, ProgressLocation: { Notification: 1 },
  });
  let runs = 0, opened = 0;
  const services = { projects: { open: () => ({}) }, modules: { emit() {} }, runner: { run: async () => { runs++; } } } as unknown as AppServices;
  const workspace = { trust() {}, approve: async () => true } as unknown as WorkspaceAccess;
  const workbench = { open: async () => { opened++; } } as unknown as WorkbenchType;
  const snapshot = { tasks: [{ id: 'WI-001' }], agentActions: { 'WI-001': [{ role: 'planner', enabled: true }] } } as unknown as Snapshot;
  const commands = createCommands(services, workspace, workbench, async () => snapshot);
  await commands.handleAction('/project', { action: 'run', id: 'WI-001', role: 'planner' });
  assert.equal(runs, 1); assert.equal(opened, 1);
});

test('live usage refreshes contributions without rerunning Python snapshots and ready can replay drafts',async()=>{
 let receive=(_message:unknown)=>{},dispose=()=>{},snapshots=0,ready=0;const packets:Record<string,any>[]=[];
 const panel={webview:{cspSource:'test',onDidReceiveMessage:(fn:typeof receive)=>{receive=fn;return{dispose(){}};},postMessage:async(message:Record<string,any>)=>{packets.push(message);return true;}},onDidDispose:(fn:typeof dispose)=>{dispose=fn;},dispose:()=>dispose(),reveal(){}};
 const {Workbench}=await loadHost<{Workbench:typeof WorkbenchType}>('src/host/vscode/workbench.ts',{window:{createWebviewPanel:()=>panel},ViewColumn:{Active:1},workspace:{isTrusted:true}});
 const modules={resolve:async(context:any)=>({modules:[],actions:[],widgets:[{id:'usage',content:{kind:'metrics',values:[{label:'Input',value:context.snapshot?.projectUsage?.inputTokens||0}]}}]})} as unknown as ModuleRegistry;
 const workbench=new Workbench({snapshot:async()=>{snapshots++;return {tasks:[]} as unknown as Snapshot;},sessions:async()=>[current],action:async()=>{},log:error=>{throw error;},onReady:()=>{ready++;},usage:async(_root,state)=>({...state,projectUsage:{sessions:1,active:1,inputTokens:42,outputTokens:3,durationMs:100,costKnown:0,premiumKnown:0,demo:0}})},modules,'');
 try{await workbench.open('/live');receive({action:'ready'});await new Promise(resolve=>setTimeout(resolve,30));const initial=snapshots;workbench.liveChanged('/live');await new Promise(resolve=>setTimeout(resolve,180));assert.equal(snapshots,initial);assert.equal(ready,1);assert.ok(packets.some(p=>p.type==='contributions'&&p.contributions.widgets[0].content.values[0].value===42));}
 finally{workbench.dispose();}
});

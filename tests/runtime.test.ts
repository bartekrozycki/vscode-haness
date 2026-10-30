import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { CopilotClient, PermissionRequest, SessionConfig, SessionEvent } from '@github/copilot-sdk';
import { initialize, TestProjectClient as HarnessClient } from './support/project';
import { TestToolRegistry as ToolRegistry, testRunner, testRunnerServices } from './support/services';
import { SessionRunner, type RuntimeHost } from '../src/application/sessions/runner';
import { ExecutorRegistry } from '../src/application/executors/registry';
import { copilotSdkExecutor } from '../src/integrations/copilot-sdk/executor';

class CopilotTestRunner extends SessionRunner {
  constructor(registry: ToolRegistry, python: () => string, host: RuntimeHost & { client: (root: string) => Promise<CopilotClient> }) {
    const executors = new ExecutorRegistry(); executors.register(copilotSdkExecutor({ client: host.client }));
    super(testRunnerServices(registry, python, host, executors));
  }
}
import { FileSessionLog as LiveSessions } from '../src/infrastructure/sessions/file-session-log';

test('worker and judge run through the real tools and write separate usage records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-runtime-'));
  try {
    await initialize(root, path.resolve('resources'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'SDK test'); git('config', 'user.email', 'sdk@example.invalid');
    git('add', 'tools/work-items.py'); git('commit', '-qm', 'test: initial harness');
    const harness = new HarnessClient(root);
    const config = await harness.config(); config.gates = [{ name: 'unit', command: ['python3', '-c', 'assert 1 == 1'] }];
    await writeFile(path.join(root, '.copilot-sdlc/config.json'), JSON.stringify(config));
    const item = await harness.invoke<{ id: string }>({ operation: 'create', title: 'SDK task', requirements: 'W1: verify' });
    git('commit', '--allow-empty', '-qm', `test: work item (${item.id})`);
    const sha = git('rev-parse', 'HEAD');
    await harness.invoke({ operation: 'approve', id: item.id });
    let role = 'worker', stopCount = 0;
    const created: SessionConfig[] = [];
    const fakeClient = {
      start: async () => {}, stop: async () => { stopCount++; return []; },
      createSession: async (options: SessionConfig) => {
        created.push(options);
        let listener: (event: SessionEvent) => void = () => {};
        return { sessionId: `session-${role}`, on: (fn: typeof listener) => { listener = fn; return () => {}; }, abort: async () => {}, disconnect: async () => {},
          sendAndWait: async () => {
            const invoke = async (name: string, args: Record<string, unknown>) => {
              const tool = options.tools!.find(t => t.name === name)!;
              return tool.handler!(args, { sessionId: 'test', toolCallId: 'test', toolName: name, arguments: args });
            };
            if (role === 'worker') {
              await invoke('sdlc_update_task', { operation: 'update', id: item.id, status: 'active' });
              await invoke('sdlc_tasks', { operation: 'gates', id: item.id, commit: sha });
              await invoke('sdlc_update_task', { operation: 'update', id: item.id, status: 'review', commit: sha, evidence: 'W1: test green' });
            } else await invoke('sdlc_update_task', { operation: 'update', id: item.id, status: 'accepted', evidence: 'W1: independently verified' });
            listener({ id: 'usage-1', type: 'assistant.usage', data: { inputTokens: 100, outputTokens: 20, model: 'test-model', cost: 0.5 } } as SessionEvent);
            listener({ id: 'message-1', type: 'assistant.message', data: { content: 'Report' } } as SessionEvent);
          },
        };
      },
    } as unknown as CopilotClient;
    let runner: CopilotTestRunner;
    const registry = new ToolRegistry(path.resolve('resources'), () => 'python3', (input, ctx) => runner.run(input, ctx));
    runner = new CopilotTestRunner(registry, () => 'python3', { client: async () => fakeClient, permission: async () => ({ kind: 'reject' }), input: async () => undefined, log: () => {}, changed: () => {} });
    await runner.run({ id: item.id, role }, { root });
    role = 'judge'; await runner.run({ id: item.id, role }, { root });
    const snapshot = await harness.snapshot();
    assert.equal(snapshot.tasks[0].status, 'accepted');
    assert.equal(snapshot.metrics.length, 2);
    assert.equal(snapshot.metrics[0].input_tokens, '100');
    assert.equal(snapshot.metrics[0].cost_usd, '');
    assert.equal(snapshot.metrics[0].premium_requests, '0.5');
    assert.equal(stopCount, 2);
    assert.equal(runner.activeCount, 0);
    assert.ok(created[0].availableTools);
    assert.equal(created[1].agent, 'sdlc-judge');
    assert.ok(!(created[1].availableTools as string[]).includes('edit'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failure before SDK startup releases the in-memory slot without a fake metric', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-runtime-'));
  try {
    await initialize(root, path.resolve('resources'));
    const harness = new HarnessClient(root);
    const item = await harness.invoke<{ id: string }>({ operation: 'create', title: 'Not approved', requirements: 'W1' });
    const registry = new ToolRegistry(path.resolve('resources'), () => 'python3', async () => {});
    const runner = new CopilotTestRunner(registry, () => 'python3', { client: async () => { throw new Error('Must not reach SDK'); }, permission: async () => ({ kind: 'reject' }), input: async () => undefined, log: () => {}, changed: () => {} });
    await assert.rejects(runner.run({ id: item.id, role: 'worker' }, { root }), /Approve implementation/);
    assert.equal(runner.activeCount, 0);
    assert.equal((await harness.snapshot()).metrics.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const mode of ['bypass', 'ask', 'legacy'] as const) {
  test(`SDK permissions and project tools use ${mode === 'legacy' ? 'bypass for an older project' : mode}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-permissions-'));
    try {
      await initialize(root, path.resolve('resources'));
      const harness = new HarnessClient(root);
      const config = await harness.config();
      if (mode === 'legacy') delete config.session.permissions;
      else config.session.permissions = mode;
      await writeFile(path.join(root, '.copilot-sdlc/config.json'), JSON.stringify(config));
      const item = await harness.invoke<{ id: string }>({ operation: 'create', title: 'Permission mode', requirements: 'W1' });
      let permissionPrompts = 0, toolPrompts = 0;
      const fakeClient = {
        start: async () => {}, stop: async () => [],
        createSession: async (options: SessionConfig) => ({
          sessionId: 'permission-session', on: () => () => {}, abort: async () => {}, disconnect: async () => {},
          sendAndWait: async () => {
            for (const kind of ['read', 'write', 'shell', 'url', 'mcp']) {
              const result = await options.onPermissionRequest!({ kind } as PermissionRequest, { sessionId: 'permission-session' });
              assert.equal(result.kind, mode === 'ask' ? 'reject' : 'approve-once');
            }
            const tool = options.tools!.find(t => t.name === 'project_info')!;
            const invoke = () => tool.handler!({}, { sessionId: 'permission-session', toolCallId: 'call-1', toolName: 'project_info', arguments: {} });
            if (mode === 'ask') assert.match(JSON.stringify(await invoke()), /not approved/);
            else assert.ok(String(await invoke()).includes(item.id));
          },
        }),
      } as unknown as CopilotClient;
      const registry = new ToolRegistry(path.resolve('resources'), () => 'python3', async () => {});
      const runner = new CopilotTestRunner(registry, () => 'python3', {
        client: async () => fakeClient, permission: async () => { permissionPrompts++; return { kind: 'reject' }; },
        input: async () => undefined, log: () => {}, changed: () => {},
      });
      await runner.run({ id: item.id, role: 'planner' }, { root, approve: async () => { toolPrompts++; return false; } });
      assert.equal(permissionPrompts, mode === 'ask' ? 5 : 0);
      assert.equal(toolPrompts, mode === 'ask' ? 1 : 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('live SDK events are visible while running and stopping one session leaves the other running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-live-runtime-'));
  let runner: CopilotTestRunner | undefined;
  const jobs: Promise<unknown>[] = [];
  try {
    await initialize(root, path.resolve('resources'));
    const harness = new HarnessClient(root);
    const first = await harness.invoke<{ id: string }>({ operation: 'create', title: 'Worker live', requirements: 'W1' });
    const second = await harness.invoke<{ id: string }>({ operation: 'create', title: 'Planner live', requirements: 'W1' });
    await harness.invoke({ operation: 'approve', id: first.id });
    const ready: Record<string, () => void> = {};
    const entered = ['worker', 'planner'].map(role => new Promise<void>(resolve => { ready[role] = resolve; }));
    const factory = async () => ({
      start: async () => {}, stop: async () => [],
      createSession: async (options: SessionConfig) => {
        const role = options.agent!.replace('sdlc-', '');
        let listener: (event: SessionEvent) => void = () => {};
        let release = () => {};
        const waiting = new Promise<void>(resolve => { release = resolve; });
        return { sessionId: `live-${role}`, on: (fn: typeof listener) => { listener = fn; return () => {}; },
          abort: async () => release(), disconnect: async () => {},
          sendAndWait: async () => {
            listener({ id: `message-${role}`, type: 'assistant.message_delta', data: { messageId: 'm', deltaContent: `${role}: sprawdzam projekt` } } as SessionEvent);
            listener({ id: `tool-${role}`, parentId: null, timestamp: new Date().toISOString(), type: 'tool.execution_start', data: { toolCallId: 't', toolName: 'view', arguments: { path: 'src/tasks.mjs' } } } as SessionEvent);
            listener({ id: `usage-${role}`, type: 'assistant.usage', data: { inputTokens: 123, outputTokens: 45, model: 'live-test' } } as SessionEvent);
            ready[role](); await waiting;
          },
        };
      },
    }) as unknown as CopilotClient;
    const registry = new ToolRegistry(path.resolve('resources'), () => 'python3', async () => {});
    runner = new CopilotTestRunner(registry, () => 'python3', { client: factory, permission: async () => ({ kind: 'reject' }), input: async () => undefined, log: () => {}, changed: () => {} });
    jobs.push(runner.run({ id: first.id, role: 'worker' }, { root }));
    jobs.push(runner.run({ id: second.id, role: 'planner' }, { root }));
    await Promise.race([Promise.all(entered), Promise.all(jobs).then(() => { throw new Error('SDK ended before events arrived'); })]);
    let sessions = await runner.sessions(root);
    assert.equal(sessions.length, 2);
    const worker = sessions.find(s => s.role === 'worker')!;
    assert.equal(worker.inputTokens, 123);
    assert.match(worker.entries.find(e => e.kind === 'message')!.text, /worker: sprawdzam/);
    assert.equal(worker.entries.find(e => e.kind === 'tool')!.status, 'running');
    assert.ok(runner.stop(root, worker.run));
    await jobs[0];
    sessions = await runner.sessions(root);
    assert.equal(sessions.find(s => s.role === 'worker')!.status, 'cancelled');
    assert.equal(sessions.find(s => s.role === 'planner')!.controllable, true);
    assert.equal(runner.activeCount, 1);
    runner.stop(root, sessions.find(s => s.role === 'planner')!.run);
    await jobs[1];
    assert.equal(runner.activeCount, 0);
  } finally { runner?.stop(); await Promise.allSettled(jobs); await rm(root, { recursive: true, force: true }); }
});

test('SDK entry points reject a role outside the current status before any run or model call', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-status-'));
  try {
    await initialize(root, path.resolve('resources'));
    const harness = new HarnessClient(root), item = await harness.invoke<{id:string}>({ operation:'create', title:'Status', requirements:'W1' });
    const registry = new ToolRegistry(path.resolve('resources'), () => 'python3', async () => {});
    const runner = new CopilotTestRunner(registry, () => 'python3', { client: async () => { throw new Error('Must not reach SDK'); }, permission: async () => ({kind:'reject'}), input: async () => undefined, log: () => {}, changed: () => {} });
    await assert.rejects(runner.run({ id:item.id, role:'judge' }, {root}), /is not available/);
    const state = await harness.snapshot(); assert.equal(state.runs.length, 0); assert.equal(state.metrics.length, 0);
  } finally { await rm(root, { recursive:true, force:true }); }
});

for (const cap of [null, 10] as const) {
  test(`planner with two SDK cost=6 events ${cap === null ? 'continues with the optional ceiling disabled' : 'reports the exact explicit ceiling and saves its partial report'}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-limit-'));
    try {
      await initialize(root, path.resolve('resources'));
      const harness = new HarnessClient(root), config = await harness.config();
      assert.equal(config.session.maxPremiumRequests, null, 'New projects do not inherit the two-call cutoff');
      config.session.maxPremiumRequests = cap;
      await writeFile(path.join(root, '.copilot-sdlc/config.json'), JSON.stringify(config));
      const item = await harness.invoke<{id:string}>({ operation:'create', title:'Planner budget', requirements:'W1' });
      const client = { start:async()=>{},stop:async()=>[],createSession:async (options:SessionConfig)=>{
        let listener:(event:SessionEvent)=>void=()=>{};
        return { sessionId:'budget',on:(fn:typeof listener)=>{listener=fn;return()=>{};},abort:async()=>{},disconnect:async()=>{},sendAndWait:async()=>{
          listener({id:'reply',type:'assistant.message',data:{content:'Przygotowany fragment planu.'}} as SessionEvent);
          for(const id of ['usage-a','usage-b']) listener({id,type:'assistant.usage',data:{inputTokens:6000,outputTokens:400,cost:6,model:'test'}} as SessionEvent);
          if (cap === null) {
            const tool=options.tools!.find(t=>t.name==='sdlc_update_task')!;
            await tool.handler!({operation:'create',title:'Zaplanowane zadanie',requirements:'W1: gotowe'}, {sessionId:'budget',toolCallId:'create',toolName:'sdlc_update_task',arguments:{}});
          }
        }};
      }} as unknown as CopilotClient;
      const registry = new ToolRegistry(path.resolve('resources'),()=> 'python3',async()=>{});
      const runner = new CopilotTestRunner(registry,()=> 'python3',{client:async()=>client,permission:async()=>({kind:'reject'}),input:async()=>undefined,log:()=>{},changed:()=>{}});
      const result = await runner.run({id:item.id,role:'planner'},{root}) as {outcome:string;reason?:string;run:string};
      const state=await harness.snapshot();
      assert.equal(result.outcome,cap===null?'completed':'limit');
      assert.equal(state.tasks.length,cap===null?2:1);
      assert.equal(state.metrics[0].premium_requests,'12');
      if(cap!==null){
        assert.match(result.reason!,/12 \/ 10/);
        const session=(await runner.sessions(root))[0];assert.match(session.stopReason!,/session.maxPremiumRequests/);
        const report=await readFile(path.join(root,`.work-item/reports/${result.run}.md`),'utf8');
        assert.match(report,/12 \/ 10/);assert.match(report,/Przygotowany fragment planu/);
        assert.equal((await new LiveSessions().list(root))[0].stopReason,session.stopReason);
      }
    } finally { await rm(root,{recursive:true,force:true}); }
  });
}

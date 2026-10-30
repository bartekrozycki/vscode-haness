import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecutorRegistry } from '../src/application/executors/registry';
import { selectExecutor, validateExecution } from '../src/domain/execution-policy';
import { SessionRunner } from '../src/application/sessions/runner';
import { TestToolRegistry as ToolRegistry, testRunner, testRunnerServices } from './support/services';
import { ModuleRegistry } from '../src/application/modules/registry';
import { TestProjectClient as HarnessClient, initialize } from './support/project';
import { FileSessionLog as LiveSessions } from '../src/infrastructure/sessions/file-session-log';
import type { AgentExecutor, ExecutorRequest, ExecutorSession } from '../src/contracts/executor';
import type { ProjectConfig } from '../src/contracts/model';

const adapter = (id: string, execute: (request: ExecutorRequest) => Promise<void> = async () => {}): AgentExecutor => ({
  apiVersion: 1, id, title: id,
  async createSession(request) { return { id: `session-${request.run}`, run: () => execute(request), abort: async () => {}, dispose: async () => {} }; },
});
async function project(run: (root: string, harness: HarnessClient, item: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-executor-'));
  try {
    await initialize(root, path.resolve('resources'));
    const harness = new HarnessClient(root), item = await harness.invoke<{id:string}>({operation:'create',title:'Neutral executor',requirements:'W1'});
    await run(root,harness,item.id);
  } finally { await rm(root,{recursive:true,force:true}); }
}
function environment() {
  const tools = new ToolRegistry(path.resolve('resources'), () => 'python3', async () => {}), executors = new ExecutorRegistry();
  const modules = new ModuleRegistry(tools, () => {}, executors);
  const runner = testRunner(tools, () => 'python3', { permission: async () => ({kind:'reject'}), input: async () => undefined, log: () => {}, changed: () => {} }, executors);
  return { tools, executors, modules, runner };
}
async function configure(root: string, harness: HarnessClient, execution: ProjectConfig['execution']) {
  const config = await harness.config(); config.execution=execution;
  await writeFile(path.join(root,'.copilot-sdlc/config.json'),JSON.stringify(config));
}

test('executor routing supports legacy fallback, project default, role, agent and explicit override', () => {
  const config: ProjectConfig = {version:1,models:{},gates:[],session:{timeoutSeconds:900,maxOutputTokens:60000},execution:{default:'acme.default',roles:{planner:'acme.plan'}}};
  const agent = {name:'sdlc-planner',description:'',prompt:'',executor:'acme.agent'};
  assert.equal(selectExecutor({} as ProjectConfig,'planner'),'copilot-sdk');
  assert.equal(selectExecutor(config,'worker'),'acme.default');
  assert.equal(selectExecutor(config,'planner'),'acme.plan');
  assert.equal(selectExecutor(config,'planner',agent),'acme.agent');
  assert.equal(selectExecutor(config,'planner',agent,'acme.explicit'),'acme.explicit');
  assert.equal(selectExecutor({...config,execution:{roles:{}}},'constructor'),'copilot-sdk');
  for(const execution of [{default:'../outside'}, {roles:{planner:12}}, {options:{'acme.local':null}}, {unknown:true}]) {
    assert.throws(()=>validateExecution({execution} as unknown as ProjectConfig),/execution/);
  }
});

test('registry preserves class adapters and stale disposal cannot unregister their replacement', async () => {
  class Stateful implements AgentExecutor {
    apiVersion=1 as const; get id(){return 'acme.stateful';} title='Stateful'; count=0;
    async createSession():Promise<ExecutorSession>{this.count++;return {id:'stateful',run:async()=>{},abort:async()=>{},dispose:async()=>{}};}
  }
  const executors=new ExecutorRegistry(), original=new Stateful(), first=executors.register(original);
  await executors.get(original.id).createSession({} as ExecutorRequest);assert.equal(original.count,1);
  first.dispose();const second=executors.register(adapter(original.id));first.dispose();assert.equal(executors.get(original.id).id,original.id);
  second.dispose();assert.throws(()=>executors.get(original.id),/Missing executor/);
});

test('module tools and executors roll back together on a registration collision', async () => {
  const {tools,executors,modules}=environment();executors.register(adapter('acme.existing'));
  assert.throws(()=>modules.register({apiVersion:1,id:'acme.module',title:'Module',version:'1',
    tools:[{definition:{name:'rollback_tool',displayName:'Rollback',description:'Test',readOnly:true,inputSchema:{type:'object'}},invoke:async()=>1}],
    executors:[adapter('acme.new'),adapter('acme.existing')],
  }),/Duplicate executor/);
  assert.deepEqual(modules.list(),[]);assert.deepEqual(executors.list().map(e=>e.id),['acme.existing']);
  await assert.rejects(tools.invoke('rollback_tool',{}, {root:os.tmpdir()}),/Unknown tool/);
});

test('a non-Copilot module executes with shared tools, transcript, usage, report and persistence', async () => project(async(root,harness,item)=>{
  const {runner,executors,modules}=environment();let disposed=0;
  modules.register({apiVersion:1,id:'acme.local',title:'Local',version:'1',executors:[{
    ...adapter('acme.local'),async createSession(request){
      assert.equal(request.item,item);assert.equal(request.permissions,'bypass');assert.equal(request.options.mode,'test');
      assert.ok(request.prompt.includes('W1'));assert.ok(request.agent.prompt.includes('Only the user'));
      assert.ok(!request.tools.some(t=>t.definition.name==='sdlc_run'));
      return {id:'local-session',abort:async()=>{},dispose:async()=>{disposed++;},run:async()=>{
        const metrics=request.tools.find(t=>t.definition.name==='sdlc_metrics')!;assert.ok(await metrics.invoke({}));
        await assert.rejects(request.tools.find(t=>t.definition.name==='sdlc_update_task')!.invoke({operation:'approve',id:item}),/human/);
        request.emit({type:'turn.start'});
        request.emit({type:'message.delta',messageId:'m',text:'Plan'});
        request.emit({type:'message',messageId:'m',text:'Plan kompletny.',model:'local-model'});
        request.emit({type:'tool.start',callId:'t',name:'local-check',input:{path:'src'}});
        request.emit({type:'tool.output',callId:'t',text:'checked\n'});
        request.emit({type:'tool.end',callId:'t',success:true,output:'OK'});
        const event={id:'usage',type:'usage' as const,inputTokens:40,outputTokens:10,costUsd:0.002,model:'local-model'};
        request.emit(event);request.emit(event);
      }};
    },
  }]});
  await configure(root,harness,{default:'acme.local',options:{'acme.local':{mode:'test'}}});
  const result=await runner.run({id:item,role:'planner'},{root}) as {executor:string;outcome:string;run:string};
  assert.equal(result.executor,'acme.local');assert.equal(result.outcome,'completed');assert.equal(disposed,1);
  assert.deepEqual(executors.list().map(e=>e.id),['acme.local'],'No Copilot adapter is registered');
  const metric=(await harness.snapshot()).metrics[0];assert.equal(metric.input_tokens,'40');assert.equal(metric.cost_usd,'0.002');assert.equal(metric.premium_requests,'');
  const live=(await runner.sessions(root))[0];assert.equal(live.executor,'acme.local');assert.equal(live.entries.filter(e=>e.kind==='message').length,1);
  assert.equal(live.entries.find(e=>e.kind==='message')!.text,'Plan kompletny.');assert.match(live.entries.find(e=>e.kind==='tool')!.text,/OK/);
  assert.equal((await new LiveSessions().list(root))[0].executor,'acme.local');
  const report=await readFile(path.join(root,`.work-item/reports/${result.run}.md`),'utf8');assert.equal(report.trim(),'Plan kompletny.');
}));

test('missing configured executor fails before run_start without falling back to Copilot', async () => project(async(root,harness,item)=>{
  const {runner,executors}=environment();let calls=0;executors.register(adapter('copilot-sdk',async()=>{calls++;}));
  await configure(root,harness,{default:'acme.not-installed'});
  const state=executors.annotate(await harness.agentSnapshot());assert.ok(state.agentActions![item].every(a=>!a.enabled));
  await assert.rejects(runner.run({id:item,role:'planner'},{root}),/Missing executor/);
  assert.equal(calls,0);assert.equal((await harness.snapshot()).runs.length,0);
}));

test('role and per-call executor selection use the configured adapter', async () => project(async(root,harness,item)=>{
  const {runner,executors}=environment(),called:string[]=[];
  for(const id of ['acme.default','acme.plan','acme.override'])executors.register(adapter(id,async()=>{called.push(id);}));
  await configure(root,harness,{default:'acme.default',roles:{planner:'acme.plan'}});
  await runner.run({id:item,role:'planner'},{root});
  await runner.run({id:item,role:'planner',executor:'acme.override'},{root});
  assert.deepEqual(called,['acme.plan','acme.override']);
}));

test('removing a module leaves its active session stoppable and removes future discovery', async () => project(async(root,harness,item)=>{
  const {runner,executors,modules}=environment();let release=()=>{},entered=()=>{},disposeCount=0;let request:ExecutorRequest|undefined;
  const running=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
  const handle=modules.register({apiVersion:1,id:'acme.module',title:'Module',version:'1',executors:[{
    ...adapter('acme.long'),async createSession(input){request=input;return{id:'long',run:async()=>{entered();await waiting;},abort:async()=>release(),dispose:async()=>{disposeCount++;}};},
  }]});
  await configure(root,harness,{default:'acme.long'});
  const job=runner.run({id:item,role:'planner'},{root});await running;
  handle.dispose();assert.equal(executors.list().length,0);
  const live=(await runner.sessions(root))[0];assert.equal(runner.stop(root,live.run),true);
  const result=await job as {outcome:string};assert.equal(result.outcome,'cancelled');assert.equal(disposeCount,1);assert.equal(request!.signal.aborted,true);
  await assert.rejects(request!.tools.find(t=>t.definition.name==='sdlc_tasks')!.invoke({operation:'list'}),/has ended/);
  assert.equal(runner.activeCount,0);
}));

test('provider errors and output limits keep the same lifecycle and cleanup', async () => project(async(root,harness,item)=>{
  const {runner,executors}=environment();let disposed=0;
  executors.register({...adapter('acme.error'),async createSession(){return{id:'failed',run:async()=>{throw new Error('Transport unavailable');},abort:async()=>{},dispose:async()=>{disposed++;}};}});
  await assert.rejects(runner.run({id:item,role:'planner',executor:'acme.error'},{root}),/Transport unavailable/);assert.equal(disposed,1);assert.equal(runner.activeCount,0);
  const config=await harness.config();config.session.maxOutputTokens=2;await writeFile(path.join(root,'.copilot-sdlc/config.json'),JSON.stringify(config));
  executors.register(adapter('acme.tokens',async request=>{request.emit({type:'message.delta',messageId:'partial',text:'Fragment'});request.emit({type:'usage',outputTokens:3});}));
  const result=await runner.run({id:item,role:'planner',executor:'acme.tokens'},{root}) as {outcome:string;reason:string;run:string};
  assert.equal(result.outcome,'limit');assert.match(result.reason,/3 \/ 2/);
  assert.match(await readFile(path.join(root,`.work-item/reports/${result.run}.md`),'utf8'),/Fragment/);
  assert.deepEqual((await harness.snapshot()).runs.map(r=>r.outcome),['failed','limit']);
}));

for(const permissions of ['bypass','ask'] as const){
  test(`non-Copilot executors use shared permission policy: ${permissions}`,async()=>project(async(root,harness,item)=>{
    const tools=new ToolRegistry(path.resolve('resources'),()=> 'python3',async()=>{}),executors=new ExecutorRegistry();let prompts=0;
    const runner=testRunner(tools,()=> 'python3',{permission:async()=>{prompts++;return{kind:'reject'};},input:async()=>undefined,log:()=>{},changed:()=>{}},executors);
    const config=await harness.config();config.session.permissions=permissions;await writeFile(path.join(root,'.copilot-sdlc/config.json'),JSON.stringify(config));
    executors.register(adapter('acme.permissions',async request=>{assert.equal((await request.requestPermission({kind:'shell',details:{command:'test'}})).kind,permissions==='bypass'?'approve-once':'reject');}));
    await runner.run({id:item,role:'planner',executor:'acme.permissions'},{root});assert.equal(prompts,permissions==='ask'?1:0);
  }));
}

test('different providers run concurrently and stopping one keeps the other active', async () => project(async(root,harness,item)=>{
  const {runner,executors}=environment(), releases:Record<string,()=>void>={},entered:Record<string,()=>void>={};
  const waiting=['worker','planner'].map(role=>new Promise<void>(resolve=>{entered[role]=resolve;}));
  for(const role of ['worker','planner'])executors.register({...adapter(`acme.${role}`),async createSession(request){
    const done=new Promise<void>(resolve=>{releases[role]=resolve;});
    return{id:role,run:async()=>{request.emit({type:'message.delta',messageId:'m',text:role});entered[role]();await done;},abort:async()=>releases[role](),dispose:async()=>{}};
  }});
  await harness.invoke({operation:'approve',id:item});
  const other=await harness.invoke<{id:string}>({operation:'create',title:'Parallel planner',requirements:'W1'});
  await configure(root,harness,{roles:{worker:'acme.worker',planner:'acme.planner'}});
  const jobs=[runner.run({id:item,role:'worker'},{root}),runner.run({id:other.id,role:'planner'},{root})];
  try{
    await Promise.all(waiting);
    const worker=(await runner.sessions(root)).find(s=>s.role==='worker')!;assert.equal(worker.executor,'acme.worker');
    assert.ok(runner.stop(root,worker.run));await jobs[0];assert.equal(runner.activeCount,1);
    assert.equal((await runner.sessions(root)).find(s=>s.role==='planner')!.controllable,true);
  }finally{runner.stop();await Promise.allSettled(jobs);}
  assert.equal(runner.activeCount,0);
}));

test('malformed executor events fail visibly and do not appear as user cancellation', async()=>project(async(root,harness,item)=>{
  const {runner,executors}=environment();
  executors.register(adapter('acme.invalid',async request=>request.emit({type:'unsupported'} as unknown as import('../src/contracts/executor').ExecutorEvent)));
  await assert.rejects(runner.run({id:item,role:'planner',executor:'acme.invalid'},{root}),/Unknown executor event/);
  assert.equal((await harness.snapshot()).runs[0].outcome,'failed');assert.equal(runner.activeCount,0);
}));

test('cancellation during executor creation releases task and executor resources', async()=>project(async(root,harness,item)=>{
  const {runner,executors}=environment();let ready=()=>{},cleaned=0;
  const starting=new Promise<void>(resolve=>{ready=resolve;});
  executors.register({...adapter('acme.starting'),async createSession(request){
    ready();try{await new Promise<void>((_,reject)=>request.signal.addEventListener('abort',()=>reject(new Error('Creation aborted')),{once:true}));}
    finally{cleaned++;}
    throw new Error('Unreachable');
  }});
  const job=runner.run({id:item,role:'planner',executor:'acme.starting'},{root});await starting;assert.ok(runner.stop(root));
  assert.equal((await job as {outcome:string}).outcome,'cancelled');assert.equal(cleaned,1);assert.equal(runner.activeCount,0);
  assert.ok((await harness.snapshot()).runs[0].finished);
}));

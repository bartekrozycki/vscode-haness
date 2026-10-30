import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRunner } from '../src/application/sessions/runner';
import { ExecutorRegistry } from '../src/application/executors/registry';
import type { ProjectAccess, ProjectGateway, SessionLog, ToolService } from '../src/application/ports';
import type { Snapshot, Operation } from '../src/contracts/model';

/** Runs the application using in-memory ports: no Python, files, VS Code or SDK. */
test('session orchestration accepts independent project and journal implementations', async () => {
  const calls: Operation[] = [], logCalls: string[] = [];
  const snapshot: Snapshot = { tasks: [{id:'WI-001',status:'ready',approved:'',blocked:'',dependencies:'',executor:''}],
    history:[],metrics:[],questions:[],lessons:[],runs:[],
    config:{version:1,models:{planner:'local'},gates:[],execution:{default:'test.local'},session:{timeoutSeconds:30,maxOutputTokens:100}} };
  const project: ProjectAccess = {
    initialized: async()=>true, config: async()=>snapshot.config, snapshot: async()=>snapshot,
    agents: async()=>[{name:'sdlc-planner',description:'Planner',prompt:'Plan the task.'}],
    async invoke<T>(request:Operation){calls.push(request);return (request.operation==='read'?{title:'Memory task',body:'W1: plan'}:{}) as T;},
  };
  const projects: ProjectGateway = {open:()=>project,initialize:async()=>({created:[],preserved:[]})};
  const log: SessionLog = {begin:()=>logCalls.push('begin'),connect:()=>logCalls.push('connect'),activity:()=>{},event:event=>{},finish:async()=>{logCalls.push('finish');},list:async()=>[]};
  const tools: ToolService = {definitions:async()=>[],invoke:async()=>{throw new Error('No tools');}};
  const executors = new ExecutorRegistry();
  executors.register({apiVersion:1,id:'test.local',title:'In-memory executor',createSession:async request=>({
    id:'memory-session',run:async()=>{request.emit({type:'message',messageId:'plan',text:'Prepared plan.'});request.emit({type:'usage',inputTokens:4,outputTokens:3});},abort:async()=>{},dispose:async()=>{},
  })});
  const runner = new SessionRunner({projects,tools,executors,live:log,sessionTools:definitions=>definitions,
    host:{permission:async()=>({kind:'reject'}),input:async()=>undefined,log:()=>{},changed:()=>{}}});
  const result = await runner.run({id:'WI-001',role:'planner'},{root:'/memory'}) as {outcome:string;executor:string};
  assert.equal(result.outcome,'completed');assert.equal(result.executor,'test.local');
  assert.deepEqual(calls.map(c=>c.operation),['run_start','read','run_finish']);
  assert.equal(calls.at(-1)!.report,'Prepared plan.');assert.equal(calls.at(-1)!.output_tokens,3);
  assert.deepEqual(logCalls,['begin','connect','finish']);assert.equal(runner.activeCount,0);
});

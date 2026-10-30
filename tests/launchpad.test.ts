import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,access } from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import { projectUsage } from '../src/application/queries/project-usage';
import type { Snapshot } from '../src/contracts/model';import type { LiveSession } from '../src/contracts/live';import type { StudioRecord } from '../src/contracts/studio';
import { createServices } from '../src/bootstrap/services';
import { TaskSuggestions } from '../src/application/launchpad/suggestions';
const snapshot={tasks:[],metrics:[{run:'work',input_tokens:'10',output_tokens:'3',cost_usd:'',premium_requests:'0',duration_ms:'1000'}],runs:[],history:[],questions:[],lessons:[],config:{}} as unknown as Snapshot;
test('observed usage merges live and durable research without duplicates and labels partial billing',()=>{
 const live=[{run:'research',inputTokens:99,outputTokens:8,started:'2026-01-01T00:00:00Z',finished:'2026-01-01T00:00:02Z',status:'completed'},{run:'active',inputTokens:7,outputTokens:2,started:'2026-01-01T00:00:00Z',finished:'',status:'running'}] as LiveSession[];
 const record={data:{run:'research',usage:{input_tokens:100,output_tokens:9,cost_usd:0,duration_ms:2000}}} as unknown as StudioRecord;
 const total=projectUsage(snapshot,[record,record],live,Date.parse('2026-01-01T00:00:03Z'));
 assert.equal(total.sessions,3);assert.equal(total.inputTokens,117);assert.equal(total.outputTokens,14);assert.equal(total.costUsd,0);assert.equal(total.costKnown,1);assert.equal(total.premiumKnown,1);assert.equal(total.active,1);assert.equal(total.durationMs,6000);
 assert.equal(projectUsage({...snapshot,metrics:[]},[],[]).costUsd,undefined);
});
test('skill suggestions create no files until explicit acceptance and never approve or run tasks',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'sdlc-launchpad-'));const packets:unknown[]=[];
 const services=createServices({resources:path.resolve('resources'),sdk:path.resolve('sdk'),python:()=> 'python3',publish:(_root,message)=>packets.push(message),host:{log:()=>{},changed:()=>{},input:async()=>undefined,permission:async()=>({kind:'reject'})}});
 try{
  const input={source:'skill: architecture review',suggestions:[{title:'Review payment contract',requirements:'W1: record the expected status and verification evidence.',estimate:5}]};
  const proposed=await services.tools.invoke('sdlc_suggest_tasks',input,{root}) as {suggestions:{id:string;title:string;requirements:string}[]};
  await assert.rejects(access(path.join(root,'.work-item')));
  const repeated=await services.tools.invoke('sdlc_suggest_tasks',input,{root}) as typeof proposed;assert.equal(repeated.suggestions[0].id,proposed.suggestions[0].id);
  await assert.rejects(services.suggestions!.create(root,proposed.suggestions),/Initialize/);
  await services.projects.initialize(root);
  const accepted=await services.suggestions!.create(root,[{...proposed.suggestions[0],title:'Edited title'}]);
  assert.equal(accepted.length,1);const state=await services.snapshot(root);assert.equal(state.tasks[0].title,'Edited title');assert.equal(state.tasks[0].approved,'');assert.equal(state.runs.length,0);assert.ok(packets.length>=2);
 }finally{services.dispose();await rm(root,{recursive:true,force:true});}
});

test('acceptance retains newer suggestions and records the source of accepted drafts', async () => {
 let release!: () => void, entered!: () => void;
 const barrier = new Promise<void>(resolve => { release = resolve; });
 const inside = new Promise<void>(resolve => { entered = resolve; });
 const packets: Record<string, unknown>[] = [], created: Record<string, unknown>[] = [];
 const projects = { open: () => ({ initialized: async () => true, snapshot: async () => ({ tasks: [] }), invoke: async (input: Record<string, unknown>) => { created.push(input); return { id: 'WI-001' }; } }) };
 const store = { mutate: async (_root: string, work: () => Promise<unknown>) => { entered(); await barrier; return work(); } };
 const suggestions = new TaskSuggestions(projects as never, store as never, (_root, packet) => packets.push(packet));
 const first = suggestions.propose('/project', 'Architecture review', [{ title: 'A', requirements: 'Check A' }]);
 const accepting = suggestions.create('/project', first.suggestions);
 await inside;
 const second = suggestions.propose('/project', 'Security review', [{ title: 'B', requirements: 'Check B' }]);
 release(); await accepting;
 assert.deepEqual(suggestions.current('/project'), { source: 'Security review', suggestions: second.suggestions });
 assert.deepEqual(packets.at(-1), { type: 'taskSuggestions', source: 'Security review', suggestions: second.suggestions });
 assert.match(String(created[0].requirements), /Suggestion source: Architecture review/);
});

test('legacy attempts remain counted and interrupted duration freezes at last observation',()=>{
 const state={...snapshot,metrics:[],runs:[{id:'legacy',started:'2026-01-01T00:00:00Z',finished:'',outcome:'running'}]};
 const interrupted={run:'crashed-research',started:'2026-01-01T00:00:00Z',updated:'2026-01-01T00:01:00Z',finished:'',status:'interrupted',inputTokens:12,outputTokens:3} as LiveSession;
 const result=projectUsage(state,[],[interrupted],Date.parse('2026-01-02T00:00:00Z'));
 assert.equal(result.sessions,2);assert.equal(result.active,0);assert.equal(result.durationMs,60000);assert.equal(result.costUsd,undefined);
});


test('history placeholders do not fabricate external liveness or growing usage',async()=>{
 const {withRunHistory}=await import('../src/application/queries/run-history.js');
 const state={...snapshot,metrics:[],runs:[{id:'old-attempt',item:'WI-001',role:'worker',started:'2026-01-01T00:00:00Z',finished:'',outcome:'running'}]};
 const history=withRunHistory([],state);
 assert.equal(history[0].status,'interrupted');
 const summary=projectUsage(state,[],history,Date.parse('2026-02-01T00:00:00Z'));
 assert.equal(summary.active,0);assert.equal(summary.durationMs,0);assert.equal(summary.sessions,1);
});

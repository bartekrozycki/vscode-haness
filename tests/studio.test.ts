import { toolMutates } from '../src/application/tools/confirmation';
import { catalog } from '../src/bootstrap/catalog';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServices } from '../src/bootstrap/services';
import { FileStudioStore } from '../src/infrastructure/studio/store';
import { StudioNotebook } from '../src/application/studio/notebook';
import { PythonProjectGateway } from '../src/infrastructure/project/gateway';
import type { ExecutorRequest, AgentExecutor } from '../src/contracts/executor';

async function environment(run:(root:string,services:ReturnType<typeof createServices>)=>Promise<void>){
 const root=await mkdtemp(path.join(os.tmpdir(),'sdlc-studio-'));
 const services=createServices({resources:path.resolve('resources'),sdk:path.resolve('sdk'),python:()=> 'python3',host:{log:()=>{},changed:()=>{},input:async()=>undefined,permission:async()=>({kind:'reject'})}});
 try{await run(root,services);}finally{services.dispose();await rm(root,{recursive:true,force:true});}
}
const invoke=(services:ReturnType<typeof createServices>,root:string,name:string,input:Record<string,unknown>,approve=async()=>true)=>services.tools.invoke(name,input,{root,approve}) as Promise<any>;
async function waitFor<T>(read:()=>Promise<T>,done:(value:T)=>boolean){const deadline=Date.now()+30000;let result: T | undefined;while(Date.now()<deadline){result=await read();if(done(result))return result;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(`Timed out waiting for research: ${JSON.stringify(result)}`);}
const local=(execute:(request:ExecutorRequest)=>Promise<void>):AgentExecutor=>({apiVersion:1,id:'test.research',title:'Local research',createSession:async request=>({id:request.run,run:()=>execute(request),abort:async()=>{},dispose:async()=>{}})});

test('studio reads create no files; concurrent writers preserve revisions and real TSV quoting',async()=>environment(async(root,services)=>{
 assert.deepEqual(await invoke(services,root,'sdlc_studio',{operation:'list'}),[]);
 await assert.rejects(access(path.join(root,'.work-item')));
 const notebook=new StudioNotebook(new FileStudioStore(),new PythonProjectGateway(path.resolve('resources'),()=> 'python3'));
 const other=new StudioNotebook(new FileStudioStore(),new PythonProjectGateway(path.resolve('resources'),()=> 'python3'));
 const records=await Promise.all([notebook.write(root,'initiative',{title:'One "quoted"',body:'first\nsecond',data:{question:'tab\tnewline\n'}}),other.write(root,'initiative',{title:'Two'})]);
 assert.equal(new Set(records.map(r=>r.id)).size,2);
 const first=await notebook.get(root,records[0].id);assert.equal(first.estimate,undefined);assert.equal(first.body,'first\nsecond');assert.equal(first.data.question,'tab\tnewline\n');
 const updated=await notebook.write(root,'initiative',{id:first.id,revision:1,body:'revision two',estimate:8});
 assert.equal(updated.revision,2);await assert.rejects(notebook.write(root,'initiative',{id:first.id,revision:1,body:'stale'}),/Revision conflict/);
 assert.equal(await readFile(path.join(root,first.file),'utf8'),'first\nsecond');
 const tsv=await readFile(path.join(root,'.work-item/studio/records.tsv'),'utf8');assert.match(tsv,/One ""quoted""/);
}));

test('accepted specifications, decomposition and idempotent promotion preserve separate implementation approval',async()=>environment(async(root,services)=>{
 await services.projects.initialize(root);
 const ini=await invoke(services,root,'sdlc_initiatives',{operation:'create',title:'Checkout',estimate:21});
 const spec=await invoke(services,root,'sdlc_specs',{operation:'create',parent:ini.id,title:'Checkout rules',body:'W1: successful payment is shown',status:'draft'});
 await assert.rejects(invoke(services,root,'sdlc_specs',{operation:'revise',id:spec.id,revision:1,status:'accepted'},async()=>false),/Human acceptance/);
 await invoke(services,root,'sdlc_specs',{operation:'revise',id:spec.id,revision:1,status:'accepted'});
 const fields={parent:ini.id,title:'Payment confirmation',body:'W1: render a confirmed payment; verify with a unit test.',data:{specification:spec.id},status:'ready'};
 await assert.rejects(invoke(services,root,'sdlc_backlog',{operation:'create',...fields,estimate:21}),/<=13/);
 const proposal=await invoke(services,root,'sdlc_backlog',{operation:'create',...fields,estimate:5});
 const created=await invoke(services,root,'sdlc_backlog',{operation:'promote',id:proposal.id,revision:1});
 const repeated=await invoke(services,root,'sdlc_backlog',{operation:'promote',id:proposal.id,revision:1});
 assert.equal(created.id,repeated.id);const snapshot=await services.snapshot(root);assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.tasks[0].approved,'');assert.equal(snapshot.tasks[0].estimate,'5');
 const document=await services.projects.open(root).invoke<{body:string}>({operation:'read',id:created.id});assert.match(document.body,/Specification: SPEC-001 revision 2/);
 await assert.rejects(services.tools.invoke('sdlc_initiatives',{operation:'create',title:'Unauthorized'},{root,role:'specify'}),/master/);
}));

test('small initiatives run a master-selected parallel team, expose live sessions and save reports without work items',async()=>environment(async(root,services)=>{
 await services.projects.initialize(root);
 const requests:ExecutorRequest[]=[];let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 services.modules.register({apiVersion:1,id:'test.research',title:'Test',version:'1',executors:[local(async request=>{
  requests.push(request);request.emit({type:'message.delta',messageId:'m',text:'Evidence'});request.emit({type:'usage',inputTokens:10,outputTokens:2});await barrier;
  const taskTool=request.tools.find(t=>t.definition.name==='sdlc_tasks')!;
  await assert.rejects(taskTool.invoke({operation:'gates',id:'WI-001'}),/cannot mutate/);
  assert.ok(!request.agent.tools!.includes('edit'));assert.equal((await request.requestPermission({kind:'write'})).kind,'reject');
  request.emit({type:'message',messageId:'m',text:'Verified src/example.ts:1; question for master.'});
 })]});
 const ini=await invoke(services,root,'sdlc_initiatives',{operation:'create',title:'Small initiative',estimate:8,body:'Quick estimate: existing component; uncertain data contract.'});
 const started=await invoke(services,root,'sdlc_research',{operation:'start',initiative:ini.id,plan:'Two focused slices: UI and data.',maxParallel:2,members:[{role:'specify',purpose:'research',focus:'UI',executor:'test.research'},{role:'specify',purpose:'research',focus:'Data',executor:'test.research'}]});
 await waitFor(async()=>requests.length,n=>n===2);
 const live=await invoke(services,root,'sdlc_research',{operation:'status',id:started.team});assert.equal(live[0].sessions.length,2);assert.equal(live[0].controllable,true);
 release();const result=await waitFor(()=>invoke(services,root,'sdlc_research',{operation:'status',id:started.team}),v=>['completed','failed','cancelled','interrupted'].includes(v[0].status));
 assert.equal(result[0].status,'completed',`Research failed: ${JSON.stringify(result[0])}`);assert.equal(result[0].artifacts.length,2);assert.equal(result[0].data.tokens,24);assert.match(result[0].artifacts[0].body,/Verified/);assert.equal((await services.snapshot(root)).tasks.length,0);
}));

test('large initiatives require decomposition; prototypes are versioned HTML artifacts and cancellation stops queued work',async()=>environment(async(root,services)=>{
 await services.projects.initialize(root);let started=0;
 services.modules.register({apiVersion:1,id:'test.research',title:'Test',version:'1',executors:[local(async request=>{
  started++;if(request.role==='prototype'){request.emit({type:'message',messageId:'p',text:'```html\n<!doctype html><html><body>Prototype</body></html>\n```'});return;}
  await new Promise<void>(resolve=>request.signal.addEventListener('abort',()=>resolve(),{once:true}));
 })]});
 const ini=await invoke(services,root,'sdlc_initiatives',{operation:'create',title:'Large idea',estimate:21});
 const member={role:'prototype',purpose:'prototype',focus:'Screen prototype',executor:'test.research'};
 await assert.rejects(invoke(services,root,'sdlc_research',{operation:'start',initiative:ini.id,plan:'Missing decomposition',members:[member]}),/decomposition/);
 const team=await invoke(services,root,'sdlc_research',{operation:'start',initiative:ini.id,plan:'Prototype then decompose',maxParallel:1,members:[member,{role:'design',purpose:'decomposition',focus:'Independent child outcomes',executor:'test.research'},{role:'specify',purpose:'research',focus:'Queued',executor:'test.research'}]});
 const partial=await waitFor(()=>invoke(services,root,'sdlc_research',{operation:'status',id:team.team}),v=>v[0].artifacts.length===1);
 const prototype=partial[0].artifacts[0];assert.equal(prototype.kind,'prototype');assert.ok(prototype.file.endsWith('.html'));assert.match(await readFile(path.join(root,prototype.file),'utf8'),/^<!doctype html>/);
 await waitFor(async()=>started,n=>n===2);await invoke(services,root,'sdlc_research',{operation:'stop',id:team.team});
 const stopped=await waitFor(()=>invoke(services,root,'sdlc_research',{operation:'status',id:team.team}),v=>v[0].status==='cancelled');assert.equal(started,2);assert.equal(stopped[0].artifacts.length,2);
}));

test('editing an accepted specification invalidates acceptance and prevents stale promotion',async()=>environment(async(root,services)=>{
 await services.projects.initialize(root);
 const ini=await invoke(services,root,'sdlc_initiatives',{operation:'create',title:'Versioned scope',estimate:3});
 const spec=await invoke(services,root,'sdlc_specs',{operation:'create',parent:ini.id,title:'Spec',body:'W1: original behavior',status:'accepted'});
 const proposal=await invoke(services,root,'sdlc_backlog',{operation:'create',parent:ini.id,title:'Implement',body:'Verify W1',estimate:3,status:'ready',data:{specification:spec.id}});
 const changed=await invoke(services,root,'sdlc_specs',{operation:'revise',id:spec.id,revision:1,body:'W1: changed behavior'});
 assert.equal(changed.status,'review');await assert.rejects(invoke(services,root,'sdlc_backlog',{operation:'promote',id:proposal.id,revision:1}),/Specification changed/);
 assert.equal((await services.snapshot(root)).tasks.length,0);
}));

test('restart exposes an interrupted team and its durable run IDs without launching sessions',async()=>environment(async(root,services)=>{
 const notebook=new StudioNotebook(new FileStudioStore(),new PythonProjectGateway(path.resolve('resources'),()=> 'python3'));
 const ini=await notebook.write(root,'initiative',{title:'Recovery',estimate:5});
 const team=await notebook.write(root,'research',{parent:ini.id,title:'Previous team',status:'running',data:{runs:['saved-run']}});
 const result=await invoke(services,root,'sdlc_research',{operation:'status',id:team.id});
 assert.equal(result[0].status,'interrupted');assert.equal(result[0].controllable,false);assert.deepEqual(result[0].data.runs,['saved-run']);
 assert.equal((await notebook.get(root,team.id)).status,'running','Reading does not rewrite evidence or auto-resume');
}));

test('decomposition retains parent links and resolves proposal dependencies into WI dependencies',async()=>environment(async(root,services)=>{
 await services.projects.initialize(root);
 const ini=await invoke(services,root,'sdlc_initiatives',{operation:'create',title:'Decompose',estimate:21});
 const spec=await invoke(services,root,'sdlc_specs',{operation:'create',parent:ini.id,title:'Spec',body:'W1: independent deliverables',status:'accepted'});
 const parent=await invoke(services,root,'sdlc_backlog',{operation:'create',parent:ini.id,title:'Large scope',estimate:21});
 const fields={operation:'create',parent:ini.id,estimate:5,status:'ready',body:'W1: independently verifiable',data:{specification:spec.id,parentProposal:parent.id}};
 const first=await invoke(services,root,'sdlc_backlog',{...fields,title:'First'});
 const second=await invoke(services,root,'sdlc_backlog',{...fields,title:'Second',data:{...fields.data,dependsOnProposals:[first.id]}});
 await assert.rejects(invoke(services,root,'sdlc_backlog',{operation:'promote',id:second.id,revision:1}),/prerequisite/);
 const one=await invoke(services,root,'sdlc_backlog',{operation:'promote',id:first.id,revision:1});
 const two=await invoke(services,root,'sdlc_backlog',{operation:'promote',id:second.id,revision:1});
 assert.equal((await services.snapshot(root)).tasks.find(t=>t.id===two.id)!.dependencies,one.id);
}));

test('research polling needs no mutation confirmation while start/stop and gates do',async()=>{
 const research=catalog.find(t=>t.name==='sdlc_research')!, tasks=catalog.find(t=>t.name==='sdlc_tasks')!;
 assert.equal(toolMutates(research,{operation:'status'}),false);
 assert.equal(toolMutates(research,{operation:'start'}),true);assert.equal(toolMutates(research,{operation:'stop'}),true);
 assert.equal(toolMutates(tasks,{operation:'gates'}),true);assert.equal(toolMutates(tasks,{operation:'read'}),false);
});

// Local visual QA harness; no SDK, project writes, or external assets.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { buildWebview } from './build-webview.mjs';
import { createServer } from 'node:http';
await buildWebview();
const script = await readFile('dist/webview.js', 'utf8');
await mkdir('out', { recursive: true });
await build({ entryPoints: ['src/ui/webview/shell.ts'], outfile: 'out/workbench-preview.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { dashboardHtml } = createRequire(import.meta.url)('../out/workbench-preview.cjs');
const tasks = [
  { id: 'WI-001', title: 'Extensible modules and public API', priority: 'MUST', area: 'Platform', status: 'active', executor: 'sdk-worker', approved: 'user' },
  { id: 'WI-002', title: 'Simplify the workbench', priority: 'MUST', area: 'Interface', status: 'review', approved: 'user' },
  { id: 'WI-003', title: 'Export session metrics to TSV', priority: 'SHOULD', area: 'Metrics', status: 'accepted', approved: 'user' },
  { id: 'WI-004', title: 'Example quality module', priority: 'SHOULD', area: 'Extensions', status: 'ready', approved: '' },
];
await build({ entryPoints: ['src/domain/agent-policy.ts'], outfile: 'out/preview-policy.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { withAgentActions } = createRequire(import.meta.url)('../out/preview-policy.cjs');
const snapshot = withAgentActions({ tasks, history: [], metrics: [], questions: [], lessons: [], runs: [], config: {} }, ['planner','worker','judge'].map(role => ({ name: 'sdlc-'+role, description: role, prompt: '' })));
const session = (run, item, role) => ({ run, item, role, model: 'Copilot · demo', permissions: 'bypass', session: 'preview-'+run, started: new Date(Date.now()-85000).toISOString(), finished: '', updated: new Date().toISOString(), activity: 'Checking module contracts', status: 'running', inputTokens: 12480, outputTokens: 1840, cacheReadTokens: 500, turns: 3, toolCalls: 2, entriesLoaded: true, controllable: true, entries: [
  { id: 'message-'+run, kind: 'message', timestamp: new Date().toISOString(), title: 'Agent', text: 'The module registry is ready. Adding a tool and task widget through the public API, then checking the companion VSIX.' },
  { id: 'tool-'+run, kind: 'tool', timestamp: new Date().toISOString(), title: 'bash', status: 'running', arguments: '{ "command": "npm run check && npm test" }', text: '✓ API v1 contract\n✓ Module registration and disposal\n✓ Shared workbench' },
] });
const sessions = [session('worker', 'WI-001', 'worker'), session('planner', 'WI-002', 'planner')];
const contributions = { modules: [
  { id: 'core.workflow', title: 'Work items', version: '1.0.0', description: 'Tasks and history in the project.', tools: [] },
  { id: 'core.metrics', title: 'Metrics SDK', version: '1.0.0', description: 'Session tokens and duration.', tools: [] },
  { id: 'example.quality', title: 'Quality', version: '0.1.0', description: 'Standalone companion VSIX.', tools: ['example_quality_summary'] },
], widgets: [
  { id: 'core.metrics/usage', module: 'core.metrics', title: 'Project usage', placement: 'workspace', content: { kind: 'metrics', values: [{label:'Sessions',value:6},{label:'Input tokens',value:'48 360'},{label:'Output tokens',value:'8 240'},{label:'Duration',value:'12.4 min'}] } },
  { id: 'core.backlog/backlog', module: 'core.backlog', title: 'Planning and research', placement: 'workspace', content: {kind:'table',columns:['ID','Type','Name','State','Estimate'],rows:[{ID:'IN-001',Type:'initiative',Name:'Improve the workbench',State:'draft',Estimate:'5'}]} },
  { id: 'example.quality/readiness', module: 'example.quality', title: 'Task readiness', placement: 'task', content: {kind:'text',text:'Custom section from a companion module. Implementation has been approved.'} },
], actions: [{id:'example.quality/report',module:'example.quality',title:'Readiness report',scope:'task'}] };
const bootstrap = `
let previewSaved={},previewItem='WI-001',previewVersion=0,previewRun=0;
const previewNew=location.search.includes('new'); let previewDismissed=false;
const previewLive=${JSON.stringify(sessions)},previewContributions=${JSON.stringify(contributions)};
let previewConnections=[{id:'jira-example',provider:'jira',baseUrl:'https://jira.example.test',auth:'token',credentialPresent:true},{id:'github-example',provider:'github',baseUrl:'https://github.example.test',auth:'token',credentialPresent:false}];
let previewMonitors=[{definition:{id:'issues',name:'Ready issues',provider:'jira',connectionId:'jira-example',intervalSeconds:300,query:{jql:'project = EX',label:'ready'}},active:true,baseline:true,lastPoll:'2026-10-30T10:30:00.000Z',pollCount:24,errorCount:1,lastDurationMs:320},{definition:{id:'reviews',name:'Pull request discussion',provider:'github',connectionId:'github-example',intervalSeconds:600,query:{owner:'example',repo:'sample',pullRequestId:42}},active:false,baseline:true,lastPoll:'2026-10-30T09:00:00.000Z',pollCount:8,errorCount:1,lastDurationMs:180,error:'Credentials required'}];
let previewEvents=[{id:'event-1',monitorId:'issues',receivedAt:'2026-10-30T10:30:00.000Z',observation:{id:'EX-12',version:'2',kind:'issue',title:'Clarify search behavior',labels:['ready']},trigger:{action:'refine'}}];
let previewWorkflow=[{id:'request-1',kind:'refine',state:'pending',title:'Refine EX-12',detail:'Review acceptance criteria',connectionId:'jira-example',remoteId:'EX-12',estimate:5}];
let previewEnvironment={tools:['git','node','java','python'].map(tool=>({tool,configuredPath:'',executable:'/usr/bin/'+tool,version:tool+' 1.0'})),credentials:[{name:'githubToken',configured:true},{name:'openaiApiKey',configured:false}]};
function previewSend(message){if(message.live && message.liveVersion===undefined)message.liveVersion=++previewVersion;window.dispatchEvent(new MessageEvent('message',{data:message}));}
function acquireVsCodeApi(){return {getState:()=>previewSaved,setState:s=>previewSaved=s,postMessage:message=>setTimeout(()=>{
 if(message.action==='ready'){previewSend({type:'snapshot',snapshot:previewNew?null:${JSON.stringify(snapshot)},live:previewNew?[]:previewLive,project:'UI preview · sample data'});if(!previewNew)previewSend({type:'contributions',contributions:previewContributions,item:previewItem});}
 if(message.action==='onboardingRead'||message.action==='onboardingDismiss'||message.action==='onboardingShow'){if(message.action!=='onboardingRead')previewDismissed=message.action==='onboardingDismiss';previewSend({type:'onboardingPreference',dismissed:previewDismissed});}
 if(message.action==='initialize')previewSend({type:'snapshot',snapshot:{...${JSON.stringify(snapshot)},tasks:[]},live:[],project:'UI preview · new project'});
 if(message.action==='openStudioRecord')previewSend({type:'studioRecord',record:{id:message.id,title:'Improve the workbench',kind:'initiative',status:'draft',estimate:5,body:'Explore a calmer workbench for project teams.',file:'sample.md'}});
 if(message.action==='monitorRead')previewSend({type:'monitors',monitors:previewMonitors,events:previewEvents});
 if(message.action==='monitorAction'){const m=previewMonitors.find(x=>x.definition.id===message.id);if(m){if(message.operation==='activate')m.active=true;if(message.operation==='pause')m.active=false;if(message.operation==='poll'){m.lastPoll=new Date().toISOString();m.pollCount++;m.lastDurationMs=245;delete m.error;}}previewSend({type:'monitors',monitors:previewMonitors,events:previewEvents});}
 if(message.action==='connectionRead')previewSend({type:'connections',connections:previewConnections});
 if(message.action==='connectionSave'){previewConnections.push({...message.metadata,credentialPresent:false});previewSend({type:'connections',connections:previewConnections});}
 if(message.action==='connectionCredential'){const c=previewConnections.find(x=>x.id===message.id);if(c)c.credentialPresent=true;previewSend({type:'connections',connections:previewConnections});}
 if(message.action==='connectionRemove'){previewConnections=previewConnections.filter(x=>x.id!==message.id);previewSend({type:'connections',connections:previewConnections});}
 if(message.action==='automationRead')previewSend({type:'automation',workflowActions:previewWorkflow});
 if(message.action==='automationApprove'||message.action==='automationDismiss'){const a=previewWorkflow.find(x=>x.id===message.id);if(a)a.state=message.action==='automationApprove'?'approved':'dismissed';previewSend({type:'automation',workflowActions:previewWorkflow});}
 if(message.action==='environmentRead')previewSend({type:'environment',environment:previewEnvironment});
 if(message.action==='environmentSave'){previewEnvironment.tools.forEach(t=>t.configuredPath=message.paths[t.tool]);previewSend({type:'environment',environment:previewEnvironment});}
 if(message.action==='credentialSet'||message.action==='credentialDelete'){previewEnvironment.credentials.find(c=>c.name===message.name).configured=message.action==='credentialSet';previewSend({type:'environment',environment:previewEnvironment});}
 if(message.action==='suggestTasks')previewSend({type:'taskSuggestions',source:'Starter templates',suggestions:[{title:'Document the project goals',requirements:'Describe the intended outcome and acceptance criteria.'},{title:'Set up a quality gate',requirements:'Identify checks that should run before review.'}]});
 if(message.action==='createSuggestedTasks' && location.search.includes('error'))previewSend({type:'taskSuggestions',error:'Could not create drafts. Try again.'});
 else if(message.action==='createSuggestedTasks'){previewSend({type:'snapshot',snapshot:${JSON.stringify(snapshot)},live:previewLive,project:'UI preview · sample data'});previewSend({type:'taskSuggestions',suggestions:[],source:'created'});}
 if(message.action==='selectTask'){previewItem=message.id;previewSend({type:'contributions',contributions:previewContributions,item:previewItem});}
 if(message.action==='selectSession')previewSend({type:'live',live:previewLive});
 if(message.action==='run'){
  const previous=previewLive.find(s=>s.item===message.id),now=new Date().toISOString();
  previewLive.filter(s=>s.item===message.id).forEach(s=>{s.finished=now;s.status='completed';s.controllable=false;});
  const s={...previous,run:'new-'+(++previewRun),item:message.id,role:message.role,started:now,finished:'',activity:'Starting executor',status:'starting',controllable:true,entries:[]};previewLive.unshift(s);
  previewSend({type:'live',live:previewLive,selection:{item:s.item,run:s.run}});
  setTimeout(()=>{s.status='running';s.activity='Agent responding';s.entries=[{id:'reply',kind:'message',timestamp:now,title:'Agent response',text:'New session: the stream updates automatically.'}];previewSend({type:'live',live:previewLive});},500);
  setTimeout(()=>{
   const outdated=structuredClone(previewLive),oldVersion=previewVersion;
   s.finished=new Date().toISOString();s.status='completed';s.controllable=false;s.activity='Session completed';s.entries[0].text='Done. The new session result is visible without manually refreshing.';
   previewSend({type:'live',live:previewLive});
   previewSend({type:'live',live:outdated,liveVersion:oldVersion});
  },5000);
 }
 if(message.action==='stopSession'){const s=previewLive.find(s=>s.run===message.run);s.finished=new Date().toISOString();s.status='cancelled';s.activity='Cancelled';s.controllable=false;previewSend({type:'live',live:previewLive});}
 if(message.action==='moduleAction')previewSend({type:'contributions',contributions:{...previewContributions,widgets:previewContributions.widgets.map(w=>w.placement==='task'?{...w,content:{kind:'text',text:'Module action completed for '+previewItem}}:w)},item:previewItem});
},0)}}
`;
const html = dashboardHtml({ cspSource: "'self'", snapshot: undefined, live: [], script }).replace(/(<script nonce="[^"]+">)/, '$1'+bootstrap);
createServer((req,res) => {res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});res.end(html);}).listen(Number(process.env.SDLC_PREVIEW_PORT || 18742),'127.0.0.1',()=>process.stdout.write('Preview ready\n'));

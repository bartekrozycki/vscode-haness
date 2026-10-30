import { matchesGrantedTrigger } from '../src/application/monitors/authorization';
import type { AutomationRequest } from '../src/contracts/automation';
import type { MonitorTrigger } from '../src/contracts/monitors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorAuthority } from '../src/host/vscode/monitor-authority';
import type { MonitorDefinition } from '../src/contracts/monitors';
import type { ConnectionService } from '../src/contracts/connections';

test('automatic monitor grants bind the reviewed definition and connection destination', async () => {
    const values = new Map<string,string>(); let origin = 'https://jira.example.test', reviews = 0;
    const connections = { list: async () => [{id:'jira',provider:'jira',baseUrl:origin,auth:'token',credentialPresent:true}] } as ConnectionService;
    const authority = createMonitorAuthority({connections,get:key=>values.get(key),set:async(key,value)=>{values.set(key,value);},review:async(_root,_definition,connection)=>{assert.equal(connection.baseUrl,origin);reviews++;return true;}});
    const definition: MonitorDefinition = {id:'build',name:'Build',provider:'jira',connectionId:'jira',query:{jql:'labels = hanes-implement',label:'hanes-implement'},intervalSeconds:60,action:{kind:'implement',taskId:'WI-001',armed:true}};
    assert.equal(await authority.allows('/project',definition),false,'Workspace armed bit does not grant authority');
    assert.equal(await authority.authorize('/project',definition),true);
    assert.equal(await authority.allows('/project',definition),true);
    assert.equal(await authority.allows('/other-project',definition),false);
    assert.equal(await authority.allows('/project',{...definition,action:{...definition.action!,taskId:'WI-002'}}),false);
    origin='https://other.example.test'; assert.equal(await authority.allows('/project',definition),false);
    assert.equal(reviews,1);
});

test('declined native monitor review cannot arm workflows', async () => {
    const authority = createMonitorAuthority({connections:{list:async()=>[{id:'jira',provider:'jira',baseUrl:'https://jira.example.test',auth:'token'}]} as ConnectionService,get:()=>undefined,set:async()=>{throw new Error('must not persist');},review:async()=>false});
    const definition: MonitorDefinition={id:'a',name:'a',provider:'jira',connectionId:'jira',query:{jql:'project = EX'},intervalSeconds:60,action:{kind:'refine',researchFocus:'Scope',estimate:8,armed:true}};
    assert.equal(await authority.authorize('/project',definition),false);
    assert.equal(await authority.allows('/project',definition),false);
});

test('an existing queue row cannot borrow a grant for another task, payload or budget', () => {
    const definition: MonitorDefinition = {id:'a',name:'a',provider:'jira',connectionId:'jira',query:{jql:'project = EX'},intervalSeconds:60,action:{kind:'implement',taskId:'WI-001',armed:true}};
    const trigger: MonitorTrigger = {eventId:'event',monitorId:'a',action:'implement',connectionId:'jira',remoteId:'EX-1',remoteText:'facts',taskId:'WI-001',armed:true};
    const request: AutomationRequest = {id:'r',kind:'implement',status:'pending',createdAt:'now',updatedAt:'now',trigger};
    assert.equal(matchesGrantedTrigger(request,trigger,definition),true);
    assert.equal(matchesGrantedTrigger({...request,trigger:{...trigger,taskId:'WI-002'}},trigger,definition),false);
    assert.equal(matchesGrantedTrigger({...request,kind:'publish'},trigger,definition),false);
    assert.equal(matchesGrantedTrigger(request,trigger,{...definition,action:{...definition.action!,maxTokens:1000}}),false);
    assert.equal(matchesGrantedTrigger(request,trigger,{...definition,connectionId:'other'}),false);
});

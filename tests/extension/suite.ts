import { catalog } from '../../src/bootstrap/catalog';
import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { HarnessClient } from '../../src/infrastructure/project/client';
import type { SdlcApi } from '../../src/contracts/api';

export async function run() {
  const extension = vscode.extensions.getExtension<SdlcApi>('project-sdlc.copilot-sdk-sdlc');
  assert.ok(extension, 'Extension is installed in development host');
  const api = await extension.activate();
  assert.equal(api.version, 1);
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  await assert.rejects(access(path.join(folder, '.copilot-sdlc/config.json')), 'Activation must not initialize');
  const tools = vscode.lm.tools.filter(t => t.name.startsWith('sdlc_'));
  assert.equal(tools.length, catalog.length, 'All Copilot tools are registered');
  const taxonomy = await api.invokeTool(folder, 'sdlc_studio', { operation: 'taxonomy' }) as {objects:unknown};
  assert.ok(taxonomy.objects);
  assert.deepEqual(await api.invokeTool(folder, 'sdlc_monitors', {operation:'list'}), []);
  assert.deepEqual(await api.invokeTool(folder, 'sdlc_monitors', {operation:'events'}), []);
  assert.deepEqual(await api.invokeTool(folder, 'sdlc_automation', {operation:'list'}), []);
  assert.ok(Array.isArray(await api.invokeTool(folder, 'sdlc_connections', {operation:'list'})));
  await assert.rejects(access(path.join(folder, '.work-item/monitors')), 'Monitor reads must not create files');
  await assert.rejects(access(path.join(folder, '.work-item/automation')), 'Workflow reads must not create files');
  await assert.rejects(access(path.join(folder, '.work-item/studio')), 'Reading taxonomy must not create studio files');
  await vscode.commands.executeCommand('copilotSdlc.initialize');
  const config = JSON.parse(await readFile(path.join(folder, '.copilot-sdlc/config.json'), 'utf8'));
  assert.equal(config.version, 1);
  assert.match(await readFile(path.join(folder,'.github/skills/harness-workbench/SKILL.md'),'utf8'),/references\/tools.md/);
  const reference=await readFile(path.join(folder,'.github/skills/harness-workbench/references/tools.md'),'utf8');
  for (const definition of catalog) assert.ok(reference.includes(definition.name), `Skill documents ${definition.name}`);
  await vscode.commands.executeCommand('copilotSdlc.openTsv', 'tasks');
  if (process.env.SDLC_VISUAL_CHECK === '1') {
    const client = new HarnessClient(folder);
    for (const [title, requirements] of [['Order filter', 'W1: an empty filter shows all records'], ['Session metrics', 'W1: tokens and duration are saved as TSV'], ['Permission checks', 'W1: users can only see their own data']]) {
      await client.invoke({ operation: 'create', title, requirements });
    }
    await client.invoke({ operation: 'approve', id: 'WI-001' });
    await client.invoke({ operation: 'update', id: 'WI-001', status: 'active', actor: 'sdk-worker' });
    await client.invoke({ operation: 'update', id: 'WI-003', status: 'blocked', reason: 'Scope decision', actor: 'user' });
  }
  const panelCount = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview).length;
  const dashboardReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { listener.dispose(); reject(new Error('Dashboard tab did not open')); }, 10_000);
    const listener = vscode.window.tabGroups.onDidChangeTabs(() => {
      if (panelCount()) { clearTimeout(timeout); listener.dispose(); resolve(); }
    });
  });
  await vscode.commands.executeCommand('copilotSdlc.dashboard');
  await dashboardReady;
  const count = panelCount();
  const companion = vscode.extensions.getExtension('example.quality');
  assert.ok(companion, 'Standalone companion extension is available');
  await companion.activate();
  assert.ok(api.listModules().some(m => m.id === 'example.quality'));
  assert.ok(api.executors?.list().some(e => e.id === 'copilot-sdk' && e.module === 'core.copilot'));
  assert.ok(api.executors?.list().some(e => e.id === 'example.quality.echo' && e.module === 'example.quality'));
  assert.deepEqual(await api.invokeTool(folder, 'example_quality_summary', {}), {
    tasks: process.env.SDLC_VISUAL_CHECK === '1' ? 3 : 0,
    approved: process.env.SDLC_VISUAL_CHECK === '1' ? 1 : 0,
    blocked: process.env.SDLC_VISUAL_CHECK === '1' ? 1 : 0,
    review: 0,
  });
  const events: string[] = [];
  const listener = api.onDidEvent(event => events.push(event.type));
  api.refresh(folder);
  assert.ok(events.includes('workspace.changed'));
  listener.dispose();
  if (process.env.SDLC_VISUAL_CHECK !== '1') {
    const item = await api.invokeTool(folder, 'sdlc_update_task', { operation: 'create', title: 'Status routing', requirements: 'W1' }) as {id: string};
    const state = await api.getSnapshot(folder);
    assert.deepEqual(state!.agentActions![item.id].filter(action => action.enabled).map(action => action.role), ['planner']);
    const modelState = await api.invokeTool(folder, 'sdlc_metrics', {}) as typeof state;
    assert.deepEqual(modelState!.agentActions, state!.agentActions, 'UI/API and Copilot tools share available actions');
    await assert.rejects(api.sessions.run(folder, { id: item.id, role: 'judge' }), /is not available/);
    assert.equal((await api.sessions.list(folder)).length, 0, 'Rejected status never starts an SDK session');
    const direct = await api.sessions.run(folder, { id: item.id, role: 'planner', executor: 'example.quality.echo' }) as { executor: string; outcome: string };
    assert.equal(direct.executor, 'example.quality.echo'); assert.equal(direct.outcome, 'completed');
    const tool = await api.invokeTool(folder, 'sdlc_run', { id: item.id, role: 'planner', executor: 'example.quality.echo' }) as typeof direct;
    assert.equal(tool.executor, direct.executor);
    assert.ok((await api.sessions.list(folder)).every(s => s.executor === 'example.quality.echo'));
  }
  if (process.env.SDLC_VISUAL_CHECK !== '1') {
    const initiative = await api.invokeTool(folder, 'sdlc_initiatives', { operation:'create',title:'Research from ordinary Copilot',estimate:8,body:'Quick estimate and uncertainty.' }) as {id:string};
    const team = await api.invokeTool(folder, 'sdlc_research', { operation:'start',initiative:initiative.id,plan:'Two focused slices',maxParallel:2,members:[
      {role:'specify',purpose:'research',focus:'UI contract',executor:'example.quality.echo'},
      {role:'specify',purpose:'research',focus:'Data contract',executor:'example.quality.echo'}] }) as {team:string};
    let result: any[] = [];
    const researchDeadline = Date.now() + 30000;
    while(Date.now() < researchDeadline){result=await api.invokeTool(folder,'sdlc_research',{operation:'status',id:team.team}) as any[];if(['completed','failed','cancelled','interrupted'].includes(result[0].status))break;await new Promise(resolve=>setTimeout(resolve,25));}
    if (result[0]?.status !== 'completed') console.error('Research diagnostics:', JSON.stringify(result, null, 2));
    assert.equal(result[0].status, 'completed', `Research failed: ${JSON.stringify(result[0])}`);assert.equal(result[0].artifacts.length,2);assert.equal(result[0].sessions.length,2);
    const prototype = await api.invokeTool(folder,'sdlc_artifacts',{operation:'create',kind:'prototype',parent:initiative.id,title:'HTML discussion',body:'<!doctype html><html><body>Prototype</body></html>',data:{format:'html'}}) as {file:string};
    assert.match(await readFile(path.join(folder,prototype.file),'utf8'),/Prototype/);
    assert.ok(api.listModules().some(m=>m.id==='core.research'));
  }
  await api.openWorkbench(folder);
  assert.equal(panelCount(), count, 'Companion API uses the same workbench');
  await vscode.commands.executeCommand('copilotSdlc.liveSessions');
  assert.equal(panelCount(), count, 'The live view reuses the existing dashboard');
  console.log('VS Code integration: no implicit files, all tools, supervised research, prototype artifacts, single workbench, status policy, companion executor via sessions API and Copilot tool, shared live history OK');
  if (process.env.SDLC_VISUAL_CHECK === '1') await new Promise(resolve => setTimeout(resolve, 45000));
}

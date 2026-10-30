import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHost } from './support/vscode-host';
import type { createEnvironmentController as CreateEnvironmentController } from '../src/bootstrap/environment';
import type { EnvironmentDiscovery } from '../src/contracts/environment';
import type * as vscode from 'vscode';

test('scoped environment settings and secret lifecycle never disclose credential values', async () => {
  const secrets = new Map<string, string>(), settings = new Map<string, Record<string, string>>();
  let answer: string | undefined, promptOptions: Record<string, unknown> | undefined;
  const workspace = { isTrusted: true, getConfiguration: (_section: string, uri?: {fsPath: string}) => ({
    get: (key: string) => settings.get(uri?.fsPath || 'global')?.[key],
    update: async (key: string, value: string) => { const id = uri?.fsPath || 'global', values = settings.get(id) || {}; values[key] = value; settings.set(id, values); },
  }) };
  const mock = { workspace, Uri: { file: (fsPath: string) => ({ fsPath }) }, ConfigurationTarget: { Global: 1, WorkspaceFolder: 3 },
    window: { showInputBox: async (options: Record<string, unknown>) => { promptOptions = options; return answer; } } };
  const context = { secrets: { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); } } } as unknown as vscode.ExtensionContext;
  const discovery: EnvironmentDiscovery = { inspect: async (tool, configuredPath) => ({ tool, configuredPath, executable: configuredPath || `/auto/${tool}`, version: '1' }) };
  const { createEnvironmentController } = await loadHost<{ createEnvironmentController: typeof CreateEnvironmentController }>('src/bootstrap/environment.ts', mock);
  const controller = createEnvironmentController(context, discovery);
  await controller.save({git:'/one/git',node:'',java:'',python:''}, '/one');
  await controller.save({git:'/two/git',node:'',java:'',python:''}, '/two');
  assert.equal((await controller.read('/one')).tools[0].configuredPath, '/one/git');
  assert.equal((await controller.read('/two')).tools[0].configuredPath, '/two/git');
  answer = 'secret-one'; let status = await controller.setCredential('githubToken', '/one');
  assert.equal(promptOptions?.password, true); assert.equal(status.credentials[0].configured, true);
  assert.ok(!JSON.stringify(status).includes('secret-one'));
  answer = 'secret-two'; status = await controller.setCredential('githubToken', '/one');
  assert.ok(!JSON.stringify(status).includes('secret-two'));
  answer = undefined; await controller.setCredential('githubToken', '/one');
  const runtime = await controller.runtimeOptions('/one');
  assert.equal(runtime.gitHubToken, 'secret-two');
  assert.ok(!JSON.stringify(runtime.env).includes('secret-two'));
  answer = 'another-secret'; status = await controller.setCredential('openaiApiKey', '/one');
  assert.ok(!JSON.stringify(status).includes('another-secret'));
  assert.ok(!JSON.stringify(await controller.runtimeOptions('/one')).includes('another-secret'));
  status = await controller.deleteCredential('githubToken', '/one');
  assert.equal(status.credentials[0].configured, false);
  assert.equal((await controller.runtimeOptions('/one')).gitHubToken, undefined);
  workspace.isTrusted = false;
  await assert.rejects(controller.read('/one'), /Trust/);
  await assert.rejects(controller.setCredential('githubToken', '/one'), /Trust/);
  await assert.rejects(controller.runtimeOptions('/one'), /Trust/);
});

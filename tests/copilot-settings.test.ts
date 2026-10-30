import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHost } from './support/vscode-host';
import type * as Settings from '../src/host/vscode/copilot-settings';

test('settings proposals require disabled skills and preserve other folder settings', async () => {
  let effective: boolean | undefined = true, folder: boolean | undefined;
  const other = { 'editor.tabSize': 4 }, updates: unknown[][] = [];
  const workspace = { isTrusted: true, getConfiguration: (_section: unknown, uri: { fsPath: string }) => {
    assert.equal(uri.fsPath, '/project');
    return { get: () => effective, inspect: () => ({ workspaceFolderValue: folder }),
      update: async (...args: unknown[]) => { updates.push(args); folder = args[1] as boolean; effective = folder; } };
  } };
  const mock = { workspace, Uri: { file: (fsPath: string) => ({ fsPath }) }, ConfigurationTarget: { WorkspaceFolder: 3 } };
  const { proposeCopilotSettings, applyCopilotSettings } = await loadHost<typeof Settings>('src/host/vscode/copilot-settings.ts', mock);
  assert.equal(proposeCopilotSettings('/project'), undefined);
  effective = undefined;
  assert.equal(proposeCopilotSettings('/project'), undefined);
  effective = false;
  const proposal = proposeCopilotSettings('/project')!;
  assert.deepEqual(proposal.patch, { op: 'add', path: '/chat.useAgentSkills', value: true });
  workspace.isTrusted = false;
  await assert.rejects(applyCopilotSettings('/project', proposal), /Trust/);
  workspace.isTrusted = true;
  effective = true;
  await assert.rejects(applyCopilotSettings('/project', proposal), /changed since review/);
  effective = false; folder = false;
  await assert.rejects(applyCopilotSettings('/project', proposal), /changed since review/);
  const replacement = proposeCopilotSettings('/project')!;
  assert.equal(replacement.patch.op, 'replace');
  await applyCopilotSettings('/project', replacement);
  assert.deepEqual(updates, [['chat.useAgentSkills', true, 3]]);
  assert.deepEqual(other, { 'editor.tabSize': 4 });
});

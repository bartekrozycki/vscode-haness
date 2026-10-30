import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { agentActions, defaultAgentsByStatus, validateAgentWorkflow } from '../src/domain/agent-policy';
import { TestProjectClient as HarnessClient, initialize } from './support/project';
import type { AgentDefinition, ProjectConfig, Snapshot } from '../src/contracts/model';

const agents: AgentDefinition[] = ['planner', 'worker', 'judge', 'designer'].map(role => ({ name: `sdlc-${role}`, description: role, prompt: '' }));
function fixture(status = 'ready', approved = ''): Snapshot {
  return { tasks: [{ id: 'WI-001', title: 'Test', status, approved, blocked: '', dependencies: '', executor: '' }], history: [], questions: [], lessons: [], metrics: [], runs: [], config: { version: 1, models: {}, gates: [], session: { timeoutSeconds: 900, maxOutputTokens: 60000, maxPremiumRequests: null } } };
}
const enabled = (state: Snapshot) => agentActions(state, state.tasks[0], agents).filter(a => a.enabled).map(a => a.role);

test('task status determines direct actions and the first available default role', () => {
  assert.deepEqual(enabled(fixture()), ['planner']);
  assert.deepEqual(enabled(fixture('ready', 'user')), ['worker', 'planner']);
  for (const status of ['active', 'changes']) assert.deepEqual(enabled(fixture(status, 'user')), ['worker']);
  assert.equal(agentActions(fixture('changes', 'user'), fixture('changes', 'user').tasks[0], agents)[0].label, 'Fix');
  assert.deepEqual(enabled(fixture('review', 'user')), ['judge']);
  for (const status of ['accepted', 'closed', 'blocked']) assert.deepEqual(enabled(fixture(status, 'user')), []);
});

test('project mapping adds custom roles, overrides ordering and explicitly disables a status', () => {
  const state = fixture('ready', 'user');
  state.config.workflow = { agentsByStatus: { ready: ['designer', 'planner'], review: [] } };
  assert.deepEqual(enabled(state), ['designer', 'planner']);
  state.tasks[0].status = 'review'; assert.deepEqual(enabled(state), []);
  state.tasks[0].status = 'active'; assert.deepEqual(enabled(state), ['worker']);
  state.config.workflow.agentsByStatus!.active = ['judge']; assert.deepEqual(enabled(state), [], 'Config cannot bypass the review prerequisite');
});

test('availability explains approvals, dependencies, questions and session/executor ownership', () => {
  const state = fixture('ready', 'user'), task = state.tasks[0];
  task.dependencies = 'WI-002'; assert.match(agentActions(state, task, agents)[0].reason!, /dependencies/);
  state.tasks.push({ id: 'WI-002', status: 'accepted' }); assert.deepEqual(enabled(state), ['worker', 'planner']);
  task.executor = 'another-worker'; assert.match(agentActions(state, task, agents)[0].reason!, /belongs to/);
  task.executor = ''; state.questions.push({ item: task.id, answer: '' }); assert.deepEqual(enabled(state), []);
  state.questions = []; state.runs.push({ id: 'open', item: task.id, actor: 'sdk-planner', finished: '' }); assert.deepEqual(enabled(state), []);
  state.runs[0].finished = 'done'; assert.deepEqual(enabled(state), ['worker', 'planner']);
  state.runs.push({ id: 'other', item: 'WI-002', actor: 'sdk-worker', finished: '' }); assert.deepEqual(enabled(state), ['planner']);
});

test('missing definitions and malformed workflow never fall back to the entire agent catalog', () => {
  const state = fixture('review');
  assert.match(agentActions(state, state.tasks[0], [agents[0]])[0].reason!, /Missing agent definition/);
  for (const map of [{ unknown: ['planner'] }, { ready: 'planner' }, { ready: ['worker', 'worker'] }, { ready: ['../escape'] }, null]) {
    assert.throws(() => validateAgentWorkflow({ workflow: { agentsByStatus: map } } as unknown as ProjectConfig), /workflow/);
  }
});

test('project snapshot exposes the same actions to UI, companion modules and Copilot tools', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-agents-'));
  try {
    await initialize(root, path.resolve('resources'));
    const client = new HarnessClient(root), config = await client.config();
    assert.deepEqual(config.workflow!.agentsByStatus, defaultAgentsByStatus);
    delete config.workflow; await writeFile(path.join(root, '.copilot-sdlc/config.json'), JSON.stringify(config));
    const task = await client.invoke<{ id: string }>({ operation: 'create', title: 'Legacy project', requirements: 'W1' });
    const snapshot = await client.agentSnapshot();
    assert.deepEqual(snapshot.agentActions![task.id].filter(a => a.enabled).map(a => a.role), ['planner']);
    await writeFile(path.join(root, '.github/agents/sdlc-planner.agent.md'), 'broken front matter');
    const broken = await client.agentSnapshot();
    assert.equal(broken.tasks.length, 1);
    assert.ok(broken.agentActions![task.id].every(a => !a.enabled));
    assert.match(broken.agentActions![task.id][0].reason!, /front matter/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

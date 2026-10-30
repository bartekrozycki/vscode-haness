import type { AgentAction, AgentDefinition, ProjectConfig, Row, Snapshot } from '../contracts/model';
import { selectExecutor, validateExecution } from './execution-policy';
export const defaultAgentsByStatus: Readonly<Record<string, readonly string[]>> = {
    ready: ['worker', 'planner'], active: ['worker'], review: ['judge'], changes: ['worker'],
    blocked: [], accepted: [], closed: [],
};
export function validateAgentWorkflow(config: ProjectConfig): void {
    const workflow = config.workflow;
    if (workflow === undefined)
        return;
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || Object.keys(workflow).some(k => k !== 'agentsByStatus'))
        throw new Error('Invalid workflow in project configuration.');
    const map = workflow.agentsByStatus;
    if (map === undefined)
        return;
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.entries(map).some(([status, roles]) => !Object.hasOwn(defaultAgentsByStatus, status) || !Array.isArray(roles) || roles.some(role => typeof role !== 'string' || !/^[a-z][a-z0-9_-]{0,62}$/.test(role)) || new Set(roles).size !== roles.length))
        throw new Error('Invalid workflow.agentsByStatus: supply task statuses and unique agent roles without the sdlc- prefix.');
}
/** Shared by UI, commands and SDK preflight. Never starts a session or changes a task. */
export function agentActions(snapshot: Snapshot, task: Row, agents: AgentDefinition[], sourceError?: string): AgentAction[] {
    validateAgentWorkflow(snapshot.config);
    validateExecution(snapshot.config);
    const roles = snapshot.config.workflow?.agentsByStatus?.[task.status] ?? defaultAgentsByStatus[task.status] ?? [];
    return roles.map(role => {
        const definition = agents.find(a => a.name === `sdlc-${role}`), actor = `sdk-${role}`;
        let reason = sourceError;
        if (!reason && !definition)
            reason = `Missing agent definition sdlc-${role}.`;
        if (!reason && snapshot.runs.some(r => !r.finished && r.item === task.id))
            reason = 'This task has an open session. Finish it or recover the interrupted run.';
        if (!reason && (task.blocked || snapshot.questions.some(q => q.item === task.id && !q.answer)))
            reason = 'This task is waiting for a blocker or question to be resolved.';
        if (!reason && snapshot.runs.some(r => !r.finished && r.actor === actor))
            reason = `Agent ${role} already has an open session for another task.`;
        if (!reason && role === 'worker') {
            if (!['ready', 'active', 'changes'].includes(task.status))
                reason = 'Workers can only run tasks that are ready, active or awaiting changes.';
            else if (!task.approved)
                reason = 'Approve implementation first.';
            else if ((task.dependencies || '').split(',').map(s => s.trim()).filter(Boolean).some(id => !snapshot.tasks.some(t => t.id === id && ['accepted', 'closed'].includes(t.status))))
                reason = 'Complete the dependencies of this task first.';
            else if (task.executor && task.executor !== actor)
                reason = `This task belongs to ${task.executor}. Release it by changing its status to ready.`;
            else if (snapshot.tasks.some(t => t.id !== task.id && t.status === 'active' && t.executor === actor))
                reason = 'The worker already has another active task.';
        }
        if (!reason && role === 'judge') {
            if (task.status !== 'review')
                reason = 'The verifier can only assess a task handed off for review.';
            else if (task.executor === actor)
                reason = 'Workers cannot review their own work.';
        }
        return { role, label: role === 'worker' ? ({ active: 'Continue', changes: 'Fix' }[task.status] || 'Implement') : role === 'planner' ? 'Plan' : role === 'judge' ? 'Verify' : `Run ${role}`,
            description: definition?.description || role, enabled: !reason, executor: selectExecutor(snapshot.config, role, definition), ...(reason ? { reason } : {}) };
    });
}
export function withAgentActions(snapshot: Snapshot, agents: AgentDefinition[], sourceError?: string): Snapshot {
    return { ...snapshot, agentActions: Object.fromEntries(snapshot.tasks.map(task => [task.id, agentActions(snapshot, task, agents, sourceError)])) };
}

import { state, send, persist } from '../state.js';
import { byId, el, button, status, section } from '../dom.js';
import { renderSession } from './session.js';
import { renderTaskContributions } from './modules.js';
export function renderInspector() {
    if (state.interacting)
        return;
    const inspector = byId('inspector'), old = inspector.querySelector('.session-log');
    if (old)
        state.positions.set(old.dataset.run, old.scrollTop);
    inspector.replaceChildren();
    const task = state.data?.tasks.find(t => t.id === state.selectedItem);
    if (!task && state.live.some(s => s.item === state.selectedItem)) {
        inspector.append(el('h2', 'Research · ' + state.selectedItem));
        const root = el('section', undefined, 'session-section'); root.id = 'session-root'; inspector.append(root); renderSession(); return;
    }
    if (!task) {
        inspector.append(el('p', 'Select a task to see its details and agent session.', 'empty'));
        return;
    }
    const top = el('div', undefined, 'inspector-top');
    top.append(el('span', task.id, 'mono'), status(task.status));
    inspector.append(top, el('h2', task.title, 'task-name'), el('div', [task.priority, task.area, task.executor].filter(Boolean).join(' · '), 'task-meta'));
    const actions = el('div', undefined, 'task-buttons'), agentActions = state.data.agentActions?.[task.id] || [], primary = agentActions.find(a => a.enabled);
    agentActions.forEach(action => { const b = button(action.label, 'run', { id: task.id, role: action.role }, action === primary ? 'primary' : undefined); b.disabled = !action.enabled; b.title = action.reason || action.description + ' · Executor: ' + (action.executor || 'copilot-sdk'); b.dataset.agentRole = action.role; actions.append(b); });
    actions.append(button('Open description', 'openTask', { id: task.id }), button('Status…', 'status', { id: task.id }));
    if (['ready', 'changes'].includes(task.status) && !task.approved)
        actions.append(button('Approve implementation', 'approve', { id: task.id }));
    if (task.blocked && task.status !== 'blocked')
        actions.append(button('Unblock', 'unblock', { id: task.id }));
    inspector.append(actions);
    const hints = [...new Set(agentActions.filter(a => !a.enabled).map(a => a.reason))];
    if (!agentActions.length)
        inspector.append(el('p', 'No agents are assigned to this status.', 'agent-hint muted'));
    hints.forEach(reason => inspector.append(el('p', reason, 'agent-hint muted')));
    if (task.blocked) {
        const missingHandoff = task.blocked.startsWith('Session ended without handoff/verdict:');
        inspector.append(el('p', missingHandoff ? 'The session ended without a handoff or verdict. The task needs further action.' : task.blocked, 'blocker error'));
        if (missingHandoff && !state.data.config?.gates?.length) {
            const hint = el('div', undefined, 'blocker');
            hint.append(el('p', 'No quality gates are configured. Configure and run gates for the current commit before handing off for review.'), button('Configure gates', 'openConfig', {}, 'small'));
            inspector.append(hint);
        }
    }
    const sessionRoot = el('section', undefined, 'session-section');
    sessionRoot.id = 'session-root';
    inspector.append(sessionRoot);
    renderSession();
    const questions = (state.data.questions || []).filter(q => q.item === state.selectedItem && !q.answer);
    if (questions.length) {
        const content = el('div');
        questions.forEach(q => { const box = el('div', undefined, 'question'); box.append(el('p', q.question), el('pre', q.options), el('p', 'Recommendation: ' + q.recommended, 'muted'), button('Answer', 'answer', { id: task.id, question: q.id }, 'small')); content.append(box); });
        const details = section('Questions · ' + questions.length, 'questions:' + task.id, content);
        details.open = true;
        inspector.append(details);
    }
    renderTaskContributions();
    persist();
}

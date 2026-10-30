import { state, send, persist } from './state.js';
import { byId, el, button, duration } from './dom.js';
import { renderTasks, liveIndicators } from './components/tasks.js';
import { renderSession } from './components/session.js';
import { renderInspector } from './components/inspector.js';
import { renderModules, renderSummary, renderTaskContributions } from './components/modules.js';
import { renderEnvironment, renderOnboarding, renderSuggestions, setOnboardingDismissed, suggestionStatus, setSuggestionsPending } from './components/setup.js';
import { renderMonitors, renderAutomation, renderConnections } from './components/monitors.js';
import { applyLiveUpdate } from './live-update';
function chooseTask(id, run) { state.selectedItem = id; state.selectedRun = run || ''; state.requestedRun = ''; persist(); send('selectTask', { id }); renderTasks(chooseTask); renderInspector(); }
function chooseSession(run) {
    const s = state.live.find(s => s.run === run);
    if (!s)
        return;
    state.selectedItem = s.item;
    state.selectedRun = run;
    persist();
    renderTasks(chooseTask);
    renderInspector();
}
function render() {
    const notice = byId('notice');
    notice.replaceChildren();
    if (state.failure)
        notice.append(el('p', state.failure, 'error'));
    renderOnboarding(state.loaded, state.data, state.failure);
    renderSummary(chooseSession);
    renderTasks(chooseTask);
    renderInspector();
    renderModules();
}
byId('filter').value = state.saved.filter || '';
byId('filter').addEventListener('input', () => { persist(); renderTasks(chooseTask); });
byId('list-mode').onclick = () => { state.mode = 'list'; persist(); renderTasks(chooseTask); };
byId('board-mode').onclick = () => { state.mode = 'board'; persist(); renderTasks(chooseTask); };
document.querySelectorAll('[data-action]').forEach(n => n.onclick = () => { n.closest('.source-menu')?.removeAttribute('open'); send(n.dataset.action); });
document.querySelectorAll('[data-table]').forEach(n => n.onclick = () => { n.closest('.source-menu')?.removeAttribute('open'); send('openTsv', { table: n.dataset.table }); });
byId('initialize').onclick = () => send('initialize');
byId('suggest-tasks').onclick = () => { setSuggestionsPending(true); suggestionStatus('Preparing suggestions…'); send('suggestTasks'); };
byId('dismiss-onboarding').onclick = () => { setOnboardingDismissed(true); send('onboardingDismiss'); };
byId('show-onboarding').onclick = () => { setOnboardingDismissed(false); send('onboardingShow'); };
byId('close-studio').onclick = () => byId('studio-dialog').close();
byId('settings').onclick = () => { byId('settings-dialog').showModal(); send('environmentRead'); };
byId('close-settings').onclick = () => byId('settings-dialog').close();
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
byId('monitors').onclick = () => { byId('monitor-dialog').showModal(); send('monitorRead'); send('connectionRead'); send('automationRead'); };
byId('close-monitors').onclick = () => byId('monitor-dialog').close();
byId('modules').onclick = () => byId('module-dialog').showModal();
byId('close-modules').onclick = () => byId('module-dialog').close();
document.addEventListener('pointerdown', event => {
    if (byId('inspector').contains(event.target))
        state.interacting = true;
});
document.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key) && byId('inspector').contains(event.target))
        state.interacting = true;
});
function releaseInteraction() {
    if (!state.interacting)
        return;
    setTimeout(() => { state.interacting = false; renderSession(); }, 0);
}
document.addEventListener('pointerup', releaseInteraction);
document.addEventListener('pointercancel', releaseInteraction);
document.addEventListener('keyup', releaseInteraction);
window.addEventListener('blur', releaseInteraction);
window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string')
        return;
    if (message.type === 'connections') { renderConnections(message.connections || [], message.error); return; }
    if (message.type === 'automation') { renderAutomation(message.workflowActions || [], message.error); return; }
    if (message.type === 'monitors') { renderMonitors(message.monitors || [], message.events || [], message.error); return; }
    if (message.type === 'studioRecord') {
        const record = message.record; if (!record) return;
        byId('studio-title').textContent = record.title || record.id;
        const content = byId('studio-content'); content.replaceChildren();
        content.append(el('p', [record.id, record.kind, record.status, record.estimate && 'Estimate ' + record.estimate].filter(Boolean).join(' · '), 'muted'));
        if (record.body) content.append(el('pre', record.body, 'studio-body'));
        if (record.file) content.append(button('Open file', 'openStudioFile', { id: record.id }, 'small'));
        if (!byId('studio-dialog').open) byId('studio-dialog').showModal();
        return;
    }
    if (message.type === 'onboardingPreference') { setOnboardingDismissed(message.dismissed); return; }
    if (message.type === 'environment') { renderEnvironment(message.environment || {}, message.error); return; }
    if (message.type === 'taskSuggestions') { if (message.error) suggestionStatus(message.error, true); else renderSuggestions(message.suggestions, message.source); return; }
    if (message.type === 'navigate') {
        if (message.item)
            state.selectedItem = message.item;
        if (message.run) {
            state.selectedRun = message.run;
            const s = state.live.find(s => s.run === message.run);
            if (s)
                state.selectedItem = s.item;
        }
        persist();
        renderTasks(chooseTask);
        renderInspector();
        return;
    }
    if (message.type === 'refreshState') {
        const control = document.querySelector('[data-action=refresh]');
        control.disabled = message.busy;
        control.textContent = message.busy ? 'Refreshing…' : 'Refresh';
        byId('refresh-status').textContent = message.busy ? 'Refreshing…' : message.error ? 'Refresh failed: ' + message.error : 'Refreshed ' + new Date().toLocaleTimeString('en-US');
        return;
    }
    if (message.type === 'snapshot') {
        if (message.manual) state.interacting = false;
        state.loaded = true;
        state.data = message.snapshot;
        state.failure = message.error;
        applyLiveUpdate(state, message);
        if (message.project)
            byId('project').textContent = message.project;
        render();
    }
    if (message.type === 'live') {
        if (!applyLiveUpdate(state, message))
            return;
        persist();
        renderSummary(chooseSession);
        if (message.selection) {
            renderTasks(chooseTask);
            renderInspector();
        }
        else {
            liveIndicators();
            renderSession();
        }
    }
    if (message.type === 'contributions') {
        state.contributions = message.contributions;
        state.contributionItem = message.item || '';
        renderSummary(chooseSession);
        renderTaskContributions();
        renderModules();
    }
});
setInterval(() => document.querySelectorAll('[data-duration]').forEach(node => {
    const s = state.live.find(s => s.run === node.dataset.duration);
    if (s)
        node.textContent = duration(s);
}), 1000);
render();
send('ready');
send('onboardingRead');

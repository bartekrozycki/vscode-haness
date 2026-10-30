import { state, send, persist } from '../state.js';
import { byId, el, button, duration } from '../dom.js';
export function taskSessions() { return state.live.filter(s => s.item === state.selectedItem); }
export function renderSession() {
    if (state.interacting)
        return;
    const root = byId('session-root');
    if (!root)
        return;
    const old = root.querySelector('.session-log'), selection = window.getSelection();
    if (old && selection?.toString() && old.contains(selection.anchorNode))
        return;
    if (old)
        state.positions.set(old.dataset.run, old.scrollTop);
    const focusKey = document.activeElement?.dataset.focusKey;
    const sessions = taskSessions();
    if (!sessions.some(s => s.run === state.selectedRun))
        state.selectedRun = (sessions.find(s => s.controllable) || sessions[0] || {}).run || '';
    const s = sessions.find(s => s.run === state.selectedRun);
    root.replaceChildren();
    const heading = el('div', undefined, 'session-heading');
    heading.append(el('h3', 'Agent session'));
    root.append(heading);
    if (!s) {
        root.append(el('p', 'Start an agent to see its responses and tools here.', 'muted'));
        return;
    }
    const select = el('select');
    select.setAttribute('aria-label', 'Task session');
    select.dataset.focusKey = 'session-select';
    sessions.forEach(item => { const option = el('option', item.role + ' · ' + (state.phases[item.status] || item.status) + ' · ' + item.started.slice(5, 16).replace('T', ' ')); option.value = item.run; select.append(option); });
    select.value = state.selectedRun;
    select.onchange = () => { state.selectedRun = select.value; persist(); renderSession(); };
    heading.append(select);
    if (state.requestedRun !== state.selectedRun) {
        state.requestedRun = state.selectedRun;
        send('selectSession', { run: state.selectedRun });
    }
    const activity = el('div', undefined, 'session-activity');
    activity.append(el('span', undefined, 'dot'), el('span', s.activity || state.phases[s.status] || s.status));
    const clock = el('span', duration(s), 'mono');
    clock.dataset.duration = s.run;
    activity.append(clock);
    if (s.controllable) {
        const stop = button(s.item.startsWith('INI-') ? 'Stop team' : 'Stop', 'stopSession', { run: s.run }, 'small stop');
        stop.dataset.focusKey = 'stop';
        activity.append(stop);
    }
    root.append(activity);
    if (s.status === 'limit') {
        const warning = el('div', undefined, 'blocker');
        warning.append(el('p', s.stopReason || 'This session was stopped by an extension limit.'), button('Session limits', 'openConfig', {}, 'small'));
        root.append(warning);
    }
    root.append(el('div', (s.executor || '—') + ' · ' + s.model + ' · ' + s.inputTokens.toLocaleString('en-US') + ' in / ' + s.outputTokens.toLocaleString('en-US') + ' out · ' + s.toolCalls + ' tools', 'session-meta'));
    const controls = el('div', undefined, 'live-controls'), label = el('label'), checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.follow;
    checkbox.dataset.focusKey = 'follow';
    checkbox.onchange = () => { state.follow = checkbox.checked; persist(); renderSession(); };
    label.append(checkbox, document.createTextNode('Follow stream'));
    controls.append(label);
    if (s.hasLog || s.entries.length)
        controls.append(button('TSV', 'openLiveLog', { run: s.run }, 'small'));
    if (s.finished)
        controls.append(button('Report', 'openReport', { run: s.run }, 'small'));
    if (s.status === 'interrupted')
        controls.append(button('Recover', 'recover', { run: s.run }, 'small'));
    root.append(controls);
    if (s.storageError)
        root.append(el('p', 'Could not save the log: ' + s.storageError, 'error'));
    if (s.truncated)
        root.append(el('p', 'The preview shows the latest parts of this long session.', 'muted'));
    const log = el('div', undefined, 'session-log');
    log.dataset.run = s.run;
    log.dataset.focusKey = 'log';
    log.tabIndex = 0;
    log.setAttribute('aria-label', 'Session transcript ' + s.item);
    if (!s.entries.length)
        log.append(el('p', s.entriesLoaded === false ? 'Loading transcript…' : !s.finished && s.status !== 'interrupted' ? 'Waiting for the first events…' : 'This session predates live capture. A final report is available.', 'empty'));
    s.entries.forEach(entry => {
        const block = el('article', undefined, 'live-entry ' + entry.kind), timestamp = entry.timestamp.slice(11, 19);
        if (entry.kind === 'tool') {
            const details = el('details');
            details.open = state.expanded.has(entry.id) || (!state.collapsed.has(entry.id) && entry.status === 'running');
            const summary = el('summary', timestamp + ' · ' + entry.title + ' · ' + (entry.status || ''));
            summary.onclick = () => {
                if (details.open) {
                    state.expanded.delete(entry.id);
                    state.collapsed.add(entry.id);
                }
                else {
                    state.expanded.add(entry.id);
                    state.collapsed.delete(entry.id);
                }
                persist();
            };
            details.append(summary);
            if (entry.arguments)
                details.append(el('pre', entry.arguments, 'tool-arguments'));
            details.append(el('pre', entry.text || 'Waiting for a result…'));
            details.ontoggle = () => {
                if (!details.isConnected)
                    return;
                if (details.open) {
                    state.expanded.add(entry.id);
                    state.collapsed.delete(entry.id);
                }
                else {
                    state.expanded.delete(entry.id);
                    state.collapsed.add(entry.id);
                }
                persist();
            };
            block.append(details);
        }
        else {
            block.append(el('div', timestamp + ' · ' + entry.title, 'entry-title'));
            if (entry.text)
                block.append(el('pre', entry.text));
        }
        log.append(block);
    });
    root.append(log);
    const scrollTop = Number(state.positions.get(s.run)) || 0;
    requestAnimationFrame(() => {
        log.scrollTop = state.follow ? log.scrollHeight : scrollTop;
        if (focusKey)
            [...root.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
    });
    log.addEventListener('scroll', () => {
        state.positions.set(s.run, log.scrollTop);
        if (state.follow && log.scrollHeight - log.clientHeight - log.scrollTop > 40) {
            state.follow = false;
            checkbox.checked = false;
        }
        persist();
    });
    persist();
}

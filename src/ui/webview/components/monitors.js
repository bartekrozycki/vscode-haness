import { byId, el, localButton } from '../dom.js';
import { send } from '../state.js';
export function renderMonitors(monitors = [], events = [], error = '') {
    const content = byId('monitor-content');
    const open = new Set([...content.querySelectorAll('details[data-key]')].filter(n => n.open).map(n => n.dataset.key));
    const focused = content.contains(document.activeElement) ? (document.activeElement.dataset.focusKey || (document.activeElement.tagName === 'SUMMARY' ? 'summary:' + document.activeElement.parentElement.dataset.key : '')) : '';
    content.replaceChildren();
    if (error) content.append(el('p', error, 'error'));
    if (!monitors.length) content.append(el('p', 'No monitors configured. Define one with the Copilot master using sdlc_monitors.', 'muted'));
    for (const monitor of monitors) {
        const d = monitor.definition, item = el('details', undefined, 'context-section');
        item.dataset.key = 'monitor:' + d.id; item.open = open.has(item.dataset.key);
        item.append(el('summary', `${d.name} · ${monitor.active ? 'Active' : 'Paused'}${monitor.error ? ' · Error' : ''}`));
        const details = el('div'); details.append(el('p', `${d.provider} · ${d.connectionId} · every ${d.intervalSeconds}s · last poll ${monitor.lastPoll || 'never'}`, 'muted'));
        details.append(el('p', `Polls ${monitor.pollCount || 0} · errors ${monitor.errorCount || 0}${monitor.lastDurationMs !== undefined ? ' · last duration ' + monitor.lastDurationMs + 'ms' : ''}`, 'muted'));
        if (monitor.error) details.append(el('p', monitor.error, 'error'));
        const toggle = localButton(monitor.active ? 'Pause' : 'Activate', () => send('monitorAction', { operation: monitor.active ? 'pause' : 'activate', id: d.id }), 'small'); toggle.dataset.focusKey = 'toggle:' + d.id; details.append(toggle);
        if (monitor.active) { const poll = localButton('Poll now', () => send('monitorAction', { operation: 'poll', id: d.id }), 'small'); poll.dataset.focusKey = 'poll:' + d.id; details.append(poll); }
        const changes = events.filter(e => e.monitorId === d.id).slice(-20).reverse();
        if (!changes.length) details.append(el('p', 'No changes received yet.', 'muted'));
        for (const event of changes) { const change = el('details', undefined, 'context-section'); change.dataset.key = 'event:' + event.id; change.open = open.has(change.dataset.key); change.append(el('summary', `${event.observation.title || event.observation.id} · ${event.receivedAt}`)); const body = el('div'); body.append(el('p', event.observation.body || event.observation.title || 'Change received')); if (event.trigger) body.append(el('p', `Pending ${event.trigger.action} request`, 'muted')); change.append(body); details.append(change); }
        item.append(details); content.append(item);
    }
    if (focused.startsWith('summary:')) [...content.querySelectorAll('details[data-key]')].find(n => 'summary:' + n.dataset.key === focused)?.querySelector('summary')?.focus();
    else if (focused) [...content.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focused)?.focus();
}

export function renderAutomation(actions = [], error = '') {
    const container = byId('automation-content'); container.replaceChildren();
    if (error) container.append(el('p', error, 'error'));
    if (!actions.length) { container.append(el('p', 'No pending requests.', 'muted')); return; }
    for (const action of actions) { const row = el('div', undefined, 'context-section'); row.append(el('p', `${action.title || action.kind} · ${action.state}`)); const payload = el('details'); payload.append(el('summary', 'Request details')); payload.append(el('pre', JSON.stringify(action, null, 2), 'studio-body')); row.append(payload); for (const value of [action.detail, action.error, action.result]) if (value) row.append(el('p', typeof value === 'string' ? value : JSON.stringify(value), 'muted')); if (action.state === 'pending') { row.append(localButton('Approve', () => send('automationApprove', { id: action.id }), 'small')); row.append(localButton('Dismiss', () => send('automationDismiss', { id: action.id }), 'small')); } container.append(row); }
}
export function renderConnections(connections = [], error = '') {
    const content = byId('connection-content');
    if (error && content.querySelector('input')) { const previous = content.querySelector('.connection-error'); if (previous) previous.remove(); const notice = el('p', error, 'error connection-error'); content.prepend(notice); return; }
    content.replaceChildren();
    if (error) content.append(el('p', error, 'error'));
    for (const connection of connections) {
        const row = el('details', undefined, 'context-section'); row.append(el('summary', `${connection.id} · ${connection.provider} · ${connection.credentialPresent ? 'Credentials saved' : 'Needs credentials'}`));
        const body = el('div'); body.append(el('p', connection.baseUrl, 'muted'));
        body.append(localButton('Set credential…', () => send('connectionCredential', { id: connection.id }), 'small'), localButton('Remove connection', () => send('connectionRemove', { id: connection.id }), 'small'));
        row.append(body); content.append(row);
    }
    const form = el('details', undefined, 'context-section'); form.append(el('summary', 'Add connection')); const body = el('div');
    const id = el('input'); id.placeholder = 'Connection ID'; id.setAttribute('aria-label', 'Connection ID');
    const url = el('input'); url.placeholder = 'Base URL'; url.setAttribute('aria-label', 'Base URL');
    const provider = el('select'); provider.setAttribute('aria-label', 'Provider'); for (const value of ['jira', 'confluence', 'github', 'bitbucket']) { const option = el('option', value); option.value = value; provider.append(option); }
    const auth = el('select'); auth.setAttribute('aria-label', 'Authentication'); for (const value of ['token', 'basic']) { const option = el('option', value); option.value = value; auth.append(option); }
    body.append(id, url, provider, auth, localButton('Save connection', () => send('connectionSave', { metadata: { id: id.value, baseUrl: url.value, provider: provider.value, auth: auth.value } }), 'small')); form.append(body); content.append(form);
}

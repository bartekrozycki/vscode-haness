import { state, send, persist } from '../state.js';
import { byId, el, button, localButton, isActive, section, dataTable } from '../dom.js';
export function renderWidget(widget) {
    const box = el('div', undefined, 'widget-content');
    if (widget.error) {
        box.append(el('p', widget.error, 'error'));
        return box;
    }
    const c = widget.content;
    if (!c)
        return box;
    if (c.kind === 'text')
        box.append(el('p', c.text));
    if (c.kind === 'metrics') {
        const strip = el('div', undefined, 'metric-strip');
        c.values.forEach(v => {
            const metric = el('div', undefined, 'metric');
            metric.append(el('strong', v.value), el('span', v.label));
            if (v.detail)
                metric.title = v.detail;
            strip.append(metric);
        });
        box.append(strip);
    }
    if (c.kind === 'table')
        box.append(dataTable(c.columns, c.rows, widget.id === 'core.backlog/backlog' ? row => send('openStudioRecord', { id: row.ID }) : undefined));
    return box;
}
export function moduleActions(scope, owner) { const row = el('div', undefined, 'module-actions'); state.contributions.actions.filter(a => a.scope === scope && (!owner || a.module === owner)).forEach(a => row.append(button(a.title, 'moduleAction', { contribution: a.id }, 'small'))); return row; }
export function renderSummary(chooseSession) {
    const summary = byId('workspace-summary');
    summary.replaceChildren();
    state.contributions.widgets.filter(w => w.placement === 'workspace').forEach(w => { const box = el('div', undefined, 'workspace-widget'); box.setAttribute('aria-label', w.title); box.append(renderWidget(w)); summary.append(box); });
    const actions = moduleActions('workspace');
    if (actions.childNodes.length)
        summary.append(actions);
    const running = state.live.filter(isActive);
    if (running.length)
        summary.append(localButton(running.length + ' ' + (running.length === 1 ? 'live session' : 'live sessions'), () => chooseSession(running[0].run), 'small'));
}
export function renderTaskContributions() {
    const inspector = byId('inspector');
    inspector.querySelectorAll('[data-contribution]').forEach(n => n.remove());
    if (state.contributionItem !== state.selectedItem)
        return;
    state.contributions.widgets.filter(w => w.placement === 'task').forEach(w => { const details = section(w.title, w.id, renderWidget(w)); details.dataset.contribution = w.id; inspector.append(details); });
    const actions = moduleActions('task');
    if (actions.childNodes.length) {
        actions.dataset.contribution = 'actions';
        inspector.append(actions);
    }
}
export function renderModules() {
    const list = byId('module-list');
    list.replaceChildren();
    state.contributions.modules.forEach(m => {
        const item = el('article', undefined, 'module-item');
        item.append(el('h3', m.title + ' · ' + m.version), el('div', m.id, 'mono'));
        if (m.description)
            item.append(el('p', m.description));
        if (m.tools.length)
            item.append(el('div', m.tools.join(', '), 'mono'));
        if (m.executors?.length)
            item.append(el('div', 'Executors: ' + m.executors.join(', '), 'mono'));
        list.append(item);
    });
    byId('modules').textContent = 'Modules' + (state.contributions.modules.length ? ' · ' + state.contributions.modules.length : '');
}

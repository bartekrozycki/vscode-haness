import { state, send, persist } from '../state.js';
import { byId, el, localButton, isActive, status } from '../dom.js';
export function liveIndicators() { document.querySelectorAll('[data-live-item]').forEach(n => n.classList.toggle('hidden', !state.live.some(s => s.item === n.dataset.liveItem && isActive(s)))); }
export function renderTasks(chooseTask) {
    const container = byId('tasks');
    container.replaceChildren();
    byId('list-mode').setAttribute('aria-pressed', String(state.mode === 'list'));
    byId('board-mode').setAttribute('aria-pressed', String(state.mode === 'board'));
    if (!state.data) {
        byId('task-count').textContent = '';
        container.append(el('p', state.loaded ? 'Initialize the harness to add your first task.' : 'Loading project…', 'empty'));
        return;
    }
    if (!state.data.tasks.some(t => t.id === state.selectedItem) && !state.live.some(s => s.item === state.selectedItem)) {
        state.selectedItem = state.data.tasks[0]?.id || '';
        state.selectedRun = '';
    }
    if (state.selectedItem && state.requestedItem !== state.selectedItem) {
        state.requestedItem = state.selectedItem;
        send('selectTask', { id: state.selectedItem });
    }
    const query = byId('filter').value.toLowerCase(), tasks = state.data.tasks.filter(t => Object.values(t).join(' ').toLowerCase().includes(query));
    byId('task-count').textContent = tasks.length;
    if (!tasks.length) {
        container.append(el('p', query ? 'No matching tasks.' : 'Start here. Add your first task.', 'empty'));
        return;
    }
    if (state.mode === 'board') {
        const board = el('div', undefined, 'board');
        Object.entries(state.labels).forEach(([key, label]) => {
            const rows = tasks.filter(t => t.status === key);
            if (!rows.length)
                return;
            const column = el('section', undefined, 'column');
            column.append(el('h3', label + ' · ' + rows.length));
            rows.forEach(task => { const card = localButton('', () => chooseTask(task.id), 'card' + (task.id === state.selectedItem ? ' selected' : '')); card.append(el('div', task.id + ' · ' + task.priority, 'mono'), el('p', task.title)); column.append(card); });
            board.append(column);
        });
        container.append(board);
        return;
    }
    const t = el('table', undefined, 'task-table'), head = el('thead'), header = el('tr');
    ['ID', 'Task', 'Status'].forEach(k => header.append(el('th', k)));
    head.append(header);
    t.append(head);
    const body = el('tbody');
    tasks.forEach(task => {
        const tr = el('tr', undefined, task.id === state.selectedItem ? 'selected' : '');
        tr.tabIndex = 0;
        tr.setAttribute('aria-selected', String(task.id === state.selectedItem));
        tr.onclick = () => chooseTask(task.id);
        tr.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                chooseTask(task.id);
            }
            if (e.key === 'ArrowDown')
                tr.nextElementSibling?.focus();
            if (e.key === 'ArrowUp')
                tr.previousElementSibling?.focus();
        };
        tr.append(el('td', task.id, 'mono'));
        const title = el('td'), name = el('div', undefined, 'task-title');
        const marker = el('span', '●', 'live-dot');
        marker.dataset.liveItem = task.id;
        marker.classList.toggle('hidden', !state.live.some(s => s.item === task.id && isActive(s)));
        name.append(marker);
        name.append(document.createTextNode(task.title));
        title.append(name, el('div', [task.priority, task.area].filter(Boolean).join(' · '), 'task-subtitle'));
        tr.append(title);
        const st = el('td');
        st.append(status(task.status));
        tr.append(st);
        body.append(tr);
    });
    t.append(body);
    container.append(t);
    persist();
}

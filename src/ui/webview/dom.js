import { state, send, persist } from './state.js';
export { duration } from './duration';
export const byId = id => document.getElementById(id);
export function el(tag, value, cls) {
    const n = document.createElement(tag);
    if (value !== undefined)
        n.textContent = String(value);
    if (cls)
        n.className = cls;
    return n;
}
export function localButton(text, handler, cls) { const n = el('button', text, cls); n.onclick = handler; return n; }
export function button(text, action, extra = {}, cls) { return localButton(text, () => send(action, extra), cls); }
export function isActive(s) { return !s.finished && !['interrupted', 'failed', 'cancelled', 'completed', 'limit'].includes(s.status); }
export function status(value) { const n = el('span', undefined, 'status ' + value); n.append(el('span', undefined, 'dot'), document.createTextNode(state.labels[value] || value)); return n; }
export function dataTable(columns, rows, onOpen) { const wrap = el('div', undefined, 'table-scroll'), t = el('table', undefined, 'data-table'), head = el('thead'), h = el('tr'); columns.forEach(k => h.append(el('th', k))); head.append(h); t.append(head); const body = el('tbody'); rows.forEach(row => { const tr = el('tr'); columns.forEach((k, index) => { const cell = el('td'); if (onOpen && index === 0) cell.append(localButton(row[k] ?? '', () => onOpen(row), 'table-link')); else cell.textContent = row[k] ?? ''; tr.append(cell); }); body.append(tr); }); t.append(body); wrap.append(t); return wrap; }
export function section(title, key, content) {
    const details = el('details', undefined, 'context-section');
    details.open = state.sections.has(key);
    details.append(el('summary', title));
    const inner = el('div');
    inner.append(content);
    details.append(inner);
    details.ontoggle = () => {
        if (!details.isConnected)
            return;
        details.open ? state.sections.add(key) : state.sections.delete(key);
        persist();
    };
    return details;
}

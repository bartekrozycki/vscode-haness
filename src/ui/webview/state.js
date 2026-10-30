/** Browser state and the VS Code message bridge. No application services run here. */
const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
export const state = {
    saved, data: payload.snapshot, live: payload.live || [], liveVersion: 0, failure: payload.error, loaded: !!payload.snapshot || !!payload.error,
    contributions: { modules: [], widgets: [], actions: [] }, contributionItem: '',
    selectedItem: saved.item || '', selectedRun: saved.run || '', mode: saved.mode === 'board' ? 'board' : 'list', follow: saved.follow !== false,
    requestedRun: '', requestedItem: '', interacting: false,
    expanded: new Set(saved.expanded || []), collapsed: new Set(saved.collapsed || []), sections: new Set(saved.sections || []), positions: new Map(Object.entries(saved.positions || {})),
    labels: { ready: 'Ready', active: 'Active', review: 'Review', changes: 'Changes requested', blocked: 'Blocked', accepted: 'Accepted', closed: 'Closed' },
    phases: { starting: 'Starting', running: 'Running', waiting: 'Waiting for input', completed: 'Completed', failed: 'Error', cancelled: 'Cancelled', limit: 'Limit', interrupted: 'Interrupted', external: 'Another window', demo: 'Demo' }
};
export const send = (action, extra = {}) => vscode.postMessage({ action, ...extra });
export function persist() {
    vscode.setState({ item: state.selectedItem, run: state.selectedRun, mode: state.mode, follow: state.follow, expanded: [...state.expanded], collapsed: [...state.collapsed], sections: [...state.sections], positions: Object.fromEntries([...state.positions].slice(-60)), filter: document.getElementById('filter').value });
}

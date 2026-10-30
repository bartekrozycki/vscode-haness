import type { SdlcModule } from '../../contracts/api';
export const workItemPresentation: SdlcModule = {
    apiVersion: 1, id: 'core.workflow', title: 'Work items', version: '1.0.0',
    description: 'TSV tasks, change history and project lessons.',
    widgets: [
        { id: 'history', title: 'Task history', placement: 'task', order: 80, provide: ({ snapshot, item }) => {
                const rows = snapshot?.history.filter(row => row.item === item) || [];
                return rows.length ? { kind: 'table', columns: ['timestamp', 'event', 'actor', 'detail'], rows: rows.slice(-20).reverse() } : undefined;
            } },
        { id: 'lessons', title: 'Lessons', placement: 'task', order: 90, provide: ({ snapshot, item }) => {
                const rows = snapshot?.lessons.filter(row => row.item === item) || [];
                return rows.length ? { kind: 'table', columns: ['rule', 'weight', 'status'], rows } : undefined;
            } },
    ],
};

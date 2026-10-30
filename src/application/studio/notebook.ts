import type { StudioKind, StudioRecord, StudioStore } from '../../contracts/studio';
import type { ProjectGateway } from '../ports';
const prefixes: Record<StudioKind, string> = { initiative: 'INI', specification: 'SPEC', report: 'REP', prototype: 'PROTO', decision: 'DEC', proposal: 'PROP', research: 'TEAM' };
const statuses: Record<StudioKind, string[]> = {
    initiative: ['draft', 'exploring', 'defined', 'archived'], specification: ['draft', 'review', 'accepted', 'superseded'],
    report: ['draft', 'reviewed'], prototype: ['draft', 'reviewed', 'discarded'], decision: ['proposed', 'accepted', 'superseded'],
    proposal: ['draft', 'ready', 'promoted', 'discarded'], research: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
};
export const fibonacci = [1, 2, 3, 5, 8, 13, 21, 34, 55];
export class StudioNotebook {
    constructor(readonly store: StudioStore, private readonly projects: ProjectGateway) { }
    list(root: string) { return this.store.list(root); }
    async get(root: string, id: string) { const record = (await this.list(root)).find(r => r.id === id); if (!record)
        throw new Error(`Unknown studio record ${id}`); return record; }
    async write(root: string, kind: StudioKind, input: Record<string, unknown>) {
        return this.store.mutate(root, async (records) => {
            const existing = input.id ? records.find(r => r.id === input.id && r.kind === kind) : undefined;
            if (input.id && !existing)
                throw new Error('Unknown record');
            if (existing && input.revision !== existing.revision)
                throw new Error('Revision conflict: read the record again before editing.');
            if (existing?.status === 'promoted')
                throw new Error('A promoted proposal is immutable; edit its work item.');
            const parent = String(input.parent ?? existing?.parent ?? '');
            if (kind !== 'initiative' && !records.some(r => r.id === parent && r.kind === 'initiative'))
                throw new Error('parent must reference an initiative');
            const invalidated = existing?.status === 'accepted' && ['specification', 'decision'].includes(kind) ? (kind === 'specification' ? 'review' : 'proposed') : existing?.status;
            const status = String(input.status ?? invalidated ?? statuses[kind][0]);
            if (!statuses[kind].includes(status))
                throw new Error(`Invalid ${kind} status`);
            const estimate = input.estimate ?? existing?.estimate;
            if (estimate !== undefined && !fibonacci.includes(Number(estimate)))
                throw new Error('Estimate must be Fibonacci: ' + fibonacci.join(', '));
            const title = String(input.title ?? existing?.title ?? '').replace(/[\r\n\t]/g, ' ').trim();
            if (!title)
                throw new Error('Title is required');
            const data = { ...existing?.data, ...(input.data as Record<string, unknown> || {}) };
            if (kind === 'proposal' && status === 'ready') {
                if (!estimate || Number(estimate) > 13)
                    throw new Error('Ready proposals need a final estimate <=13; refine or decompose first.');
                const specification = records.find(r => r.id === data.specification && r.kind === 'specification' && r.parent === parent);
                if (!String(input.body ?? existing?.body ?? '').trim())
                    throw new Error('Ready proposals need requirements and acceptance criteria.');
                if (!specification || specification.status !== 'accepted')
                    throw new Error('Ready proposals require an accepted specification in the same initiative.');
                data.specificationRevision = specification.revision;
            }
            if (kind === 'specification' && status === 'accepted' && !String(input.body ?? existing?.body ?? '').trim())
                throw new Error('An accepted specification needs requirements and acceptance criteria.');
            if (data.parentProposal) {
                const parentProposal = records.find(r => r.id === data.parentProposal && r.kind === 'proposal' && r.parent === parent);
                if (!parentProposal || parentProposal.id === existing?.id)
                    throw new Error('Invalid parent proposal');
                let ancestor = parentProposal;
                const visited = new Set<string>();
                while (ancestor) {
                    if (visited.has(ancestor.id) || (existing && ancestor.data.parentProposal === existing.id))
                        throw new Error('Proposal dependency cycle');
                    visited.add(ancestor.id);
                    ancestor = records.find(r => r.id === ancestor.data.parentProposal)!;
                }
            }
            if (data.dependsOnProposals) {
                if (!Array.isArray(data.dependsOnProposals) || data.dependsOnProposals.some(id => typeof id !== 'string' || !records.some(r => r.id === id && r.kind === 'proposal' && r.parent === parent))) throw new Error('Invalid proposal dependencies');
                const visit = (id: string, chain: Set<string>) => {
                    if (id === existing?.id || chain.has(id)) throw new Error('Proposal dependency cycle');
                    const record = records.find(r => r.id === id)!;
                    for (const dependency of (record.data.dependsOnProposals as string[] || [])) visit(dependency, new Set([...chain, id]));
                };
                for (const dependency of data.dependsOnProposals as string[]) visit(dependency, new Set());
            }
            const id = existing?.id || `${prefixes[kind]}-${String(1 + Math.max(0, ...records.filter(r => r.kind === kind).map(r => Number(r.id.split('-')[1])))).padStart(3, '0')}`;
            const record: StudioRecord = { ...existing, id, kind, parent, title, status, revision: (existing?.revision || 0) + 1, estimate: estimate === undefined ? undefined : Number(estimate), data, body: String(input.body ?? existing?.body ?? ''), file: '', updated: new Date().toISOString() };
            if (existing)
                records.splice(records.indexOf(existing), 1, record);
            else
                records.push(record);
            return record;
        });
    }
    async promote(root: string, id: string, revision: number) {
        return this.store.mutate(root, async (records) => {
            const proposal = records.find(r => r.id === id && r.kind === 'proposal');
            if (!proposal)
                throw new Error('Unknown proposal');
            if (proposal.status === 'promoted')
                return { id: proposal.data.workItem, proposal: id };
            if (proposal.revision !== revision || proposal.status !== 'ready')
                throw new Error('Read the current ready proposal before promotion');
            const spec = records.find(r => r.id === proposal.data.specification && r.status === 'accepted');
            if (!spec || spec.revision !== proposal.data.specificationRevision)
                throw new Error('Specification changed; refine the proposal against its current accepted revision.');
            const dependencies = [...(proposal.data.dependencies as string[] || [])];
            for (const dependency of (proposal.data.dependsOnProposals as string[] || [])) {
                const prerequisite = records.find(r => r.id === dependency && r.kind === 'proposal');
                if (!prerequisite || prerequisite.status !== 'promoted') throw new Error(`Promote prerequisite ${dependency} first`);
                dependencies.push(String(prerequisite.data.workItem));
            }
            const client = this.projects.open(root), marker = `Studio proposal: ${id}`, snapshot = await client.snapshot();
            let workItem: string | undefined;
            // Recover a crash between harness creation and notebook commit without duplicating the task.
            for (const task of snapshot.tasks) {
                const doc = await client.invoke<{
                    body: string;
                }>({ operation: 'read', id: task.id });
                if (doc.body.includes(marker)) {
                    workItem = task.id;
                    break;
                }
            }
            if (!workItem) {
                const created = await client.invoke<{
                    id: string;
                }>({ operation: 'create', title: proposal.title, requirements: `${proposal.body}\n\n${marker}\nSpecification: ${spec.id} revision ${spec.revision}\n\n${spec.body}`, estimate: proposal.estimate, dependencies: [...new Set(dependencies)], actor: 'copilot-master' });
                workItem = created.id;
            }
            proposal.status = 'promoted';
            proposal.revision++;
            proposal.data.workItem = workItem;
            proposal.updated = new Date().toISOString();
            return { id: workItem, proposal: id, approved: false };
        });
    }
}

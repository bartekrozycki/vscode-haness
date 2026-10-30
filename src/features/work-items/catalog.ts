import type { ToolDefinition } from '../../contracts/model';
const str = (description: string) => ({ type: 'string', description });
const strings = { type: 'array', items: { type: 'string' } };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties: { workspacePath: str('Absolute workspace folder, required only with multiple projects open.'), ...properties }, required });
export const catalog: ToolDefinition[] = [
    { name: 'sdlc_initialize', displayName: 'SDLC: Initialize harness', readOnly: false,
        description: 'Create project-owned SDLC tools, agent definitions and empty TSV ledgers ONLY when the user explicitly requests initialization. Preserves existing files. Never initialize merely to answer a question.', inputSchema: schema({}) },
    { name: 'sdlc_tasks', mutatingOperations: ['reserve', 'gates'], displayName: 'SDLC: Tasks and gates', readOnly: true,
        description: 'Read/list tasks, get the next approved worker/judge task, reserve paths, or run project-configured gates against a clean Git commit. Requires initialized harness. reserve and gates mutate project state.',
        inputSchema: schema({ operation: { enum: ['list', 'read', 'next', 'reserve', 'gates'] }, id: str('WI-NNN task ID'), role: { enum: ['worker', 'judge'] }, status: str('Optional status filter'), files: strings, commit: str('Git commit to validate') }, ['operation']) },
    { name: 'sdlc_update_task', displayName: 'SDLC: Update task', readOnly: false,
        description: 'Create a task with explicit requirements, change its workflow status, approve work on explicit human request, or recover a stopped run. Review handoff requires passing gates and evidence; executor cannot accept their own work.',
        inputSchema: schema({ operation: { enum: ['create', 'update', 'approve', 'unblock', 'recover_run'] }, id: str('WI-NNN'), title: str('Task title'), requirements: str('Requirements and acceptance criteria in Markdown'),
            priority: { enum: ['MUST', 'SHOULD', 'COULD'] }, area: str('Project area'), estimate: { type: 'integer', minimum: 1, maximum: 55 }, dependencies: strings,
            status: { enum: ['ready', 'active', 'review', 'changes', 'accepted', 'closed', 'blocked'] }, commit: str('Commit for handoff'), evidence: str('Requirement-by-requirement handoff/review evidence'), reason: str('Block/recovery reason'), run: str('Interrupted run ID') }, ['operation']) },
    { name: 'sdlc_questions', displayName: 'SDLC: Questions and decisions', readOnly: false,
        description: 'Record a question with at least two options and a recommendation, or record a human answer. SDK agents may ask but cannot answer on the human’s behalf.',
        inputSchema: schema({ operation: { enum: ['ask', 'answer'] }, id: str('WI-NNN'), question: str('Question for the user'), options: { type: 'object', additionalProperties: { type: 'string' } }, recommended: str('Recommended option key'), question_id: str('P1, P2, ...'), answer: str('User-provided answer') }, ['operation', 'id']) },
    { name: 'sdlc_lessons', displayName: 'SDLC: Lessons', readOnly: false,
        description: 'Record evidenced lessons, count recurrence or independently confirm implementation. High/medium/low lessons require 1/2/3 occurrences. Read the metrics snapshot to list lessons.',
        inputSchema: schema({ operation: { enum: ['lesson', 'lesson_update'] }, id: str('Task ID for lesson; lesson ID for lesson_update'), rule: str('Concrete rule'), evidence: str('Evidence'), weight: { enum: ['high', 'medium', 'low'] }, kind: str('Problem category'), phase: str('Detection stage'), target: str('Where the change belongs'), status: { enum: ['recur', 'implemented'] } }, ['operation', 'id']) },
    { name: 'sdlc_metrics', displayName: 'SDLC: Metrics and state', readOnly: true,
        description: 'Read all task/history/question/lesson/run/usage TSV ledgers and project configuration. Does not initialize the project or run agents. Missing monetary cost remains unknown, never estimated as zero.', inputSchema: schema({}) },
    { name: 'sdlc_run', displayName: 'SDLC: Agent session', readOnly: false,
        description: 'Start one fresh session through the configured agent executor (Copilot SDK by default) for a task, only on explicit user request. Role must be allowed by workflow.agentsByStatus for the current task status; read sdlc_metrics for available agentActions. Workers need prior human task approval. AI executors may consume provider usage. No automatic background runs.',
        inputSchema: schema({ id: str('WI-NNN'), role: str('Agent suffix from .github/agents/sdlc-ROLE.agent.md; defaults: planner, worker, judge'), prompt: str('Optional additional instructions'), executor: str('Optional explicit executor ID; otherwise use the agent / role / project configuration') }, ['id', 'role']) },
    { name: 'sdlc_project_tool', displayName: 'SDLC: Project tool', readOnly: false,
        description: 'List or invoke project-defined tools from .copilot-sdlc/tools/*.json. Use list first. Definitions contain JSON Schema and an argv command. Shell interpolation is never used.',
        inputSchema: schema({ operation: { enum: ['list', 'invoke'] }, name: str('Project tool name'), input: { type: 'object', additionalProperties: true } }, ['operation']) },
];

import type { ToolContext, ToolDefinition } from '../../contracts/model';
import { catalog } from './catalog';
export function authorizeWorkItemTool(definition: ToolDefinition, input: Record<string, unknown>, context: ToolContext) {
    const operation = input.operation as string | undefined;
    if (context.role && ['approve', 'answer', 'unblock', 'recover_run'].includes(operation ?? ''))
        throw new Error('This action requires a human request in VS Code');
    if (context.item && input.id && input.id !== context.item && operation !== 'lesson_update')
        throw new Error(`Session is scoped to ${context.item}`);
    if (context.role === 'judge' && (['create', 'reserve'].includes(operation ?? '') || (operation === 'update' && !['accepted', 'changes', 'blocked'].includes(String(input.status)))))
        throw new Error('Judge can only read, check and record a verdict');
    if (context.role === 'worker' && operation === 'update' && ['accepted', 'changes', 'closed'].includes(String(input.status)))
        throw new Error('Worker cannot review or close work');
    if (context.role === 'judge' && !definition.readOnly && !catalog.some(t => t.name === definition.name))
        throw new Error('Judge cannot run mutating project tools');
}
export function sessionTools(definitions: ToolDefinition[]) {
    return definitions.filter(t => !['sdlc_initialize', 'sdlc_run'].includes(t.name));
}

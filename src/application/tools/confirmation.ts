import type { ToolDefinition } from '../../contracts/model';
/** Feature-owned metadata keeps operation names out of the VS Code adapter. */
export function toolMutates(definition: ToolDefinition, input: Record<string, unknown>): boolean {
    const operation = String(input.operation || '');
    if (definition.mutatingOperations?.includes(operation)) return true;
    if (definition.readOnlyOperations?.includes(operation)) return false;
    return !definition.readOnly;
}

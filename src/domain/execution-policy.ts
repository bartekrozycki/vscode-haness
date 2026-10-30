import type { AgentDefinition, ProjectConfig } from '../contracts/model';
export const DEFAULT_EXECUTOR = 'copilot-sdk';
export const isExecutorId = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(id) && id.length <= 100;
export function selectExecutor(config: ProjectConfig, role: string, agent?: AgentDefinition, override?: string): string {
    const roles = config.execution?.roles;
    return override ?? agent?.executor ?? (roles && Object.hasOwn(roles, role) ? roles[role] : undefined) ?? config.execution?.default ?? DEFAULT_EXECUTOR;
}
export function validateExecution(config: ProjectConfig): void {
    const value = config.execution;
    if (value === undefined)
        return;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['default', 'roles', 'options'].includes(k)))
        throw new Error('Niepoprawne execution w konfiguracji projektu.');
    if (value.default !== undefined && !isExecutorId(value.default))
        throw new Error('Niepoprawne execution.default.');
    if (value.roles !== undefined && (!value.roles || typeof value.roles !== 'object' || Array.isArray(value.roles) || Object.entries(value.roles).some(([role, id]) => !/^[a-z][a-z0-9_-]{0,62}$/.test(role) || !isExecutorId(id))))
        throw new Error('Niepoprawne execution.roles.');
    if (value.options !== undefined && (!value.options || typeof value.options !== 'object' || Array.isArray(value.options) || Object.entries(value.options).some(([id, options]) => !isExecutorId(id) || !options || typeof options !== 'object' || Array.isArray(options))))
        throw new Error('Niepoprawne execution.options.');
}

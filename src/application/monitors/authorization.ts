import type { AutomationRequest } from '../../contracts/automation';
import type { MonitorDefinition, MonitorTrigger } from '../../contracts/monitors';

/** A definition grant cannot authorize a different request merely sharing an event ID. */
export function matchesGrantedTrigger(request: AutomationRequest, trigger: MonitorTrigger, definition: MonitorDefinition): boolean {
    const action = definition.action;
    if (!action || !action.armed || request.status !== 'pending' || request.kind !== trigger.action || request.publication || JSON.stringify(request.trigger) !== JSON.stringify(trigger)) return false;
    return definition.id === trigger.monitorId && definition.connectionId === trigger.connectionId && action.kind === trigger.action && trigger.armed === true &&
        action.taskId === trigger.taskId && action.researchFocus === trigger.researchFocus && action.estimate === trigger.estimate &&
        action.timeoutSeconds === trigger.timeoutSeconds && action.maxTokens === trigger.maxTokens && action.maxParallel === trigger.maxParallel;
}

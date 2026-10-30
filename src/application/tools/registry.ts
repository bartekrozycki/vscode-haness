import type { ToolContext, ToolDefinition } from '../../contracts/model';
import type { ToolHandler } from '../../contracts/api';
import type { ProjectToolCatalog, SchemaValidator, ToolRegistrar } from '../ports';
export interface ToolRegistryOptions {
    schemas: SchemaValidator;
    projectTools: ProjectToolCatalog;
    authorize?(definition: ToolDefinition, input: Record<string, unknown>, context: ToolContext): void;
}
/** Discovery, validation and dispatch only. Features own handlers and authorization policy. */
export class ToolRegistry implements ToolRegistrar {
    private readonly registered = new Map<string, {
        definition: ToolDefinition;
        handler: ToolHandler;
    }>();
    constructor(private readonly services: ToolRegistryOptions) { }
    registerTool(definition: ToolDefinition, handler: ToolHandler) {
        if (!/^[a-z][a-z0-9_]{2,63}$/.test(definition.name) || this.registered.has(definition.name))
            throw new Error('Invalid or duplicate tool name');
        this.services.schemas.assertSchema(definition.inputSchema);
        const name = definition.name, owned = { definition: structuredClone(definition), handler };
        this.registered.set(name, owned);
        return { dispose: () => { if (this.registered.get(name) === owned)
                this.registered.delete(name); } };
    }
    async definitions(root: string) {
        const definitions = [...this.registered.values()].map(t => t.definition);
        for (const definition of await this.services.projectTools.definitions(root)) {
            if (definitions.some(t => t.name === definition.name))
                throw new Error(`Invalid/duplicate project tool: ${definition.name}`);
            this.services.schemas.assertSchema(definition.inputSchema);
            definitions.push(definition);
        }
        return definitions;
    }
    async invoke(name: string, input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
        const definition = (await this.definitions(context.root)).find(t => t.name === name);
        if (!definition)
            throw new Error(`Unknown tool: ${name}`);
        this.services.schemas.validate(definition.inputSchema, input);
        this.services.authorize?.(definition, input, context);
        const registered = this.registered.get(name);
        return registered ? registered.handler(input, context) : this.services.projectTools.execute(definition, input, context);
    }
}

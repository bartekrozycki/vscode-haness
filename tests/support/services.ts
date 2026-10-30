import { ToolRegistry as CoreToolRegistry } from '../../src/application/tools/registry';
import { PythonProjectGateway } from '../../src/infrastructure/project/gateway';
import { AjvValidator } from '../../src/infrastructure/schema/ajv-validator';
import { JsonProjectTools } from '../../src/infrastructure/project-tools/json-tools';
import { FileSessionLog } from '../../src/infrastructure/sessions/file-session-log';
import { readProjectSnapshot } from '../../src/application/queries/project-snapshot';
import { workItemsModule } from '../../src/features/work-items/module';
import { authorizeWorkItemTool, sessionTools } from '../../src/features/work-items/tool-policy';
import { SessionRunner, type RuntimeHost } from '../../src/application/sessions/runner';
import type { ExecutorRegistry } from '../../src/application/executors/registry';
import type { Snapshot } from '../../src/contracts/model';
import type { ToolHandler } from '../../src/contracts/api';

/** Integration fixture: the same adapters and feature module as the production composition. */
export class TestToolRegistry extends CoreToolRegistry {
  constructor(readonly resources: string, readonly python: () => string, run: ToolHandler, snapshot?: (root: string, signal?: AbortSignal) => Promise<Snapshot>) {
    super({ schemas: new AjvValidator(), projectTools: new JsonProjectTools(), authorize: authorizeWorkItemTool });
    const projects = new PythonProjectGateway(resources, python);
    const module = workItemsModule({ projects, tools: this, run, snapshot: snapshot || ((root, signal) => readProjectSnapshot(projects, root, signal)) });
    for (const tool of module.tools || []) this.registerTool(tool.definition, tool.invoke);
  }
}
export function testRunnerServices(tools: TestToolRegistry, python: () => string, host: RuntimeHost, executors: ExecutorRegistry) {
  return { tools, projects: new PythonProjectGateway(tools.resources, python), host, executors,
    live: new FileSessionLog(root => host.liveChanged?.(root)), sessionTools };
}

export function testRunner(...args: Parameters<typeof testRunnerServices>) {
  return new SessionRunner(testRunnerServices(...args));
}

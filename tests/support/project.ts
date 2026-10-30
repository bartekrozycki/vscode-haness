import { HarnessClient } from '../../src/infrastructure/project/client';
import { PythonProjectGateway } from '../../src/infrastructure/project/gateway';
import { readProjectSnapshot } from '../../src/application/queries/project-snapshot';
export { initialize } from '../../src/infrastructure/project/initialize';
export { loadAgents } from '../../src/infrastructure/project/agent-loader';
export { projectPath, exists } from '../../src/infrastructure/files/project-paths';
export class TestProjectClient extends HarnessClient {
  agentSnapshot(signal?: AbortSignal) { return readProjectSnapshot(new PythonProjectGateway('', () => this.python), this.root, signal); }
}

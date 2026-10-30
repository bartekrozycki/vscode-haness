import type { ProjectGateway } from '../../application/ports';
import { HarnessClient } from './client';
import { initialize } from './initialize';
export class PythonProjectGateway implements ProjectGateway {
    constructor(private readonly resources: string, private readonly python: () => string, private readonly processEnvironment?: (root: string) => Promise<NodeJS.ProcessEnv>) { }
    open(root: string) { return new HarnessClient(root, this.python(), this.processEnvironment); }
    initialize(root: string) { return initialize(root, this.resources); }
}

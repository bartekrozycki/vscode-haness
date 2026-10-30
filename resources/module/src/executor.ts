import type { AgentExecutor } from '../sdk/api';

/** An opt-in example. Replace createSession with your own CLI / SDK transport. */
export const echoExecutor: AgentExecutor = {
  apiVersion: 1, id: '{{id}}.echo', title: '{{title}}: model-free example',
  description: 'Executor contract example. It does not implement tasks or call AI.',
  async createSession(request) {
    let stopped = false;
    return {
      id: `echo-${request.run}`,
      async run() {
        request.signal.throwIfAborted();
        if (stopped) return;
        request.emit({ type: 'turn.start' });
        request.emit({ type: 'message', messageId: 'example', model: 'no model', text: `Executor running for ${request.item} (${request.role}). This demonstrates the adapter without calling a model. The task has not been implemented or approved.` });
        request.emit({ type: 'turn.end' });
      },
      async abort() { stopped = true; },
      async dispose() { /* close clients, processes and event subscriptions here */ },
    };
  },
};

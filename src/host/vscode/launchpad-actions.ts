import type { AppServices } from '../../application/services';
import type { EnvironmentStatus } from '../../contracts/environment';

interface EnvironmentActions {
    read(root?: string): Promise<EnvironmentStatus>;
    save(paths: unknown, root?: string): Promise<EnvironmentStatus>;
    setCredential(name: unknown, root?: string): Promise<EnvironmentStatus>;
    deleteCredential(name: unknown, root?: string): Promise<EnvironmentStatus>;
}
interface LaunchpadDependencies {
    services: Pick<AppServices, 'suggestions' | 'studio' | 'files' | 'modules'>;
    environment: EnvironmentActions;
    workspace: { trust(): void };
    workbench: { post(root: string, message: Record<string, unknown>): void };
    openFile(path: string): Promise<unknown>;
    onboarding: { get(root: string): boolean; set(root: string, dismissed: boolean): PromiseLike<void> };
    fallback(root: string, message: Record<string, unknown>): Promise<void>;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const starterTasks = [
    { title: 'Define the first project outcome', requirements: 'Describe the user outcome, scope, acceptance criteria and a meaningful verification command.' },
    { title: 'Configure project quality gates', requirements: 'Select checks appropriate to this project and record how to run them against a clean commit.' },
];

/** Route launchpad actions through injected host capabilities; no secrets enter webview messages. */
export function createLaunchpadActions({ services, environment, workspace, workbench, openFile, onboarding, fallback }: LaunchpadDependencies) {
    return async (root: string, message: Record<string, unknown>): Promise<void> => {
        const action = message.action;
        if (action === 'onboardingRead' || action === 'onboardingDismiss' || action === 'onboardingShow') {
            if (action !== 'onboardingRead') await onboarding.set(root, action === 'onboardingDismiss');
            workbench.post(root, { type: 'onboardingPreference', dismissed: onboarding.get(root) });
            return;
        }
        if (['environmentRead', 'environmentSave', 'credentialSet', 'credentialDelete'].includes(String(action))) {
            try {
                workspace.trust();
                const value = action === 'environmentSave' ? await environment.save(message.paths, root)
                    : action === 'credentialSet' ? await environment.setCredential(message.name, root)
                    : action === 'credentialDelete' ? await environment.deleteCredential(message.name, root)
                    : await environment.read(root);
                workbench.post(root, { type: 'environment', environment: value });
            } catch (error) { workbench.post(root, { type: 'environment', error: errorText(error) }); }
            return;
        }
        if (action === 'suggestTasks' || action === 'createSuggestedTasks') {
            try {
                workspace.trust();
                if (!services.suggestions) throw new Error('Task suggestions are unavailable.');
                if (action === 'suggestTasks') services.suggestions.propose(root, 'Starter templates', starterTasks);
                else { await services.suggestions.create(root, message.tasks); services.modules.emit({ type: 'workspace.changed', root }); }
            } catch (error) { workbench.post(root, { type: 'taskSuggestions', error: errorText(error) }); }
            return;
        }
        workspace.trust();
        if (action === 'openStudioRecord' || action === 'openStudioFile') {
            if (!services.studio) throw new Error('Planning records are unavailable.');
            const record = await services.studio.get(root, String(message.id));
            if (action === 'openStudioRecord') workbench.post(root, { type: 'studioRecord', record });
            else if (record.file) await openFile(await services.files.resolve(root, record.file));
            return;
        }
        await fallback(root, message);
    };
}

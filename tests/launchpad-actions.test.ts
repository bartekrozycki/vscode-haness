import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchpadActions } from '../src/host/vscode/launchpad-actions';

test('environment failures reach the workbench and credential values stay in the host', async () => {
    const messages: Record<string, unknown>[] = [];
    const calls: unknown[][] = [];
    const handler = createLaunchpadActions({
        services: {}, workspace: { trust() {} }, workbench: { post: (_root: string, message: Record<string, unknown>) => messages.push(message) },
        environment: { read: async () => { throw new Error('Discovery failed'); }, save: async () => { throw new Error('Invalid path'); },
            setCredential: async (...args: unknown[]) => { calls.push(args); return { tools: [], credentials: [] }; } },
        onboarding: { get: () => false, set: async () => {} }, openFile: async () => {}, fallback: async () => {},
    } as unknown as Parameters<typeof createLaunchpadActions>[0]);
    await handler('/project', { action: 'environmentRead' });
    await handler('/project', { action: 'environmentSave', paths: {} });
    await handler('/project', { action: 'credentialSet', name: 'githubToken' });
    assert.deepEqual(messages.slice(0, 2), [{ type: 'environment', error: 'Discovery failed' }, { type: 'environment', error: 'Invalid path' }]);
    assert.deepEqual(calls, [['githubToken', '/project']]);
    assert.deepEqual(messages[2], { type: 'environment', environment: { tools: [], credentials: [] } });
});

test('suggestion failures return an error without replacing local drafts', async () => {
    const messages: Record<string, unknown>[] = [];
    const handler = createLaunchpadActions({
        services: { suggestions: { create: async () => { throw new Error('Initialize first'); } } }, workspace: { trust() {} },
        workbench: { post: (_root: string, message: Record<string, unknown>) => messages.push(message) }, environment: {},
        onboarding: { get: () => false, set: async () => {} }, openFile: async () => {}, fallback: async () => {},
    } as unknown as Parameters<typeof createLaunchpadActions>[0]);
    await handler('/project', { action: 'createSuggestedTasks', tasks: [{ title: 'Edited draft' }] });
    assert.deepEqual(messages, [{ type: 'taskSuggestions', error: 'Initialize first' }]);
});

test('planning record actions read the requested record and open its resolved project file', async () => {
    const messages: Record<string, unknown>[] = [], opened: string[] = [];
    const record = { id: 'IN-001', file: 'studio/initiative.md', title: 'Plan' };
    const handler = createLaunchpadActions({
        services: { studio: { get: async (root: string, id: string) => { assert.equal(root, '/project'); assert.equal(id, record.id); return record; } },
            files: { resolve: async (root: string, file: string) => `${root}/${file}` } },
        workspace: { trust() {} }, workbench: { post: (_root: string, message: Record<string, unknown>) => messages.push(message) }, environment: {},
        onboarding: { get: () => false, set: async () => {} }, openFile: async (path: string) => { opened.push(path); }, fallback: async () => {},
    } as unknown as Parameters<typeof createLaunchpadActions>[0]);
    await handler('/project', { action: 'openStudioRecord', id: record.id });
    await handler('/project', { action: 'openStudioFile', id: record.id });
    assert.deepEqual(messages, [{ type: 'studioRecord', record }]);
    assert.deepEqual(opened, ['/project/studio/initiative.md']);
});

test('onboarding dismissal is saved per project and can be restored', async () => {
    const settings = new Map<string, boolean>(), messages: Record<string, unknown>[] = [];
    const handler = createLaunchpadActions({ services: {}, environment: {}, workspace: { trust() {} },
        workbench: { post: (_root: string, message: Record<string, unknown>) => messages.push(message) },
        onboarding: { get: (root: string) => settings.get(root) || false, set: async (root: string, value: boolean) => { settings.set(root, value); } },
        openFile: async () => {}, fallback: async () => {},
    } as unknown as Parameters<typeof createLaunchpadActions>[0]);
    await handler('/one', { action: 'onboardingDismiss' });
    await handler('/two', { action: 'onboardingRead' });
    await handler('/one', { action: 'onboardingRead' });
    await handler('/one', { action: 'onboardingShow' });
    assert.deepEqual(messages.map(m => m.dismissed), [true, false, true, false]);
});

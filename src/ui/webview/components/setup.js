import { state, send } from '../state.js';
import { byId, el, localButton } from '../dom.js';

const toolNames = { git: 'Git', node: 'Node.js', java: 'Java', python: 'Python' };
const credentialNames = { githubToken: 'GitHub token', openaiApiKey: 'OpenAI API key' };
let suggestions = [];
let suggestionsPending = false;
export function setSuggestionsPending(value) {
    suggestionsPending = value; byId('suggest-tasks').disabled = value;
    const create = byId('create-suggestions'); if (create) create.disabled = value || !state.data;
}
let onboardingDismissed = false;
export function setOnboardingDismissed(value) { onboardingDismissed = !!value; renderOnboarding(state.loaded, state.data, state.failure); }
export function suggestionStatus(message, isError = false) {
    if (isError) setSuggestionsPending(false);
    let status = byId('suggestion-status');
    if (!status) { status = el('p', undefined, 'muted'); status.id = 'suggestion-status'; status.setAttribute('role', 'status'); byId('suggestion-area').append(status); }
    status.textContent = message; status.className = isError ? 'error' : 'muted';
}

export function renderEnvironment(environment, error) {
    if (error) {
        let status = byId('environment-status');
        if (!status) { status = el('p'); status.id = 'environment-status'; status.setAttribute('role', 'status'); byId('environment-content').replaceChildren(status, localButton('Check again', () => send('environmentRead'), 'small')); }
        status.className = 'error settings-status'; status.textContent = error;
        return;
    }
    const content = byId('environment-content');
    content.replaceChildren();
    const intro = el('p', 'Configure executable paths for this workspace. Leave a path empty to use automatic detection.', 'muted settings-intro');
    const form = el('form');
    const fields = {};
    for (const item of environment.tools || []) {
        if (!toolNames[item.tool]) continue;
        const row = el('div', undefined, 'environment-row');
        const label = el('label', toolNames[item.tool]);
        const input = el('input');
        input.id = 'path-' + item.tool;
        input.value = item.configuredPath || '';
        input.placeholder = 'Automatic detection';
        label.htmlFor = input.id;
        fields[item.tool] = input;
        const detail = el('p', item.error ? item.error : [item.version, item.executable && 'Detected: ' + item.executable].filter(Boolean).join(' · ') || 'Not detected. Set an executable path.', item.error ? 'error environment-detail' : 'muted environment-detail');
        row.append(label, input, detail);
        form.append(row);
    }
    const actions = el('div', undefined, 'settings-actions');
    const save = el('button', 'Save paths', 'primary'); save.type = 'submit';
    const refresh = localButton('Check again', () => { byId('environment-status').textContent = 'Checking environment…'; send('environmentRead'); }); refresh.type = 'button';
    actions.append(save, refresh);
    form.append(actions);
    form.onsubmit = event => { event.preventDefault(); byId('environment-status').textContent = 'Saving paths…'; send('environmentSave', { paths: Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()])) }); };
    const credentials = el('section', undefined, 'settings-section');
    credentials.append(el('h3', 'Credentials'), el('p', 'Secrets are stored securely by VS Code. Enter them in the native prompt.', 'muted'));
    for (const item of environment.credentials || []) {
        if (!credentialNames[item.name]) continue;
        const row = el('div', undefined, 'credential-row');
        const label = el('div'); label.append(el('strong', credentialNames[item.name]), el('p', (item.configured ? 'Configured' : 'Not configured') + (item.name === 'openaiApiKey' ? ' · Stored only — no provider connected' : ' · Used by the Copilot SDK'), 'muted'));
        const set = localButton(item.configured ? 'Replace' : 'Set', () => send('credentialSet', { name: item.name }), 'small');
        row.append(label, set);
        if (item.configured) row.append(localButton('Remove', () => send('credentialDelete', { name: item.name }), 'small'));
        credentials.append(row);
    }
    const tools = el('section', undefined, 'settings-section');
    tools.append(el('h3', 'Project tools'), el('p', 'Reload tools after changing project definitions. Refresh updates project data and session status.', 'muted'));
    const toolActions = el('div', undefined, 'settings-actions');
    toolActions.append(localButton('Reload project tools', () => { byId('environment-status').textContent = 'Reload requested.'; send('reload'); }, 'small'), localButton('Refresh project', () => { byId('environment-status').textContent = 'Refreshing project…'; send('refresh'); }, 'small'));
    tools.append(toolActions);
    const status = el('p', 'Environment checked.', 'muted settings-status'); status.id = 'environment-status'; status.setAttribute('role', 'status');
    content.append(intro, form, credentials, tools, status);
}

export function renderOnboarding(loaded, data, failure) {
    const onboarding = byId('onboarding');
    const visible = loaded && !failure && (!data || !(data.tasks || []).length);
    onboarding.classList.toggle('hidden', onboardingDismissed || (!visible && !suggestions.length));
    byId('show-onboarding').classList.toggle('hidden', !onboardingDismissed || (!visible && !suggestions.length));
    byId('initialize').classList.toggle('hidden', !!data);
    const create = byId('create-suggestions'); if (create) create.disabled = suggestionsPending || !data;
    const status = byId('suggestion-status'); if (status) status.textContent = data ? 'Tasks will be created unapproved.' : 'Initialize the project before creating these tasks.';
    byId('onboarding-description').textContent = data ? 'Start with a task, or review a few optional starter drafts.' : 'Initialize a project-owned harness to track tasks, decisions, and agent sessions. Existing files are preserved.';
    byId('onboarding-title').textContent = data ? 'Plan your first task' : 'Bring your project into the workbench';
}

export function renderSuggestions(items, source) {
    setSuggestionsPending(false);
    const previous = suggestions;
    suggestions = Array.isArray(items) ? items.map(item => { const draft = previous.find(value => value.id && value.id === item.id); return draft ? { ...item, title: draft.title, requirements: draft.requirements, selected: draft.selected } : { ...item }; }) : [];
    const area = byId('suggestion-area'); area.replaceChildren();
    onboardingDismissed = false; byId('onboarding').classList.remove('hidden'); byId('show-onboarding').classList.add('hidden');
    if (!suggestions.length) { if (source !== 'created') area.append(el('p', 'No suggestions available. You can create a task yourself.', 'muted')); renderOnboarding(state.loaded, state.data, state.failure); return; }
    area.append(el('h3', 'Draft suggestions'), el('p', source ? 'Source: ' + source : 'Choose and edit the drafts you want to create.', 'muted'));
    suggestions.forEach((item, index) => {
        const row = el('div', undefined, 'suggestion');
        const choice = el('input'); choice.type = 'checkbox'; choice.checked = item.selected !== false; choice.id = 'suggestion-' + index;
        const label = el('label', 'Include task ' + (index + 1)); label.htmlFor = choice.id; label.className = 'suggestion-choice';
        const title = el('input'); title.value = item.title || ''; title.setAttribute('aria-label', 'Task title ' + (index + 1));
        const requirements = el('textarea'); requirements.value = item.requirements || ''; requirements.rows = 3; requirements.setAttribute('aria-label', 'Task requirements ' + (index + 1));
        choice.onchange = () => { item.selected = choice.checked; }; item.selected = choice.checked;
        title.oninput = () => { item.title = title.value; }; requirements.oninput = () => { item.requirements = requirements.value; };
        row.append(choice, label, title, requirements); area.append(row);
    });
    const create = localButton('Create selected tasks', () => {
        const tasks = suggestions.filter(item => item.selected && item.title.trim()).map(({ selected, ...item }) => item);
        if (!tasks.length) { byId('suggestion-status').textContent = 'Select at least one task with a title.'; return; }
        setSuggestionsPending(true); send('createSuggestedTasks', { tasks }); byId('suggestion-status').textContent = 'Creating selected tasks…';
    }, 'primary');
    create.id = 'create-suggestions'; create.disabled = !state.data;
    const status = el('p', state.data ? 'Tasks will be created unapproved.' : 'Initialize the project before creating these tasks.', 'muted'); status.id = 'suggestion-status'; status.setAttribute('role', 'status');
    area.append(create, status);
}

# Copilot project settings

The initialized project supplies skills in `.github/skills/`, a native Copilot skill location. VS Code enables agent skills by default, so normally no settings change is needed. If `chat.useAgentSkills` is disabled, a user can review this workspace-folder JSON patch:

```json
[{ "op": "add", "path": "/chat.useAgentSkills", "value": true }]
```

Use `replace` instead of `add` when the folder setting already exists. The proposal affects skill discovery, not whether a model chooses to invoke a skill. It does not change terminal or tool approvals. The extension's native language-model tools are registered separately; their availability depends on the active Copilot environment and selected tools. If an agent instead requests a shell command, VS Code's normal confirmation controls still apply.

The extension can apply an explicitly approved proposal with VS Code's configuration API, which updates the folder setting while preserving unrelated settings and JSONC comments. It rechecks the proposal before writing. Alternatively, edit `.vscode/settings.json` yourself and add `"chat.useAgentSkills": true` to the existing object. Do not replace the file. Organizational policy may override the setting.

References: [VS Code agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), [AI settings reference](https://code.visualstudio.com/docs/agents/reference/ai-settings), [tool approvals](https://code.visualstudio.com/docs/copilot/chat/chat-tools).

# Connected services and monitors

Connect Jira Server/Data Center, Confluence Server/Data Center, Bitbucket Server/Data Center, or GitHub to read external material and prepare supervised workflows. The extension uses provider REST APIs; polling does not invoke a language model. External text is evidence, not an instruction or approval.

## Configure a connection

In a trusted workspace, open the workbench and select **Monitors**. Under **Connections**, expand **Add connection** and supply a unique connection ID, the provider, its base URL, and authentication type. Save it, expand the connection, and select **Set credential…**. Enter the token or username and password in the native prompts. For example:

| ID | Provider | Base URL | Authentication |
| --- | --- | --- | --- |
| `jira-main` | `jira` | `https://jira.example.test/jira` | `token` or `basic` |
| `wiki-main` | `confluence` | `https://wiki.example.test/confluence` | `token` or `basic` |
| `code-main` | `bitbucket` | `https://code.example.test/bitbucket` | `token` or `basic` |
| `github-main` | `github` | `https://api.github.com` | `token` |

Use the actual installation's context path if it has one. URL credentials, query strings, and fragments are rejected. HTTPS is required except for HTTP on localhost. The token option sends a bearer token; basic authentication uses the entered username and password. Server capabilities and policies vary: ensure the selected authentication method is supported and the account has the necessary permissions.

Credentials are stored in VS Code Secret Storage and are not synced across machines. On desktop, VS Code uses Electron safeStorage; Electron documents macOS Keychain and Windows DPAPI as the corresponding key providers. See the [VS Code extension storage documentation](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) and [Electron safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage). Connection metadata and credential presence are shown in the workbench; the credential itself is not sent through the webview. Changing a connection's URL, provider, or authentication type clears its stored credential. Removing a connection deletes its credential.

## Read connected data

The `sdlc_connections` tool only performs reads. These examples show tool inputs; replace the IDs and query values with your own.

List profiles:

```json
{"operation":"list"}
```

Search Jira with JQL or read an issue and its comments:

```json
{"operation":"search","connectionId":"jira-main","params":{"jql":"project = DEMO ORDER BY updated DESC","start":0,"limit":25}}
```

```json
{"operation":"read","connectionId":"jira-main","params":{"issueKey":"DEMO-42"}}
```

```json
{"operation":"comments","connectionId":"jira-main","params":{"issueKey":"DEMO-42","start":0,"limit":25}}
```

Search Confluence with CQL or read a page, including its storage-format body and version:

```json
{"operation":"search","connectionId":"wiki-main","params":{"cql":"space = DEMO AND type = page","start":0,"limit":25}}
```

```json
{"operation":"read","connectionId":"wiki-main","params":{"pageId":"12345"}}
```

Read a GitHub pull request and its conversation or review comments:

```json
{"operation":"readPullRequest","connectionId":"github-main","params":{"owner":"example-org","repo":"example-repo","pullRequestId":42}}
```

```json
{"operation":"reviewComments","connectionId":"github-main","params":{"owner":"example-org","repo":"example-repo","pullRequestId":42,"page":1,"limit":25}}
```

Use `comments` for GitHub conversation comments. Bitbucket uses `project` instead of `owner`, `start` instead of `page`, and returns pull-request activity for `comments`, including comments and other activity. Both providers support `pullRequests` to list requests. Provider responses retain their native JSON shape.

Each request returns one page, with a maximum requested page size of 100 and a default of 25. Use the provider's returned pagination information to request another page. Requests time out after 15 seconds, reject redirects, and limit each response to 2 MB. HTTP failures report the status without exposing the server's response body.

## Define and operate monitors

A monitor has a local definition, is paused when first defined, and must be activated. The first successful poll establishes a baseline; subsequent changes generate events. Define one with `sdlc_monitors`:

```json
{
  "operation": "define",
  "definition": {
    "id": "needs-refinement",
    "name": "Issues ready for refinement",
    "provider": "jira",
    "connectionId": "jira-main",
    "intervalSeconds": 300,
    "query": {"jql": "project = DEMO", "label": "needs-refinement"},
    "action": {
      "kind": "refine",
      "researchFocus": "Refine the selected issue into testable requirements",
      "estimate": 8,
      "timeoutSeconds": 300,
      "maxTokens": 60000,
      "maxParallel": 3
    }
  }
}
```

Activate with `{"operation":"activate","id":"needs-refinement"}`. Use `poll`, `pause`, `list`, or `events` through the same tool, or use the controls in **Monitors**. Polling intervals range from 60 to 86,400 seconds. Active monitors run only while the extension host is running in the trusted workspace; they do not run as a cloud service while it is closed. Monitor status includes poll count, error count, last duration, and last poll time.

Jira monitors use JQL and optionally a label or `commentContains`. GitHub and Bitbucket monitors target one pull request using `owner` or `project`, `repo`, and numeric `pullRequestId`; GitHub can filter by a pull-request label. Bitbucket does not support label filtering. `commentContains` is a case-sensitive substring filter. Monitor polling uses pages of 50, at most 10 pages per paged collection, and reports an error if the limit is exceeded; narrow the query before trying again. Jira comment monitoring also requests comments for each returned issue.

A matching event with an action creates a workflow request. For an unarmed monitor, the request remains **pending** until a person approves it. To permit automatic execution, define the monitor with `action.armed: true` and explicitly grant it through the native review, which shows the exact monitor definition and connection destination. An armed monitor with a valid matching private grant may automatically start bounded refinement or implementation for matching events; changing the definition or connection destination invalidates that grant. Refinement uses the configured executor and can consume model usage. The Fibonacci estimate must be 1, 2, 3, 5, 8, 13, 21, 34, or 55. Research defaults are 300 seconds, 60,000 tokens, and three parallel specialists; the allowed ranges are 5–1,800 seconds, 1–1,000,000 tokens, and 1–5 parallel specialists. Estimates above 13 include a decomposition specialist.

Implementation monitors require a locally mapped task, the `hanes-implement` label, and a human-approved, unblocked task. Unarmed implementation requests require workflow approval; armed requests may run under the matching native grant described above. The worker and judge operate within the existing task workflow; remote labels and comments do not approve work. At most three worker/judge rounds run in one request.

## Propose and approve publication

`sdlc_automation` creates a proposal rather than performing a remote write. Review a pending request in **Monitors → Workflow requests**, then choose **Approve** or **Dismiss**. Publication is never covered by an armed monitor grant. Approval opens the full request for review; a remote write requires a further native confirmation of the exact destination, method, path, and body. If an operation is interrupted or its outcome is uncertain, inspect the provider before trying again.

For example, propose a Confluence page in storage-format XHTML:

```json
{
  "operation": "propose",
  "proposal": {
    "connectionId": "wiki-main",
    "operation": "create",
    "params": {"spaceKey": "DEMO", "title": "Release notes", "body": "<p>Draft release notes.</p>"}
  }
}
```

Use `parentId` to place a new page under an existing parent. To update, first read the page and propose `update` with `pageId`, `title`, `body`, and `version` equal to the current version **plus one**. A proposal is a local draft; approving it publishes the page or update to the provider.

Pull-request publication requires an accepted local delivery task and an already prepared branch. GitHub example:

```json
{
  "operation": "propose",
  "proposal": {
    "connectionId": "github-main",
    "operation": "createPullRequest",
    "taskId": "WI-001",
    "params": {"owner": "example-org", "repo": "example-repo", "title": "Add release notes", "body": "Summary of changes.", "head": "feature/release-notes", "base": "main"}
  }
}
```

For Bitbucket use `project` and `repo`, and full branch refs such as `refs/heads/feature/release-notes` and `refs/heads/main` for `head` and `base`. The Bitbucket adapter creates pull requests within the specified repository. These integrations do not create a branch or push commits. `createComment` proposals are also available for GitHub and Bitbucket pull-request conversation comments.

Provider endpoints and permissions vary by deployment. The adapters are verified with mocked API tests; no corporate provider endpoint or native Windows run has been tested.

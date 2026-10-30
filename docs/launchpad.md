# Project launchpad and runtime settings

The existing single workbench includes a Settings dialog and opt-in project setup.
Opening a folder never initializes the harness or starts a model. Before setup,
inspect detected tools, configure executable paths, review starter task drafts,
and explicitly initialize when ready. Dismissal is stored per project and can be
reversed using the setup entry. A restored workbench reconnects its host handlers.

## Toolchain and Git

Settings discovers Git, Node.js, Java and Python, displays versions and diagnostics,
and accepts a custom executable path for each. Settings are scoped to the project
folder. Empty values use automatic discovery; invalid explicit overrides fail
clearly instead of silently falling back. Python must be 3.12 or later. Discovery
skips unsupported candidates, including stale Python entries before a valid one.
Java also uses JAVA_HOME and supports version output from older JDKs.

Selected executables feed the Python harness, project tools and Copilot SDK child
environment. Child PATH changes never mutate the VS Code process environment.
The custom Copilot CLI path is also resolved per project. New harnesses honor
COPILOT_SDLC_GIT_PATH and selected gate executables. Preserved older harness files
are never overwritten: standard executable names can use the injected PATH;
a nonstandard custom Git filename fails with upgrade guidance if the script lacks
support. Review and update a project-owned harness explicitly to adopt new gate
behavior. Existing user modifications are preserved.

On Windows, npm/npx use the selected Node executable plus installed npm-cli.js or
npx-cli.js, preserving argument boundaries without shell interpolation. Yarn/pnpm
batch wrappers are not silently passed through cmd.exe: invoke a native executable
or the package's CLI JavaScript explicitly. Cancellation and timeouts terminate
process trees, including gate descendants. Tests cover simulated Windows command
resolution and real POSIX descendants. Native Windows validation is configured in
.github/workflows/windows.yml (windows-latest, Node 22/24, Python 3.12); it must
actually run before claiming a native Windows pass.

## Credentials

Credential values are entered in a native password prompt and saved through
VS Code ExtensionContext.secrets. They are never sent to the webview, saved in
project settings or included in generic project-tool environments. The UI exposes
only configured/not-configured state and replace/remove actions. A saved GitHub
token is passed directly to the Copilot SDK; without it, existing provider login
continues to apply. The OpenAI API key is storage-only until an executor explicitly
integrates that provider; the UI labels this limitation.

VS Code documents encrypted SecretStorage, backed on desktop by Electron
safeStorage. OS protection uses DPAPI on Windows and Keychain-derived protection
on macOS. This does not isolate secrets from all same-user applications or trusted
Extension Host code. No custom encryption format or key file is introduced.

Sources: [VS Code storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage),
[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Skill-driven draft suggestions

Ordinary Copilot remains the master. It explicitly calls sdlc_suggest_tasks after
a user-requested skill/research effort, naming the source and supplying requirements
and acceptance criteria. The extension does not claim to observe all skill usage.
Drafts are editable/selectable; creation requires initialized harness files and
leaves tasks unapproved. No agent starts. Duplicate acceptance is serialized and
receipted in task documents; later suggestions survive an overlapping acceptance.
Reopening the panel restores current in-memory drafts, while editor restart does
not pretend those transient drafts were persisted as work items.

## Observed usage

Project usage combines work-item metric rows, research receipt artifacts and live
sessions, deduplicated by run ID. Active usage updates without rerunning Python
snapshots for every streaming event. Authoritative run attempts remain counted
even when their log is outside the bounded live cache. A ledger-only unfinished
attempt is not evidence of a running process. Interrupted durations stop at the
last recorded observation; observed sessions in another window remain distinct
from ownership-unknown records.

USD and premium-request units remain separate. Explicit zero differs from unknown;
partial coverage is labeled with the number of sessions reporting the field.
Synthetic demo runs are identified. These are observed local/project totals,
not provider-account billing balances.

## Interaction and motion

Settings, project setup, editable suggestions and planning-record details share the
same workbench. Planning IDs are keyboard-operable links; records open in a compact
dialog, with an explicit action for the source artifact. Dialogs support Escape,
backdrop close and focus return. Motion uses restrained opacity/transform and
color transitions, respects prefers-reduced-motion, and never animates every
streaming update. Animations use short, interruptible transitions and respect reduced motion; no animation dependency was added.

## Three review cycles

1. GPT-6 Astra assessed architecture; GPT-6.1 Sol judged runtime/credentials/metrics
   requirements. GPT-6.1 Terra implementation agents added runtime discovery,
   settings, credentials, onboarding and clickable UI; root wired metrics/suggestions.
2. GPT-6.1 Sol reproduced stale live metrics, interrupted duration inflation,
   missing attempts, a suggestion race and invalid Python fallback. Terra and root
   implemented targeted fixes and regression tests.
3. GPT-6.1 Sol identified gate-descendant timeout leaks and history placeholders
   recreating ghost activity. Terra and root fixed gate timeout/cancellation trees,
   duration rendering and ledger-only aggregation, then verified the final changes.

The judges reviewed code and tests; rendered UI verification and native Windows
execution are separate evidence, never inferred from source review alone.

Final local verification: 18 Python tests and 95 TypeScript tests passed; one
Windows-only test was skipped on macOS. TypeScript and architecture checks and
both VSIX builds passed. Packaged Extension Host assertions passed (15 tools,
no implicit files, supervised research and prototype persistence). This host's
VS Code test application did not exit after its Extension Host reported code 0;
the isolated test process required cleanup. That teardown issue is separate from
the passing assertions and is not represented as a successful process exit.

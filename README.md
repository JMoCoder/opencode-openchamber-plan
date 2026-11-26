# OpenCode OpenChamber Plan

A small **OpenCode V2 server plugin** that lets Plan mode maintain a task plan in **OpenChamber Project Knowledge**, without opening ordinary source-code or configuration-file writes.

**This is an OpenCode plugin for an OpenChamber workflow, not an OpenChamber extension.** OpenCode loads the plugin; OpenChamber supplies the `openchamber_knowledge` tool and owns plan storage. This independent project is not an official OpenCode or OpenChamber component and is not affiliated with either project.

## Why it exists

A global `AGENTS.md` may require plans to be saved to OpenChamber Project Knowledge, while OpenCode's native Plan reminder only permits plan files in its own native plan directory. Simply exposing the knowledge tool does not reconcile those instructions.

This plugin adapts that specific native reminder on outgoing model requests and allows one additional route: `knowledge.save` with `kind: "plan"` for the calling session's project. It does not replace your agent instructions, create a plan automatically, or implement the plan.

## Requirements and compatibility

- **OpenCode 2.4.2** and **OpenChamber 2.8.0** are the target pair for 1.0.1. OpenChamber must expose `openchamber_knowledge` in the session. The adapter recognizes both Code Mode and direct knowledge tools.
- The legacy wrapped Plan reminder used by OpenCode 2.1.4 is still supported. V1 is not supported. Other V2 versions are not automatically certified.
- A user-controlled switch from Plan to Build before implementation.
- Node.js 22 or newer to run this repository's development checks. The shipped plugin is plain JavaScript and has no runtime package dependencies or build step.

Without the OpenChamber knowledge tool, the plugin leaves the native Plan reminder unchanged and provides no Project Knowledge capability. Installing it in a standalone OpenCode CLI does **not** connect that CLI to OpenChamber.

The native reminder is matched deliberately and narrowly. If an OpenCode upgrade changes its format, the plugin will refuse its knowledge-write exception rather than silently relax restrictions. Re-run compatibility checks before relying on a new OpenCode version.

## Install from GitHub

The plugin is distributed through GitHub, **not the npm registry**. The examples use the `v1.0.1` tag once published. To test a PR before tagging, use the verified commit SHA in place of `v1.0.1`.

```sh
opencode plugin add 'github:JMoCoder/opencode-openchamber-plan#v1.0.1'
opencode plugin list
```

The command adds a global package entry for the OpenCode server selected by that CLI. OpenChamber may manage a **different OpenCode server/configuration** from your terminal. If so, use OpenChamber's plugin settings for its managed server, or add the same entry to the global OpenCode configuration that the managed server reads. Check the loaded plugin in the intended server, not only in a different terminal service.

For a settings screen that accepts package specifications, enter:

```text
github:JMoCoder/opencode-openchamber-plan#v1.0.1
```

If the frontend only accepts a local directory, use the clone-and-path option below. Do not substitute a GitHub webpage URL or a release tarball for a supported package specification.

### Configuration alternative

Merge this entry into your existing `plugins` array; preserve unrelated entries:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "github:JMoCoder/opencode-openchamber-plan#v1.0.1"
  ]
}
```

To apply it to every project for your user, use the global `~/.config/opencode/opencode.json` or `opencode.jsonc`, not an individual project's configuration.

For an upgrade, replace the old package entry with the new tag or commit. Do not keep both refs loaded under the same plugin ID.

### Local directory alternative

```sh
git clone --branch v1.0.1 --depth 1 https://github.com/JMoCoder/opencode-openchamber-plan.git
```

Add the **directory**, not `index.js`, to the intended configuration or local-path plugin settings:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-openchamber-plan"]
}
```

A `file:///absolute/path/to/opencode-openchamber-plan` directory URL is also supported. Relative paths resolve from the configuration file containing the entry.

### Migrating from the original local prototype

The package's stable plugin ID is `openchamber.plan-knowledge`. The earlier hand-installed prototype used `local.openchamber-plan-knowledge`, often in `~/.config/opencode/plugins/openchamber-plan-knowledge/`.

Do not run both adapters. Remove the old entry, move its directory **outside** the discovered `plugins/` directory, or disable its ID with `-local.openchamber-plan-knowledge` in the applicable `plugins` array. Renaming a directory inside `plugins/` does not disable discovery. Keep your existing `AGENTS.md` instructions.

## What changes in Plan mode

- The recognized native reminder is adapted only when the active agent is `plan` and the current tool catalog exposes the OpenChamber knowledge tool. Agent switches and catalog updates are respected.
- Native plan files remain restricted to the original native directory and still require an explicit user request.
- Project Knowledge plans must use the knowledge API. The agent is instructed to list existing plans, read the original file, and update the same plan ID with the full Markdown body and exact original text in `expected`.
- Explicit `projectId` or `directory` overrides are rejected for knowledge writes. OpenChamber resolves the project from the calling session.
- Writing Notes or Todos, deleting knowledge, and associating a plan with another session are rejected. Revisions with a body but without a string `expected` are also rejected.
- Read-only `knowledge.list` and `knowledge.show` remain available. The guard checks `openchamber_knowledge` and legacy `openchamber` knowledge actions, including calls made inside `execute`.
- Source/configuration writes and implementation remain forbidden by the Plan instructions. Existing native file-permission rules are unchanged.
- Agent Progress, subagent dispatch, session coordination, and Lead actions continue through their existing tools and permissions. Your existing agent instructions govern Build work and updates to the plan.

## Recommended global agent instructions

**The plugin defines a permitted route; `AGENTS.md` defines the required workflow.** Add a short rule such as the following to your global `~/.config/opencode/AGENTS.md` if it matches your workflow:

```markdown
## OpenChamber task plans

- In Plan mode, save and maintain the current task's plan in the calling project's Project Knowledge Plans. Continue discussing it with the user and update the same plan as feedback is agreed.
- Keep each plan task-scoped and complete it within the same conversation. Manage project-wide roadmaps in separate authoritative documents.
- Do not implement the plan until the user explicitly switches from Plan to Build.
- When Build starts or resumes a planned task, read the corresponding plan. Mark a step complete only after its acceptance checks pass. Obtain the user's approval before deviating from the plan.
```

The plugin does **not** edit this file for you. It does not automatically pin plans, load every project plan into new conversations, or enforce that a language model remembers to tick a box. Saving, associating, displaying, and pinning a plan are different OpenChamber operations.

Plan bodies should follow OpenChamber's expected format:

```markdown
# Fix the export button

## Steps
- [ ] Confirm the failure and agree the acceptance criteria
- [ ] Implement the approved fix
- [ ] Verify the result

Only change the export workflow. Do not alter unrelated settings.
```

## Reload, disable, and remove

Changes to watched OpenCode configuration trigger reloads without restarting a healthy server. Missing Git packages may install asynchronously; check `opencode plugin list` and wait for the package to finish loading before testing a Plan turn.

To temporarily disable the loaded plugin, append its ID control after its package entry:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "github:JMoCoder/opencode-openchamber-plan#v1.0.1",
    "-openchamber.plan-knowledge"
  ]
}
```

Remove that negative entry to re-enable it. To uninstall a CLI-added package:

```sh
opencode plugin remove 'github:JMoCoder/opencode-openchamber-plan#v1.0.1'
```

For a manually configured local path, remove its configuration entry. Removing a configuration entry does not delete your saved plans or remove your `AGENTS.md` rules. Those rules can conflict with native Plan restrictions again if you keep using Project Knowledge after uninstalling the adapter.

Changes to an external local directory's source files are not guaranteed to be watched. Do not confuse configuration hot-plugging with automatic rebuilding of every local dependency. Use OpenCode's supported reload mechanism where needed. Already-running model/tool snapshots may finish with their captured behavior; perform lifecycle checks at an idle turn boundary.

## Safety boundaries

This is a compatibility/workflow adapter, **not a security sandbox**. It does not grant or revoke shell permissions, isolate plugins, or protect against a malicious tool or another plugin. File access outside the knowledge API remains governed by OpenCode and your existing configuration. The knowledge-write guard only covers the two documented OpenChamber entry points; the underlying OpenChamber service remains responsible for ownership, IDs, and storage.

Unknown reminder formats are refused only while this plugin is installed and active. Uninstalling it restores native behavior, not a new knowledge-service authorization policy. The adapter changes outgoing requests, not persisted session history, application binaries, or global permission rules.

## Development and verification

```sh
npm test
npm run pack:check
npm run test:integration
```

No `npm install` is needed for the unit or package checks. The integration harness requires an installed OpenCode V2 binary (`opencode` by default, or `OPENCODE_BIN=/path/to/opencode`) and uses a disposable home/database, a deterministic localhost model, and an original test-only knowledge-tool fixture. It does not use paid models, your credentials, your real plans, or your running OpenChamber service.

The harness checks the packed plugin in Code Mode by default, including configuration reload, guarded writes, adjacent tool routing, and mode switches. Set `PLAN_TEST_DIRECT_TOOLS=1` to exercise the direct knowledge tools. Add `PLUGIN_SPEC=github:owner/repository#commit` to test installation of that exact Git package through the official plugin command.

The fixture does not certify the OpenChamber GUI or every model's behavior. See the repository's [verification notes](https://github.com/JMoCoder/opencode-openchamber-plan/blob/main/docs/VERIFICATION.md) for evidence and limitations.

## References

- [OpenCode V2 plugin configuration and management](https://opencode.ai/v2/docs/plugins/)
- [OpenCode V2 server plugin API](https://opencode.ai/v2/docs/build/plugins/server/)
- [OpenChamber](https://openchamber.dev/)

## License

[MIT](LICENSE), copyright 2026 Jiamo.

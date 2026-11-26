# Release verification

## Claims and evidence path

The release must establish that the **distributed artifact**, not only the developer's source directory, can be loaded and unloaded through official OpenCode V2 plugin configuration and management routes.

Release checks cover:

- The package exports a V2 server plugin, ships only intended files, and has no runtime dependencies.
- Unit tests cover the wrapped and current Plan instructions, agent and catalog changes, guarded writes, unknown-format refusal, session isolation, and cleanup.
- A real OpenCode V2 process loads a packed-and-extracted local-directory package when its global configuration changes, without restarting that process.
- Disabling, re-enabling, removing, and reinstalling the plugin at idle turn boundaries changes outgoing Plan reminders and knowledge-write guard behavior as expected.
- Native Plan file permissions remain unchanged; Plan cannot edit a source file; an explicit switch to Build allows the approved edit and completion of the same plan. Switching back to Plan preserves the knowledge route.
- Code Mode calls reach the same write guard as direct calls. Adjacent progress, coordination, and Lead tools keep their own routes.
- A fresh project inherits the global plugin without a local configuration.
- The official `opencode plugin add` and `opencode plugin remove` commands install and uninstall a GitHub package revision in an isolated configuration.

## Test isolation and limits

The integration harness uses a temporary home, database, global configuration, source files, and knowledge storage. Model replies come from a deterministic localhost HTTP/SSE fixture; no paid provider is contacted. The knowledge-tool fixture is original test code, not redistributed OpenChamber application code.

Real OpenCode performs the model loop, native file permission checks, plugin loading/unloading, and hook dispatch. The fixture supplies the OpenChamber-shaped tool surface and exact-text storage checks. These tests do not claim to exercise an actual OpenChamber GUI, every frontend's package-input validation, every model's instruction-following, or arbitrary versions of either application.

No production service restart or production configuration edit is needed for these tests. Configuration hot-plugging is not a promise that all edits in external local dependency directories are automatically watched.

## 1.0.1 verification

On 2026-11-26 with OpenCode **2.4.2** on Linux, `npm test` passed **17 tests** and `npm run pack:check` confirmed the five-file package. The integration harness passed **14 checks** with Code Mode and **14** with `PLAN_TEST_DIRECT_TOOLS=1` on a packed-and-extracted artifact. Both runs covered live plugin configuration changes, native file permissions, the Plan-to-Build transition, and re-entry to Plan.

A separate loopback acceptance run used **OpenChamber Web 2.8.0** managing **OpenCode 2.4.2**, the **Agent Progress 1.5.2** companion, and a scripted local model in disposable profiles. The actual Project Knowledge backend created a plan, revised it in place, and rejected a stale edit. With the adapter loaded, a single Code Mode call could reject a knowledge deletion and still return a Lead brief. The run also read back the Lead digest, verified a native subagent reply and its Agent Progress task binding, and exercised OpenChamber session creation, listing, and prompt delivery. An explicit Build switch edited the fixture source, checked off the original saved plan, and finished the separate Agent Progress report. The desktop GUI and real model behavior remain outside these checks.

Run the checks against the desired binary, optionally with an immutable Git package target:

```sh
OPENCODE_BIN=/path/to/opencode npm run test:integration
OPENCODE_BIN=/path/to/opencode PLAN_TEST_DIRECT_TOOLS=1 npm run test:integration
OPENCODE_BIN=/path/to/opencode PLUGIN_SPEC=github:JMoCoder/opencode-openchamber-plan#COMMIT npm run test:integration
```

The legacy wrapped instruction has regression coverage in the unit suite. The full 2.1.4 runtime result below belongs to 1.0.0.

## 1.0.0 release results

Observed on 2026-10-28 with OpenCode **2.1.4**, Node.js **22.22.1**, and npm **11.10.0** on Linux:

- `npm test`: **12 tests passed**.
- `npm run pack:check`: passed; the package contains only `index.js`, `package.json`, `README.md`, `LICENSE`, and `CHANGELOG.md`.
- `npm run test:integration`: **12 lifecycle/behavior checks passed** for a packed-and-extracted artifact, including explicit local-directory and `file://` configuration routes.
- Local-package addition, ID-based disable/re-enable, removal, and reinstallation all took effect in the **same live server process** with **zero explicit reload calls and zero service restarts**.
- Native Plan file permissions remained unchanged; restricted knowledge writes were rejected; the explicit Plan-to-Build transition completed the original plan.
- A second disposable project inherited the global plugin without project-local configuration.

- The official GitHub package route passed **15 integration checks** using an immutable source revision, including a fresh anonymous download, `plugin add`, actual Plan save/Notes refusal, and `plugin remove` in the same live server process.
- The initial published source revision passed the repository's GitHub Actions unit and package checks.

The final `v1.0.0` tag is tested again before its GitHub Release is made public. The Release includes `verification.json` with the exact release commit, tested Git target, observed check names, package checksum, and stated limitations. `SHA256SUMS` covers the package and verification record. Release assets are downloaded back from a draft release and checked before publication.

The Git install/uninstall commands edit the disposable global configuration. Plugin state is inspected through the **same explicit server's `/api/plugin` endpoint**. The unqualified `opencode plugin list` command is not used as evidence for that server because it can connect to a different shared service.

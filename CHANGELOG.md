# Changelog

All notable changes to this project are documented in this file.
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-28

### Added

- Standalone, dependency-free OpenCode V2 server plugin package.
- A narrow Plan-mode exception for the calling project's OpenChamber Project Knowledge Plans.
- Outgoing-request adaptation of the recognized native Plan reminder without changing persisted history or file permissions.
- Guards against Notes/Todos writes, knowledge deletion, explicit cross-project writes, other-session associations, and plan revisions without `expected`.
- Fail-closed behavior when the native reminder is unrecognized or the knowledge tool is unavailable.
- English installation, OpenChamber dependency, global instruction, compatibility, and removal documentation.
- Unit tests, package-content checks, and an isolated real-OpenCode lifecycle test harness.

[1.0.0]: https://github.com/JMoCoder/opencode-openchamber-plan/releases/tag/v1.0.0

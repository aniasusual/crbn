# Comparing other harnesses

The public study tooling and contribution process live in
[80Degrees-Benchmarks](https://github.com/ivasuy/80Degrees-Benchmarks).
This source repository owns the actual 80 Degrees engine and Harbor adapters.

`eighty_degrees:EightyDegrees` is the frozen Codex-subscription, medium-only
profile. `pinned_codex:PinnedCodex` pins Codex CLI. Do not alter an ongoing
study's bundle; build a new version for a new study.

`portable_cli:PortableCLI` adds a container execution contract for Claude Code,
Cursor Agent, Antigravity CLI, or a custom headless agent. The public repository
contains editable argument-vector profiles for each. Install a pinned Linux CLI
and its dependencies in an offline bundle at `/opt/benchmark-cli`, or provide
them in an explicitly recorded container image. `version_argv` must print exactly
`expected_version`; version mismatches stop before the model request. Credentials
are forwarded only from explicitly named environment variables. OAuth-based tools
may need their own dedicated adapter to provision supported container credentials.
Never embed authentication in a distributable bundle or mount your whole home.

These are experimental execution profiles, not validated benchmark results.
Run a synthetic task first, audit raw output for errors even on exit zero, verify
actual model/effort, then implement a version-specific identity and usage parser.
The generic adapter deliberately leaves usage unknown and identity unverified.
The task verifier determines correctness; it does not validate model identity.

Claude Code, Cursor and Antigravity need their own supported authentication.
A Codex subscription does not grant access to those products. Model availability
and effort semantics differ. Cross-model results are descriptive comparisons and
cannot establish the same-model claims. DeepSeek names a model/provider; select
and version the actual harness (for example an external Harbor adapter) separately.

Headless CLI references (reviewed 2026-10-27):
- https://code.claude.com/docs/en/headless
- https://cursor.com/docs/cli/headless
- https://www.antigravity.google/docs/cli/headless/

Permission flags in profiles apply only inside disposable benchmark containers.
No new paid runs are started by the repository setup.

# Harbor evaluation adapter

`EightyDegrees` runs the same `createAgentSession` engine used by the desktop
`SessionBridge`, inside Harbor's task container. It is a **headless single-agent
evaluation profile**, not the desktop UI or managed preview workflow.

The runner requires an exact `gpt-6.1-sol` or `gpt-6-astra` model and `medium` or
`high` effort. It imports only the existing Codex subscription credential into an
in-memory store. It does not use API keys or fall back to another model. Active
tools are read, bash, edit, write, grep and todo. Runtime identity, completed
messages, tool events, native sessions and token statistics are saved to Harbor's
agent log directory. Subscription dollar estimates are deliberately omitted from
Harbor's actual cost field.

`PinnedCodex` inherits Harbor's Codex execution and trajectory parsing. Its only
change is installation from a pinned, locally downloaded official Linux binary
instead of downloading Node/npm for every task. It verifies `codex --version`.
Both adapters provision a CA certificate bundle only when the task image lacks one.

## Build and use

Install Harbor from the exact study commit, not a floating package version. Build
`runner.ts` with Bun 1.4.3 (`--target=bun --external omp-legacy-pi-modules`). Stage
the emitted assets, Bun's Linux x64 binary, pi-natives 18.12.3 Linux x64 baseline
addon alongside Bun, and a public CA bundle in one bundle directory.

Set `PYTHONPATH` to this directory. In Harbor's agent configuration use:

```json
{
  "import_path": "eighty_degrees:EightyDegrees",
  "model_name": "openai/gpt-6.1-sol",
  "kwargs": {
    "bundle_path": "/absolute/path/to/bundle",
    "source_commit": "exact-source-commit",
    "reasoning_effort": "medium"
  }
}
```

For `pinned_codex:PinnedCodex`, set `BENCH_CODEX_DIST` to the unpacked official
platform distribution and `BENCH_CA_BUNDLE` to the public CA bundle. Use
`version=0.163.0` and explicit `reasoning_effort` in Harbor kwargs.
`CODEX_AUTH_JSON_PATH` points to the existing Codex subscription login; never
commit, publish, or copy that credential into evidence archives.

The October 2026 study artifacts live in the separate workspace's `benchmark/`
directory: frozen protocol, configs, task order, source snapshots, hashes, raw
Harbor results and reports. The first scored pair was interrupted by subscription
usage limits. Successful integration checks are not benchmark evidence.

## Accounting and limits

Harbor input tokens include cached input. The engine reports uncached input,
cache reads and cache writes separately; this adapter sums them once. Output
already includes reasoning where reported by the provider. Missing telemetry
stays missing. All smoke checks and failed attempts are retained separately.
Do not use these files alone to claim superiority, noninferiority or lower spend.

Tested integration: both requested models at medium effort, one synthetic file
task each, both arms passing. High effort and full-dataset compatibility remain
unverified until scored execution can proceed. Runtime requires Linux x86_64;
Apple Silicon uses Docker's x86 emulation.

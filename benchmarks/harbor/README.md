# Harbor evaluation adapter

This directory freezes the headless Harbor adapter used for the 2026-10-26
medium-reasoning evaluation. `EightyDegrees` runs the same `createAgentSession`
engine used by SessionBridge. It is a single-agent profile, uses only the existing
OpenAI Codex subscription credential, requires exact `gpt-6.1-sol` or
`gpt-6-astra` identity at `medium` reasoning, disables model fallback and agent
retry, and records runtime identity, events, sessions, and token telemetry.
An OpenAI cybersecurity-policy refusal is treated as a completed agent outcome so
Harbor runs the verifier, matching Harbor's Codex adapter semantics; other model
errors remain infrastructure failures.

`PinnedCodex` preserves Harbor's upstream Codex behavior but installs and checks
the official pinned Codex CLI 0.163.0 Linux binary. Subscription USD charges are
not observable per trial and are not represented as actual spend.

The separate study workspace records the protocol, seeded task sample, frozen
hashes, raw Harbor results, verifier logs, and generated reports. Failed
infrastructure attempts are retained and capped at three per task/agent cell.

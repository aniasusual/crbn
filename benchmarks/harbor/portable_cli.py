"""Opt-in adapter for version-pinned CLIs provisioned in a task container.

No host shell invocation, installation downloads, inferred usage or model identity.
Use only with disposable Harbor environments. Bundles must not contain secrets.
"""
import json
import os
import shlex
from pathlib import Path

from harbor.agents.base import BaseAgent


def command(argv, model, effort, prompt):
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
        raise ValueError("argv must be a nonempty string array")
    values = {"{model}": model, "{effort}": effort, "{prompt}": prompt}
    # Replace only whole arguments; task content can never become shell syntax.
    return shlex.join([values.get(x, x) for x in argv])


class PortableCLI(BaseAgent):
    def __init__(self, *args, argv, expected_version, version_argv,
                 reasoning_effort, bundle_path=None, env_names=None, **kwargs):
        super().__init__(*args, **kwargs)
        if not expected_version or "REPLACE" in expected_version:
            raise ValueError("Pin the exact CLI version output")
        if "{model}" not in argv or "{prompt}" not in argv:
            raise ValueError("Explicit model and task arguments are required")
        self.argv, self.version_argv = argv, version_argv
        self.expected_version, self.effort = expected_version, reasoning_effort
        self.bundle = Path(bundle_path).resolve() if bundle_path else None
        self.env_names = env_names or []
        self.installed_version = None

    @staticmethod
    def name():
        return "portable-cli"

    def version(self):
        return self.expected_version

    async def setup(self, environment):
        if self.bundle:
            await environment.upload_dir(self.bundle, "/opt/benchmark-cli")
        result = await environment.exec(command=shlex.join(self.version_argv))
        self.installed_version = (result.stdout or "").strip()
        (self.logs_dir / "installed-version.txt").write_text(self.installed_version)
        if result.return_code or self.installed_version != self.expected_version:
            raise RuntimeError("CLI version mismatch; no model request was made")

    async def run(self, instruction, environment, context):
        env = {name: os.environ[name] for name in self.env_names}
        requested = {"model": self.model_name, "reasoning_effort": self.effort,
                     "cli_version": self.installed_version,
                     "runtime_identity_verified": False}
        (self.logs_dir / "requested-identity.json").write_text(json.dumps(requested, indent=2))
        result = await environment.exec(
            command=command(self.argv, self.model_name, self.effort, instruction), env=env)
        (self.logs_dir / "stdout.jsonl").write_text(result.stdout or "")
        (self.logs_dir / "stderr.txt").write_text(result.stderr or "")
        (self.logs_dir / "exit.json").write_text(json.dumps({"return_code": result.return_code}))
        if result.return_code:
            raise RuntimeError("CLI failed; inspect private stdout/stderr before classifying or retrying")

    def populate_context_post_run(self, context):
        # Generic streams are retained for harness-specific audit. A successful
        # process is not proof of identity, a solved task, or zero token usage.
        context.n_input_tokens = None
        context.n_output_tokens = None
        context.n_cache_tokens = None
        context.cost_usd = None
        context.metadata = {"runtime_identity_verified": False,
                            "usage_status": "requires harness-specific parser"}

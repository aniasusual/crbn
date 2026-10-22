"""Harbor adapter for the pinned 80 Degrees headless evaluation profile."""
import json
import os
import shlex
from pathlib import Path

from harbor.agents.base import BaseAgent
from harbor.agents.capabilities import AgentCapabilities


class EightyDegrees(BaseAgent):
    capabilities = AgentCapabilities(reasoning_effort=True)
    DEFAULT_SETUP_TIMEOUT_SEC = 600.0

    def __init__(self, *args, bundle_path, source_commit, reasoning_effort, **kwargs):
        super().__init__(*args, reasoning_effort=reasoning_effort, **kwargs)
        if reasoning_effort not in ("medium", "high"):
            raise ValueError("Explicit medium/high reasoning required")
        self.bundle = Path(bundle_path).resolve()
        self.commit = source_commit
        self.effort = reasoning_effort

    @staticmethod
    def name():
        return "80degrees-headless"

    def version(self):
        return self.commit

    async def setup(self, environment):
        await environment.upload_dir(self.bundle, "/opt/80degrees")
        result = await environment.exec(command="mkdir -p /etc/ssl/certs; test -s /etc/ssl/certs/ca-certificates.crt || cp /opt/80degrees/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt; chmod +x /opt/80degrees/bun-linux-x64/bun; /opt/80degrees/bun-linux-x64/bun --version")
        (self.logs_dir / "setup.txt").write_text((result.stdout or "") + (result.stderr or ""))
        if result.return_code:
            raise RuntimeError("80 Degrees Bun runtime setup failed")
        auth = Path(os.environ.get("CODEX_AUTH_JSON_PATH", Path.home() / ".codex/auth.json"))
        await environment.exec(command="mkdir -p /tmp/80degrees-secrets; chmod 700 /tmp/80degrees-secrets")
        await environment.upload_file(auth, "/tmp/80degrees-secrets/auth.json")
        await environment.exec(command="chmod 600 /tmp/80degrees-secrets/auth.json")

    async def run(self, instruction, environment, context):
        instruction_file = self.logs_dir / "instruction.txt"
        instruction_file.write_text(instruction)
        await environment.upload_file(instruction_file, "/tmp/80degrees-instruction.txt")
        model = self.model_name.rsplit("/", 1)[-1]
        command = " ".join(shlex.quote(s) for s in (
            "/opt/80degrees/bun-linux-x64/bun", "/opt/80degrees/runner.js",
            model, self.effort, "/tmp/80degrees-instruction.txt", str(self.environment_logs_dir),
        ))
        result = await environment.exec(command=command, env={
            "BENCH_CODEX_AUTH": "/tmp/80degrees-secrets/auth.json",
            "PI_NATIVES_DIR": "/opt/80degrees/native",
            "PI_NATIVE_VARIANT": "baseline",
        })
        (self.logs_dir / "process-output.txt").write_text((result.stdout or "") + (result.stderr or ""))
        if result.return_code:
            raise RuntimeError(f"80 Degrees exited {result.return_code}; see process-output.txt")

    def populate_context_post_run(self, context):
        stats_path = self.logs_dir / "stats.json"
        if not stats_path.exists():
            return
        stats = json.loads(stats_path.read_text())
        tokens = stats["tokens"]
        context.n_input_tokens = tokens["input"] + tokens["cacheRead"] + tokens["cacheWrite"]
        context.n_cache_tokens = tokens["cacheRead"]
        context.n_output_tokens = tokens["output"]
        context.cost_usd = None  # subscription tokens are not a per-task dollar invoice
        identity_path = self.logs_dir / "identity.json"
        context.metadata = {
            "identity": json.loads(identity_path.read_text()) if identity_path.exists() else None,
            "reasoning_tokens": tokens.get("reasoning"),
            "cost_basis": "subscription; actual per-task USD unavailable",
        }

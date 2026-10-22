"""Upstream Harbor Codex behavior with an offline, version-checked installation."""
import os
from pathlib import Path
from harbor.agents.installed.codex import Codex


class PinnedCodex(Codex):
    async def install(self, environment):
        source = Path(os.environ["BENCH_CODEX_DIST"])
        await environment.upload_dir(source, "/opt/benchmark-codex")
        await environment.upload_file(Path(os.environ["BENCH_CA_BUNDLE"]), "/opt/benchmark-codex/ca-certificates.crt")
        result = await environment.exec(command=(
            "mkdir -p /etc/ssl/certs; "
            "test -s /etc/ssl/certs/ca-certificates.crt || cp /opt/benchmark-codex/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt; "
            "chmod +x /opt/benchmark-codex/bin/* /opt/benchmark-codex/codex-path/rg; "
            "ln -sf /opt/benchmark-codex/bin/codex /usr/local/bin/codex; "
            "ln -sf /opt/benchmark-codex/codex-path/rg /usr/local/bin/rg; "
            "codex --version"
        ), user="root")
        (self.logs_dir / "installed-version.txt").write_text((result.stdout or "") + (result.stderr or ""))
        if result.return_code or self.parse_version(result.stdout or "") != self._version:
            raise RuntimeError("Installed Codex does not match the pinned CLI version")

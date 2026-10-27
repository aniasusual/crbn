"""Offline contract tests; no installed Harbor or model credentials needed."""
import importlib.util
from pathlib import Path
import shlex
import sys
import types
import unittest
from unittest.mock import patch


class ContractTest(unittest.TestCase):
    def load(self):
        base = types.ModuleType('harbor.agents.base')
        base.BaseAgent = object
        spec = importlib.util.spec_from_file_location('portable', Path(__file__).with_name('portable_cli.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'harbor.agents.base': base}):
            spec.loader.exec_module(module)
        return module

    def test_task_cannot_escape_shell_argument(self):
        m = self.load()
        prompt = "$(touch /tmp/unwanted); `env`\n'quoted' {model}"
        result = m.command(['agent', '--model', '{model}', '-p', '{prompt}'], 'exact', 'medium', prompt)
        self.assertEqual(shlex.split(result), ['agent', '--model', 'exact', '-p', prompt])

    def test_rejects_shell_string(self):
        with self.assertRaises(ValueError):
            self.load().command('agent -p prompt', 'exact', 'medium', 'task')


if __name__ == '__main__':
    unittest.main()

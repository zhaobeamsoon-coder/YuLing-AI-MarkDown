#!/usr/bin/env python3
from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tools.public_release_check import history_violations, privacy_violations, remote_ref_violations


ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(command: list[str], cwd: pathlib.Path, *, stdin: str = "", env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, input=stdin, text=True, capture_output=True, env=env)


class ProjectPolicyTests(unittest.TestCase):
    def make_repo(self, email: str = "tests@yuling.invalid", name: str = "YuLing Tests") -> pathlib.Path:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        repo = pathlib.Path(self.temporary.name)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.email", email], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.name", name], cwd=repo, check=True)
        (repo / "README.md").write_text("test\n", encoding="utf-8")
        subprocess.run(["git", "add", "README.md"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "test"], cwd=repo, check=True)
        return repo

    def test_direct_main_push_is_denied_unless_explicitly_overridden(self) -> None:
        repo = self.make_repo()
        hook = ROOT / "scripts/hooks/block_direct_main_push.sh"
        update = "refs/heads/main 111 refs/heads/main 000\n"
        denied = run([str(hook)], repo, stdin=update)
        self.assertNotEqual(denied.returncode, 0)
        allowed_env = {**os.environ, "ALLOW_DIRECT_MAIN_PUSH": "1"}
        allowed = run([str(hook)], repo, stdin=update, env=allowed_env)
        self.assertEqual(allowed.returncode, 0, allowed.stderr)

    def test_push_requires_current_full_check_stamp(self) -> None:
        repo = self.make_repo()
        hook = ROOT / "scripts/hooks/require_check_passed.sh"
        self.assertNotEqual(run([str(hook)], repo).returncode, 0)
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
        (repo / ".git/yuling-check-passed").write_text(f"{head}\n", encoding="utf-8")
        checked = run([str(hook)], repo)
        self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_repository_boundary_rejects_secret_and_user_state(self) -> None:
        for relative in (".env", ".yulingmd/layout.json", "private.sqlite3", "chats/chat.md"):
            repo = self.make_repo()
            path = repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("private\n", encoding="utf-8")
            subprocess.run(["git", "add", "-f", relative], cwd=repo, check=True)
            checked = run(["python3", str(ROOT / "tools/repository_boundary_check.py")], repo)
            self.assertNotEqual(checked.returncode, 0, relative)
            self.assertIn("forbidden tracked path", checked.stderr)

    def test_public_privacy_scan_rejects_personal_and_internal_content(self) -> None:
        repo = self.make_repo()
        safe = repo / "safe.txt"
        safe.write_text(
            'recentKey = "yuling-md-recent-v1"\n/Users/tester/project\nwriter@example.com\n'
            "tests@yuling.invalid\nhttp://192.168.1.2:11434\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "add", "safe.txt"], cwd=repo, check=True)
        self.assertEqual(privacy_violations(repo), [])

        private = repo / "private.txt"
        private.write_text(
            "/Users/" + "private-user/Documents/private\n"
            + "owner@" + "company.example\n"
            + "sl" + "-project/CLAUDE.md\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "add", "private.txt"], cwd=repo, check=True)
        problems = privacy_violations(repo)
        self.assertTrue(any("personal home path" in problem for problem in problems))
        self.assertTrue(any("non-public email" in problem for problem in problems))
        self.assertTrue(any("internal project marker" in problem for problem in problems))

    def test_public_history_requires_one_noreply_commit(self) -> None:
        expected = "231622334+zhaobeamsoon-coder@users.noreply.github.com"
        repo = self.make_repo(expected, "Zhao Yan")
        self.assertEqual(history_violations(repo, expected, "Zhao Yan"), [])
        (repo / "second.txt").write_text("second\n", encoding="utf-8")
        subprocess.run(["git", "add", "second.txt"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "second"], cwd=repo, check=True)
        self.assertTrue(any("exactly one commit" in problem for problem in history_violations(repo, expected, "Zhao Yan")))
        self.assertTrue(any("unexpected commit email" in problem for problem in history_violations(repo, "other@users.noreply.github.com")))

    def test_public_remote_allows_only_main_and_no_tags(self) -> None:
        repo = self.make_repo()
        bare = repo.parent / f"{repo.name}-remote.git"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        subprocess.run(["git", "remote", "add", "origin", str(bare)], cwd=repo, check=True)
        self.assertEqual(remote_ref_violations(repo), [])
        subprocess.run(["git", "push", "-q", "origin", "main"], cwd=repo, check=True)
        self.assertEqual(remote_ref_violations(repo), [])
        subprocess.run(["git", "push", "-q", "origin", "main:refs/heads/private-history"], cwd=repo, check=True)
        self.assertTrue(any("unexpected remote ref" in problem for problem in remote_ref_violations(repo)))


if __name__ == "__main__":
    unittest.main()

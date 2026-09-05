#!/usr/bin/env python3
from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tools.public_release_check import (
    history_violations,
    privacy_violations,
    push_ref_violations,
    remote_ref_violations,
    revision_boundary_violations,
    revision_privacy_violations,
)


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

    def test_public_history_requires_one_sanitized_root_and_noreply_identity(self) -> None:
        expected = "231622334+zhaobeamsoon-coder@users.noreply.github.com"
        repo = self.make_repo(expected, "Zhao Yan")
        self.assertEqual(history_violations(repo, expected, "Zhao Yan"), [])
        (repo / "second.txt").write_text("second\n", encoding="utf-8")
        subprocess.run(["git", "add", "second.txt"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "second"], cwd=repo, check=True)
        self.assertEqual(history_violations(repo, expected, "Zhao Yan"), [])
        self.assertTrue(any("unexpected commit email" in problem for problem in history_violations(repo, "other@users.noreply.github.com")))

        public_email_repo = self.make_repo("zhao.beamsoon@gmail.com", "zhaobeamsoon-coder")
        self.assertEqual(history_violations(public_email_repo), [])

        empty_tree = subprocess.check_output(["git", "mktree"], cwd=repo, input=b"").decode().strip()
        second_root = subprocess.check_output(
            ["git", "commit-tree", empty_tree, "-m", "unrelated root"], cwd=repo, text=True
        ).strip()
        current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
        current_tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=repo, text=True).strip()
        merge = subprocess.check_output(
            ["git", "commit-tree", current_tree, "-p", current, "-p", second_root, "-m", "unrelated merge"],
            cwd=repo,
            text=True,
        ).strip()
        self.assertTrue(any("sanitized root" in problem for problem in history_violations(repo, expected, "Zhao Yan", merge)))

    def test_revision_scan_reads_committed_tree_instead_of_worktree(self) -> None:
        repo = self.make_repo()
        private = repo / "private.txt"
        private.write_text("/Users/" + "private-user/secret\n", encoding="utf-8")
        subprocess.run(["git", "add", "private.txt"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "private"], cwd=repo, check=True)
        private.write_text("safe\n", encoding="utf-8")
        self.assertTrue(any("personal home path" in problem for problem in revision_privacy_violations(repo, "HEAD")))

    def test_revision_boundary_rejects_forbidden_committed_paths(self) -> None:
        repo = self.make_repo()
        database = repo / "private.sqlite3"
        database.write_text("not really a database\n", encoding="utf-8")
        subprocess.run(["git", "add", "-f", "private.sqlite3"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "forbidden"], cwd=repo, check=True)
        self.assertTrue(any("forbidden tracked path" in problem for problem in revision_boundary_violations(repo, "HEAD")))

    def test_public_remote_allows_main_and_reviewed_codex_branches_only(self) -> None:
        repo = self.make_repo()
        bare = repo.parent / f"{repo.name}-remote.git"
        subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
        subprocess.run(["git", "remote", "add", "origin", str(bare)], cwd=repo, check=True)
        self.assertEqual(remote_ref_violations(repo), [])
        subprocess.run(["git", "push", "-q", "origin", "main"], cwd=repo, check=True)
        self.assertEqual(remote_ref_violations(repo), [])
        subprocess.run(["git", "push", "-q", "origin", "main:refs/heads/codex/review"], cwd=repo, check=True)
        self.assertEqual(remote_ref_violations(repo), [])
        subprocess.run(["git", "push", "-q", "origin", "main:refs/heads/private-history"], cwd=repo, check=True)
        self.assertTrue(any("unexpected remote ref" in problem for problem in remote_ref_violations(repo)))

    def test_pre_push_rejects_tags_private_refs_and_main_deletion(self) -> None:
        sha = "1" * 40
        zero = "0" * 40
        safe_problems, revisions = push_ref_violations([
            f"refs/heads/codex/test {sha} refs/heads/codex/test {zero}",
        ])
        self.assertEqual(safe_problems, [])
        self.assertEqual(revisions, [sha])
        problems, _ = push_ref_violations([
            f"refs/tags/v1 {sha} refs/tags/v1 {zero}",
            f"refs/heads/private {sha} refs/heads/private {zero}",
            f"(delete) {zero} refs/heads/main {sha}",
        ])
        self.assertTrue(any("tag push" in problem for problem in problems))
        self.assertTrue(any("unapproved push ref" in problem for problem in problems))
        self.assertTrue(any("deleting main" in problem for problem in problems))


if __name__ == "__main__":
    unittest.main()

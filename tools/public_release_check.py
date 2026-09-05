#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tools.repository_boundary_check import violations as boundary_violations


EXPECTED_EMAIL = "231622334+zhaobeamsoon-coder@users.noreply.github.com"
EXPECTED_NAME = "Zhao Yan"
ALLOWED_EMAIL_SUFFIXES = ("@example.com", "@yuling.invalid", "@users.noreply.github.com")
ALLOWED_ASSET_EMAIL_SUFFIXES = ("@1x.png", "@2x.png", "@3x.png")
ALLOWED_HOME_NAMES = {"test", "tester", "example", "user"}
INTERNAL_MARKERS = {"sl" + "-project"}
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
HOME_PATTERN = re.compile(r"/(?:Users|home)/([A-Za-z0-9._-]+)")
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9_]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
)


def git_output(root: pathlib.Path, *arguments: str) -> str:
    return subprocess.check_output(["git", *arguments], cwd=root, text=True, stderr=subprocess.STDOUT)


def tracked_files(root: pathlib.Path) -> list[pathlib.Path]:
    return [root / path for path in git_output(root, "ls-files").splitlines() if path]


def privacy_violations(root: pathlib.Path) -> list[str]:
    problems: list[str] = []
    for path in tracked_files(root):
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        relative = path.relative_to(root)
        for line_number, line in enumerate(content.splitlines(), 1):
            for match in HOME_PATTERN.finditer(line):
                if match.group(1).lower() not in ALLOWED_HOME_NAMES:
                    problems.append(f"personal home path: {relative}:{line_number}")
            for email in EMAIL_PATTERN.findall(line):
                if not email.lower().endswith((*ALLOWED_EMAIL_SUFFIXES, *ALLOWED_ASSET_EMAIL_SUFFIXES)):
                    problems.append(f"non-public email: {relative}:{line_number}")
            if any(marker in line.lower() for marker in INTERNAL_MARKERS):
                problems.append(f"internal project marker: {relative}:{line_number}")
            if any(pattern.search(line) for pattern in SECRET_PATTERNS):
                problems.append(f"secret-shaped content: {relative}:{line_number}")
    return problems


def history_violations(
    root: pathlib.Path,
    expected_email: str = EXPECTED_EMAIL,
    expected_name: str | None = EXPECTED_NAME,
) -> list[str]:
    problems: list[str] = []
    try:
        count = int(git_output(root, "rev-list", "--count", "HEAD").strip())
        identities = git_output(root, "log", "--format=%an%x00%ae%x00%cn%x00%ce", "HEAD").splitlines()
    except (subprocess.CalledProcessError, ValueError) as error:
        return [f"cannot inspect public history: {error}"]
    if count != 1:
        problems.append(f"public history must contain exactly one commit, found {count}")
    unexpected_email = False
    unexpected_name = False
    for identity in identities:
        author_name, author_email, committer_name, committer_email = identity.split("\0")
        if author_email != expected_email or committer_email != expected_email:
            unexpected_email = True
        if expected_name is not None and (author_name != expected_name or committer_name != expected_name):
            unexpected_name = True
    if unexpected_email:
        problems.append("unexpected commit email in public history")
    if unexpected_name:
        problems.append("unexpected commit name in public history")
    return problems


def remote_ref_violations(root: pathlib.Path, remote: str = "origin") -> list[str]:
    try:
        output = git_output(root, "ls-remote", "--heads", "--tags", remote)
    except subprocess.CalledProcessError as error:
        return [f"cannot inspect remote refs: {error.output.strip()}"]
    allowed = {"refs/heads/main"}
    refs = {line.split("\t", 1)[1] for line in output.splitlines() if "\t" in line}
    return [f"unexpected remote ref: {ref}" for ref in sorted(refs - allowed)]


def gitleaks_violations(root: pathlib.Path) -> list[str]:
    executable = shutil.which("gitleaks")
    if executable is None:
        return ["gitleaks is required for a public release"]
    checked = subprocess.run(
        [executable, "detect", "--source", str(root), "--log-opts", "HEAD", "--redact=100", "--no-banner", "--no-color"],
        cwd=root,
        text=True,
        capture_output=True,
    )
    if checked.returncode == 0:
        return []
    return ["gitleaks found an unreviewed secret or failed to scan the public commit"]


def main() -> int:
    root = pathlib.Path(git_output(pathlib.Path.cwd(), "rev-parse", "--show-toplevel").strip())
    problems = [
        *boundary_violations(root),
        *privacy_violations(root),
        *history_violations(root),
        *remote_ref_violations(root),
        *gitleaks_violations(root),
    ]
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print("public release privacy gate: passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

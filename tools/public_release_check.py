#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tools.repository_boundary_check import (
    ALLOWED_BINARY_ROOT,
    FORBIDDEN_PARTS,
    FORBIDDEN_SUFFIXES,
    MAX_LINES,
    violations as boundary_violations,
)


EXPECTED_EMAIL = "231622334+zhaobeamsoon-coder@users.noreply.github.com"
EXPECTED_NAME = "Zhao Yan"
APPROVED_PUBLIC_EMAIL = "zhao.beamsoon@gmail.com"
APPROVED_COMMIT_IDENTITIES = {
    (EXPECTED_NAME, EXPECTED_EMAIL),
    ("zhaobeamsoon-coder", APPROVED_PUBLIC_EMAIL),
}
ALLOWED_GITHUB_COMMITTERS = {EXPECTED_EMAIL, APPROVED_PUBLIC_EMAIL, "noreply@github.com"}
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


def email_is_allowed(email: str) -> bool:
    normalized = email.lower()
    return normalized in {APPROVED_PUBLIC_EMAIL, "noreply@github.com"} or normalized.endswith(
        (*ALLOWED_EMAIL_SUFFIXES, *ALLOWED_ASSET_EMAIL_SUFFIXES)
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
                if not email_is_allowed(email):
                    problems.append(f"non-public email: {relative}:{line_number}")
            if any(marker in line.lower() for marker in INTERNAL_MARKERS):
                problems.append(f"internal project marker: {relative}:{line_number}")
            if any(pattern.search(line) for pattern in SECRET_PATTERNS):
                problems.append(f"secret-shaped content: {relative}:{line_number}")
    return problems


def revision_files(root: pathlib.Path, revision: str) -> list[str]:
    return [
        path
        for path in git_output(root, "ls-tree", "-r", "--name-only", revision).splitlines()
        if path
    ]


def revision_blob(root: pathlib.Path, revision: str, relative: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{revision}:{relative}"], cwd=root)


def revision_boundary_violations(root: pathlib.Path, revision: str) -> list[str]:
    problems: list[str] = []
    for name in revision_files(root, revision):
        relative = pathlib.Path(name)
        suffix = relative.suffix.lower()
        forbidden_environment = relative.name == ".env" or (
            relative.name.startswith(".env.") and relative.name != ".env.example"
        )
        if FORBIDDEN_PARTS.intersection(relative.parts) or suffix in FORBIDDEN_SUFFIXES or forbidden_environment:
            problems.append(f"forbidden tracked path: {relative}")
            continue
        try:
            blob = revision_blob(root, revision, name)
        except subprocess.CalledProcessError:
            problems.append(f"cannot inspect tracked path: {relative}")
            continue
        if b"\0" in blob[:8192] and ALLOWED_BINARY_ROOT not in relative.parents:
            problems.append(f"unapproved tracked binary: {relative}")
            continue
        if suffix in {".ts", ".tsx", ".rs", ".py", ".sh"}:
            try:
                line_count = len(blob.decode("utf-8").splitlines())
            except UnicodeDecodeError:
                continue
            if line_count > MAX_LINES:
                problems.append(f"source file exceeds {MAX_LINES} lines: {relative} ({line_count})")
    return problems


def revision_privacy_violations(root: pathlib.Path, revision: str) -> list[str]:
    problems: list[str] = []
    for relative in revision_files(root, revision):
        try:
            content = revision_blob(root, revision, relative).decode("utf-8")
        except (UnicodeDecodeError, subprocess.CalledProcessError):
            continue
        for line_number, line in enumerate(content.splitlines(), 1):
            for match in HOME_PATTERN.finditer(line):
                if match.group(1).lower() not in ALLOWED_HOME_NAMES:
                    problems.append(f"personal home path: {relative}:{line_number}")
            for email in EMAIL_PATTERN.findall(line):
                if not email_is_allowed(email):
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
    revision: str = "HEAD",
) -> list[str]:
    problems: list[str] = []
    try:
        roots = git_output(root, "rev-list", "--max-parents=0", revision).splitlines()
        identities = git_output(
            root, "log", "--format=%an%x00%ae%x00%cn%x00%ce", revision
        ).splitlines()
    except (subprocess.CalledProcessError, ValueError) as error:
        return [f"cannot inspect public history: {error}"]
    if len(roots) != 1:
        problems.append(f"public history must descend from one sanitized root, found {len(roots)} roots")
    approved_authors = (
        APPROVED_COMMIT_IDENTITIES
        if expected_email == EXPECTED_EMAIL and expected_name == EXPECTED_NAME
        else {(expected_name, expected_email)}
    )
    allowed_committers = (
        ALLOWED_GITHUB_COMMITTERS
        if expected_email == EXPECTED_EMAIL
        else {expected_email, "noreply@github.com"}
    )
    unexpected_email = False
    unexpected_name = False
    for identity in identities:
        author_name, author_email, committer_name, committer_email = identity.split("\0")
        if author_email not in {email for _, email in approved_authors} or committer_email not in allowed_committers:
            unexpected_email = True
        if (author_name, author_email) not in approved_authors:
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
    refs = {line.split("\t", 1)[1] for line in output.splitlines() if "\t" in line}
    return [
        f"unexpected remote ref: {ref}"
        for ref in sorted(refs)
        if ref != "refs/heads/main" and not ref.startswith("refs/heads/codex/")
    ]


def gitleaks_violations(root: pathlib.Path, revision: str = "HEAD") -> list[str]:
    executable = shutil.which("gitleaks")
    if executable is None:
        return ["gitleaks is required for a public release"]
    checked = subprocess.run(
        [executable, "detect", "--source", str(root), "--log-opts", revision, "--redact=100", "--no-banner", "--no-color"],
        cwd=root,
        text=True,
        capture_output=True,
    )
    if checked.returncode == 0:
        return []
    return ["gitleaks found an unreviewed secret or failed to scan the public commit"]


def push_ref_violations(lines: list[str]) -> tuple[list[str], list[str]]:
    problems: list[str] = []
    revisions: list[str] = []
    zero = "0" * 40
    for line in lines:
        fields = line.split()
        if len(fields) != 4:
            problems.append("cannot parse pre-push ref update")
            continue
        _local_ref, local_sha, remote_ref, _remote_sha = fields
        if remote_ref.startswith("refs/tags/"):
            problems.append(f"tag push is forbidden: {remote_ref}")
            continue
        if remote_ref == "refs/heads/main":
            if local_sha == zero:
                problems.append("deleting main is forbidden")
            elif local_sha not in revisions:
                revisions.append(local_sha)
            continue
        if not remote_ref.startswith("refs/heads/codex/"):
            problems.append(f"unapproved push ref: {remote_ref}")
            continue
        if local_sha != zero and local_sha not in revisions:
            revisions.append(local_sha)
    return problems, revisions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision")
    parser.add_argument("--skip-remote", action="store_true")
    parser.add_argument("--pre-push", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = pathlib.Path(git_output(pathlib.Path.cwd(), "rev-parse", "--show-toplevel").strip())
    revisions = [args.revision or "HEAD"]
    problems: list[str] = []
    if args.pre_push:
        ref_problems, revisions = push_ref_violations(sys.stdin.read().splitlines())
        problems.extend(ref_problems)
    if not args.pre_push and args.revision is None:
        problems.extend(boundary_violations(root))
        problems.extend(privacy_violations(root))
    for revision in revisions:
        problems.extend(revision_boundary_violations(root, revision))
        problems.extend(revision_privacy_violations(root, revision))
        problems.extend(history_violations(root, revision=revision))
        problems.extend(gitleaks_violations(root, revision))
    if not args.skip_remote:
        problems.extend(remote_ref_violations(root))
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print("public release privacy gate: passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

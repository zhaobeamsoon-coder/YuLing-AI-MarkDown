#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import subprocess
import sys


FORBIDDEN_PARTS = {
    ".codex",
    ".env",
    ".yuling-local",
    ".yulingmd",
    "cache",
    "chats",
    "crash-dumps",
    "node_modules",
    "target",
    "dist",
    "coverage",
    "drafts",
    "indexes",
    "logs",
    "sessions",
    "user-data",
}
FORBIDDEN_SUFFIXES = {
    ".7z", ".bak", ".cer", ".crt", ".db", ".der", ".dmp", ".dump",
    ".gz", ".har", ".key", ".log", ".mobileprovision", ".p12", ".pem",
    ".pfx", ".provisionprofile", ".rar", ".sqlite", ".sqlite3", ".tar",
    ".trace", ".zip",
}
ALLOWED_BINARY_ROOT = pathlib.Path("src-tauri/icons")
MAX_LINES = 800


def tracked_files(root: pathlib.Path) -> list[pathlib.Path]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=root, check=True, capture_output=True, text=True
    )
    return [root / line for line in result.stdout.splitlines() if line]


def violations(root: pathlib.Path) -> list[str]:
    problems: list[str] = []
    for path in tracked_files(root):
        relative = path.relative_to(root)
        suffix = path.suffix.lower()
        forbidden_environment = path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example")
        if FORBIDDEN_PARTS.intersection(relative.parts) or suffix in FORBIDDEN_SUFFIXES or forbidden_environment:
            problems.append(f"forbidden tracked path: {relative}")
            continue
        if path.is_file() and b"\0" in path.read_bytes()[:8192] and ALLOWED_BINARY_ROOT not in relative.parents:
            problems.append(f"unapproved tracked binary: {relative}")
            continue
        if path.is_file() and suffix in {".ts", ".tsx", ".rs", ".py", ".sh"}:
            try:
                line_count = len(path.read_text(encoding="utf-8").splitlines())
            except UnicodeDecodeError:
                continue
            if line_count > MAX_LINES:
                problems.append(f"source file exceeds {MAX_LINES} lines: {relative} ({line_count})")
    return problems


def main() -> int:
    root = pathlib.Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    problems = violations(root)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print("repository boundaries: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

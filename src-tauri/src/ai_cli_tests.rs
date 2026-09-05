use super::{
    candidate_paths, cli_arguments, parse_cli_line, probe_cli, read_version, redact_error,
    run_cli_with_timeout, safe_cli_command, CliKind, CliLine,
};
use std::{fs, path::Path, time::Duration};

#[cfg(unix)]
fn executable(path: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, body).unwrap();
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}

#[test]
fn candidates_follow_saved_local_homebrew_usr_and_path_order() {
    let home = Path::new("/Users/tester");
    let paths = candidate_paths(
        CliKind::Claude,
        Some("~/bin/claude"),
        home,
        Some("/custom/bin:/opt/homebrew/bin"),
    );
    assert_eq!(paths[0], home.join("bin/claude"));
    assert_eq!(paths[1], home.join(".local/bin/claude"));
    assert_eq!(paths[2], Path::new("/opt/homebrew/bin/claude"));
    assert_eq!(paths[3], Path::new("/usr/local/bin/claude"));
    assert_eq!(paths[4], Path::new("/custom/bin/claude"));
}

#[cfg(unix)]
#[test]
fn probes_a_matching_executable_and_rejects_a_fake_kind() {
    let directory = tempfile::tempdir().unwrap();
    let claude = directory.path().join("claude");
    executable(&claude, "#!/bin/sh\necho '2.1.0 (Claude Code)'\n");
    let report = tauri::async_runtime::block_on(probe_cli(
        CliKind::Claude,
        Some(claude.to_str().unwrap()),
        directory.path(),
        None,
        Duration::from_secs(1),
    ));
    assert!(report.resolved_path.is_some());
    let mismatch = tauri::async_runtime::block_on(read_version(
        CliKind::Codex,
        &claude,
        Duration::from_secs(1),
    ));
    assert_eq!(mismatch.unwrap_err().0, "cli_version_mismatch");
}

#[cfg(unix)]
#[test]
fn rejects_non_executable_and_times_out() {
    let directory = tempfile::tempdir().unwrap();
    let codex = directory.path().join("codex");
    fs::write(&codex, "not executable").unwrap();
    let report = tauri::async_runtime::block_on(read_version(
        CliKind::Codex,
        &codex,
        Duration::from_millis(20),
    ));
    assert_eq!(report.unwrap_err().0, "cli_not_executable");
    executable(&codex, "#!/bin/sh\nsleep 2\necho codex-cli\n");
    let timed_out = tauri::async_runtime::block_on(read_version(
        CliKind::Codex,
        &codex,
        Duration::from_millis(20),
    ));
    assert_eq!(timed_out.unwrap_err().0, "cli_timeout");
}

#[test]
fn arguments_enforce_tool_free_and_read_only_modes() {
    let workspace = Path::new("/tmp/workspace");
    let claude = cli_arguments(CliKind::Claude, workspace);
    assert!(claude.windows(2).any(|pair| pair == ["--tools", ""]));
    assert!(!claude
        .iter()
        .any(|argument| { ["Read", "Glob", "Grep", "Shell"].contains(&argument.as_str()) }));
    assert!(claude
        .iter()
        .any(|argument| argument == "--no-session-persistence"));

    let codex = cli_arguments(CliKind::Codex, workspace);
    for required in [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
    ] {
        assert!(codex.iter().any(|argument| argument == required));
    }
    assert!(codex
        .windows(2)
        .any(|pair| pair == ["--sandbox", "read-only"]));
    assert!(codex
        .windows(2)
        .any(|pair| pair == ["-C", "/tmp/workspace"]));
    assert_eq!(codex.last().map(String::as_str), Some("-"));
}

#[test]
fn parses_supported_claude_and_codex_jsonl_events() {
    match parse_cli_line(
        CliKind::Claude,
        r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"片段"}}}"#,
    ) {
        CliLine::Token(text) => assert_eq!(text, "片段"),
        _ => panic!("expected Claude token"),
    }
    assert!(matches!(
        parse_cli_line(CliKind::Claude, r#"{"type":"result","result":"完成"}"#),
        CliLine::Done(Some(text)) if text == "完成"
    ));
    assert!(matches!(
        parse_cli_line(CliKind::Claude, r#"{"type":"result","is_error":true,"result":"login required"}"#),
        CliLine::Error(message) if message == "login required"
    ));
    assert!(matches!(
        parse_cli_line(CliKind::Codex, r#"{"type":"item.completed","item":{"type":"agent_message","text":"回答"}}"#),
        CliLine::Token(text) if text == "回答"
    ));
    assert!(matches!(
        parse_cli_line(CliKind::Codex, r#"{"type":"turn.completed"}"#),
        CliLine::Done(None)
    ));
    assert!(matches!(
        parse_cli_line(CliKind::Codex, r#"{"type":"turn.failed","error":{"message":"失败"}}"#),
        CliLine::Error(message) if message == "失败"
    ));
}

#[cfg(unix)]
#[test]
fn command_environment_is_allowlisted_and_errors_are_redacted() {
    let output = tauri::async_runtime::block_on(async {
        safe_cli_command(Path::new("/usr/bin/env")).output().await
    })
    .unwrap();
    let allowed = [
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "__CF_USER_TEXT_ENCODING",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "TERM",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
    ];
    for required in ["USER", "LOGNAME", "SHELL", "__CF_USER_TEXT_ENCODING"] {
        if std::env::var_os(required).is_some() {
            assert!(
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|line| line.starts_with(&format!("{required}="))),
                "missing macOS identity environment variable: {required}"
            );
        }
    }
    for line in String::from_utf8(output.stdout).unwrap().lines() {
        let name = line.split_once('=').unwrap().0;
        assert!(
            allowed.contains(&name),
            "unexpected environment variable: {name}"
        );
    }
    assert_eq!(
        redact_error("Authorization: Bearer private-value"),
        "[认证信息已隐藏]"
    );
    assert_eq!(redact_error("login required"), "login required");
}

#[cfg(unix)]
#[test]
fn runs_a_version_checked_cli_with_fixed_args_and_stdin() {
    let directory = tempfile::tempdir().unwrap();
    let claude = directory.path().join("claude");
    let prompt_file = directory.path().join("prompt.txt");
    executable(
            &claude,
            &format!(
                "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo '2.1.0 (Claude Code)'; exit 0; fi\ncat > '{}'\nprintf '%s\\n' '{{\"type\":\"stream_event\",\"event\":{{\"type\":\"content_block_delta\",\"delta\":{{\"type\":\"text_delta\",\"text\":\"你好\"}}}}}}' '{{\"type\":\"result\",\"result\":\"你好\"}}'\n",
                prompt_file.display()
            ),
        );
    let mut tokens = Vec::new();
    tauri::async_runtime::block_on(run_cli_with_timeout(
        CliKind::Claude,
        &claude,
        directory.path(),
        "role-bounded prompt",
        Duration::from_secs(3),
        |token| tokens.push(token),
    ))
    .unwrap();
    assert_eq!(tokens, ["你好"]);
    assert_eq!(
        fs::read_to_string(prompt_file).unwrap(),
        "role-bounded prompt"
    );
}

#[cfg(unix)]
#[test]
fn timeout_terminates_the_child_before_it_can_finish() {
    let directory = tempfile::tempdir().unwrap();
    let codex = directory.path().join("codex");
    let marker = directory.path().join("finished.txt");
    executable(
            &codex,
            &format!(
                "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'codex-cli 1.0'; exit 0; fi\ncat >/dev/null\nsleep 1\necho finished > '{}'\n",
                marker.display()
            ),
        );
    let result = tauri::async_runtime::block_on(run_cli_with_timeout(
        CliKind::Codex,
        &codex,
        directory.path(),
        "prompt",
        Duration::from_millis(30),
        |_| {},
    ));
    assert_eq!(result.unwrap_err().kind, "cli_timeout");
    std::thread::sleep(Duration::from_millis(80));
    assert!(!marker.exists());
}

use crate::ai_cli::{probe_cli, render_cli_prompt, run_cli, CliKind};
use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::workspace::WorkspaceState;
use futures_util::{
    future::{AbortHandle, AbortRegistration, Abortable},
    StreamExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IDLE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Default)]
pub struct AiState(Mutex<HashMap<String, AbortHandle>>);

impl AiState {
    fn start(&self, request_id: &str) -> AppResult<AbortRegistration> {
        let (handle, registration) = AbortHandle::new_pair();
        let previous = self
            .0
            .lock()
            .map_err(|_| AppError::Invalid("AI 请求状态不可用".to_string()))?
            .insert(request_id.to_string(), handle);
        if let Some(previous) = previous {
            previous.abort();
        }
        Ok(registration)
    }

    fn finish(&self, request_id: &str) -> AppResult<()> {
        self.0
            .lock()
            .map_err(|_| AppError::Invalid("AI 请求状态不可用".to_string()))?
            .remove(request_id);
        Ok(())
    }

    fn cancel(&self, request_id: &str) -> AppResult<bool> {
        let handle = self
            .0
            .lock()
            .map_err(|_| AppError::Invalid("AI 请求状态不可用".to_string()))?
            .remove(request_id);
        if let Some(handle) = handle {
            handle.abort();
            return Ok(true);
        }
        Ok(false)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub request_id: String,
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub credential_name: Option<String>,
    pub cli_path: Option<String>,
    pub workspace: Option<String>,
    pub messages: Vec<ChatMessage>,
}

#[derive(Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStreamEvent {
    request_id: String,
    kind: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_kind: Option<String>,
}

#[derive(Debug)]
struct AiFailure {
    kind: &'static str,
    message: String,
}

impl AiFailure {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionResult {
    ok: bool,
    message: String,
    error_kind: Option<String>,
    resolved_path: Option<String>,
    version: Option<String>,
}

fn emit(
    app: &AppHandle,
    request_id: &str,
    kind: &str,
    text: impl Into<String>,
    error_kind: Option<&str>,
) {
    let _ = app.emit(
        "ai-stream",
        AiStreamEvent {
            request_id: request_id.to_string(),
            kind: kind.to_string(),
            text: text.into(),
            error_kind: error_kind.map(str::to_string),
        },
    );
}

fn endpoint(base: &str, suffix: &str) -> Result<String, AiFailure> {
    let trimmed = base.trim().trim_end_matches('/');
    if !(trimmed.starts_with("https://")
        || trimmed.starts_with("http://localhost")
        || trimmed.starts_with("http://127.0.0.1"))
    {
        return Err(AiFailure::new(
            "rejected",
            "AI 地址必须使用 HTTPS；本机 localhost 可使用 HTTP",
        ));
    }
    Ok(format!("{trimmed}{suffix}"))
}

fn client() -> Result<reqwest::Client, AiFailure> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|error| {
            AiFailure::new("connection_failed", format!("无法创建网络客户端：{error}"))
        })
}

fn network_failure(error: reqwest::Error) -> AiFailure {
    if error.is_timeout() {
        AiFailure::new("timeout", "AI 服务连接超时")
    } else {
        AiFailure::new("connection_failed", format!("无法连接 AI 服务：{error}"))
    }
}

fn stream_failure(error: reqwest::Error) -> AiFailure {
    if error.is_timeout() {
        AiFailure::new("timeout", "AI 流式输出等待超时")
    } else {
        AiFailure::new(
            "stream_interrupted",
            format!("AI 流式输出意外中断：{error}"),
        )
    }
}

fn response_failure(status: reqwest::StatusCode, body: &str) -> AiFailure {
    let lower = body.to_lowercase();
    if status == reqwest::StatusCode::NOT_FOUND && lower.contains("model") {
        AiFailure::new("model_missing", "配置的模型不存在或不可访问")
    } else {
        AiFailure::new("service_rejected", format!("AI 服务返回 {status}: {body}"))
    }
}

fn load_key(request: &AiChatRequest) -> Result<String, AiFailure> {
    let name = request
        .credential_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| AiFailure::new("missing_credential", "OpenAI 兼容服务需要凭据名称"))?;
    let bytes = credentials::load(name).map_err(|_| {
        AiFailure::new(
            "missing_credential",
            "Keychain 中没有可用凭据，请保存 API Key",
        )
    })?;
    String::from_utf8(bytes).map_err(|_| AiFailure::new("missing_credential", "凭据不是有效文本"))
}

fn openai_token(value: &Value) -> Option<&str> {
    value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
}

fn ollama_token(value: &Value) -> Option<&str> {
    value.pointer("/message/content").and_then(Value::as_str)
}

fn parse_stream_line(
    line: &str,
    sse: bool,
    parser: fn(&Value) -> Option<&str>,
) -> (bool, Option<String>) {
    let payload = if sse {
        line.trim().strip_prefix("data: ").unwrap_or(line.trim())
    } else {
        line.trim()
    };
    if payload == "[DONE]" {
        return (true, None);
    }
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return (false, None);
    };
    let terminal = value.get("done").and_then(Value::as_bool).unwrap_or(false);
    (terminal, parser(&value).map(str::to_string))
}

async fn stream_lines(
    app: &AppHandle,
    request_id: &str,
    response: reqwest::Response,
    parser: fn(&Value) -> Option<&str>,
    sse: bool,
) -> Result<(), AiFailure> {
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(response_failure(status, &body));
    }
    let mut bytes = response.bytes_stream();
    let mut buffer = String::new();
    let mut terminal = false;
    loop {
        let chunk = tokio::time::timeout(IDLE_TIMEOUT, bytes.next())
            .await
            .map_err(|_| AiFailure::new("timeout", "AI 流式输出等待超时"))?;
        let Some(chunk) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&chunk.map_err(stream_failure)?));
        while let Some(position) = buffer.find('\n') {
            let line = buffer.drain(..=position).collect::<String>();
            if line.trim().is_empty() {
                continue;
            }
            let parsed = parse_stream_line(&line, sse, parser);
            terminal |= parsed.0;
            if let Some(token) = parsed.1 {
                emit(app, request_id, "token", token, None);
            }
        }
    }
    if !buffer.trim().is_empty() {
        let parsed = parse_stream_line(&buffer, sse, parser);
        terminal |= parsed.0;
        if let Some(token) = parsed.1 {
            emit(app, request_id, "token", token, None);
        }
    }
    if !terminal {
        return Err(AiFailure::new(
            "stream_interrupted",
            "AI 流式输出意外中断，可重新发送",
        ));
    }
    Ok(())
}

async fn openai_chat(app: &AppHandle, request: &AiChatRequest) -> Result<(), AiFailure> {
    let response = client()?
        .post(endpoint(&request.endpoint, "/chat/completions")?)
        .bearer_auth(load_key(request)?)
        .json(&json!({
            "model": request.model, "messages": request.messages, "stream": true
        }))
        .send()
        .await
        .map_err(network_failure)?;
    stream_lines(app, &request.request_id, response, openai_token, true).await
}

async fn ollama_chat(app: &AppHandle, request: &AiChatRequest) -> Result<(), AiFailure> {
    let response = client()?
        .post(endpoint(&request.endpoint, "/api/chat")?)
        .json(&json!({
            "model": request.model, "messages": request.messages, "stream": true
        }))
        .send()
        .await
        .map_err(network_failure)?;
    stream_lines(app, &request.request_id, response, ollama_token, false).await
}

async fn cli_chat(
    app: &AppHandle,
    workspace_state: &WorkspaceState,
    request: &AiChatRequest,
    kind: CliKind,
) -> Result<(), AiFailure> {
    let path = request
        .cli_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| AiFailure::new("cli_not_found", "请先在设置中检测 CLI"))?;
    let workspace = request
        .workspace
        .as_deref()
        .ok_or_else(|| AiFailure::new("rejected", "CLI 请求缺少工作区"))?;
    let workspace = workspace_state
        .authorized_root(Path::new(workspace))
        .map_err(|error| AiFailure::new("rejected", error.to_string()))?;
    let prompt = render_cli_prompt(&request.messages);
    run_cli(kind, Path::new(path), &workspace, &prompt, |token| {
        emit(app, &request.request_id, "token", token, None);
    })
    .await
    .map_err(|error| AiFailure::new(error.kind, error.message))
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AiState>,
    workspace_state: State<'_, WorkspaceState>,
    request: AiChatRequest,
) -> AppResult<()> {
    if request.request_id.trim().is_empty() {
        return Err(AppError::Invalid("AI 请求缺少 request ID".to_string()));
    }
    let registration = state.start(&request.request_id)?;
    let request_id = request.request_id.clone();
    let future = async {
        match request.provider.as_str() {
            "openai" => openai_chat(&app, &request).await,
            "ollama" => ollama_chat(&app, &request).await,
            "claude-cli" => cli_chat(&app, &workspace_state, &request, CliKind::Claude).await,
            "codex-cli" => cli_chat(&app, &workspace_state, &request, CliKind::Codex).await,
            _ => Err(AiFailure::new("rejected", "不支持的 AI 服务类型")),
        }
    };
    let result = Abortable::new(future, registration).await;
    state.finish(&request_id)?;
    match result {
        Ok(Ok(())) => emit(&app, &request_id, "done", "", None),
        Ok(Err(error)) => emit(&app, &request_id, "error", &error.message, Some(error.kind)),
        Err(_) => emit(
            &app,
            &request_id,
            "cancelled",
            "已停止生成",
            Some("cancelled"),
        ),
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_ai_chat(state: State<'_, AiState>, request_id: String) -> AppResult<bool> {
    state.cancel(&request_id)
}

#[tauri::command]
pub async fn test_ai_connection(request: AiChatRequest) -> AppResult<AiConnectionResult> {
    if matches!(request.provider.as_str(), "claude-cli" | "codex-cli") {
        let kind = CliKind::parse(&request.provider)?;
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| AppError::Invalid("无法确定用户目录".to_string()))?;
        let path_env = std::env::var("PATH").ok();
        let report = probe_cli(
            kind,
            request.cli_path.as_deref(),
            &home,
            path_env.as_deref(),
            Duration::from_secs(2),
        )
        .await;
        return Ok(
            if let (Some(path), Some(version)) = (report.resolved_path, report.version) {
                AiConnectionResult {
                    ok: true,
                    message: "CLI 路径和版本检查通过；登录状态将在首次提问验证".to_string(),
                    error_kind: None,
                    resolved_path: Some(path),
                    version: Some(version),
                }
            } else {
                AiConnectionResult {
                    ok: false,
                    message: "未找到匹配的可执行 CLI".to_string(),
                    error_kind: report.error_kind,
                    resolved_path: None,
                    version: None,
                }
            },
        );
    }
    let result = async {
        if request.model.trim().is_empty() {
            return Err(AiFailure::new("model_missing", "请填写模型名称"));
        }
        let response = match request.provider.as_str() {
            "ollama" => client()?
                .get(endpoint(&request.endpoint, "/api/tags")?)
                .send()
                .await
                .map_err(network_failure)?,
            "openai" => client()?
                .get(endpoint(&request.endpoint, "/models")?)
                .bearer_auth(load_key(&request)?)
                .send()
                .await
                .map_err(network_failure)?,
            _ => return Err(AiFailure::new("rejected", "不支持的 AI 服务类型")),
        };
        let status = response.status();
        let body = response.text().await.map_err(network_failure)?;
        if !status.is_success() {
            return Err(response_failure(status, &body));
        }
        let value: Value = serde_json::from_str(&body).map_err(|_| {
            AiFailure::new("service_rejected", "AI 服务返回了无法识别的连接测试结果")
        })?;
        let names = if request.provider == "ollama" {
            value
                .get("models")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
        } else {
            value
                .get("data")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .collect::<Vec<_>>()
        };
        if !names.iter().any(|name| *name == request.model) {
            return Err(AiFailure::new(
                "model_missing",
                format!("服务可连接，但未找到模型 {}", request.model),
            ));
        }
        Ok(())
    }
    .await;
    Ok(match result {
        Ok(()) => AiConnectionResult {
            ok: true,
            message: "连接和模型检查通过".to_string(),
            error_kind: None,
            resolved_path: None,
            version: None,
        },
        Err(error) => AiConnectionResult {
            ok: false,
            message: error.message,
            error_kind: Some(error.kind.to_string()),
            resolved_path: None,
            version: None,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{
        endpoint, ollama_token, openai_token, parse_stream_line, response_failure,
        test_ai_connection, AiChatRequest, AiState,
    };
    use serde_json::json;
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        path::Path,
        thread,
    };

    #[cfg(unix)]
    fn executable(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, body).unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn restricts_plain_http_to_local_models() {
        assert!(endpoint("http://localhost:11434", "/api/chat").is_ok());
        assert!(endpoint("http://192.168.1.2:11434", "/api/chat").is_err());
        assert!(endpoint("https://api.example.com/v1", "/chat/completions").is_ok());
    }

    #[test]
    fn extracts_stream_tokens() {
        assert_eq!(
            openai_token(&json!({"choices":[{"delta":{"content":"a"}}]})),
            Some("a")
        );
        assert_eq!(ollama_token(&json!({"message":{"content":"b"}})), Some("b"));
    }

    #[test]
    fn classifies_missing_models_separately() {
        assert_eq!(
            response_failure(reqwest::StatusCode::NOT_FOUND, "model not found").kind,
            "model_missing"
        );
        assert_eq!(
            response_failure(reqwest::StatusCode::UNAUTHORIZED, "bad key").kind,
            "service_rejected"
        );
    }

    #[test]
    fn recognizes_clean_and_interrupted_stream_endings() {
        assert!(parse_stream_line("data: [DONE]", true, openai_token).0);
        assert!(parse_stream_line(r#"{"done":true}"#, false, ollama_token).0);
        assert!(!parse_stream_line(r#"{"message":{"content":"partial"}}"#, false, ollama_token).0);
    }

    #[test]
    fn cancellation_is_addressed_by_request_id() {
        let state = AiState::default();
        let _registration = state.start("request-a").unwrap();
        assert!(state.cancel("request-a").unwrap());
        assert!(!state.cancel("request-a").unwrap());
        assert!(!state.cancel("unknown").unwrap());
    }

    #[test]
    fn checks_an_ollama_model_through_the_command_path() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let size = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /api/tags"));
            let body = r#"{"models":[{"name":"qwen3:8b"}]}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let result = tauri::async_runtime::block_on(test_ai_connection(AiChatRequest {
            request_id: "connection-test".to_string(),
            provider: "ollama".to_string(),
            endpoint: format!("http://localhost:{}", address.port()),
            model: "qwen3:8b".to_string(),
            credential_name: None,
            cli_path: None,
            workspace: None,
            messages: Vec::new(),
        }))
        .unwrap();
        server.join().unwrap();
        assert!(result.ok);
        assert!(result.error_kind.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn checks_a_cli_version_without_starting_a_model_request() {
        let directory = tempfile::tempdir().unwrap();
        let codex = directory.path().join("codex");
        executable(
            &codex,
            "#!/bin/sh\n[ \"$1\" = \"--version\" ] || exit 42\necho 'codex-cli 1.0'\n",
        );
        let result = tauri::async_runtime::block_on(test_ai_connection(AiChatRequest {
            request_id: "connection-test".to_string(),
            provider: "codex-cli".to_string(),
            endpoint: String::new(),
            model: String::new(),
            credential_name: None,
            cli_path: Some(codex.to_string_lossy().into_owned()),
            workspace: None,
            messages: Vec::new(),
        }))
        .unwrap();
        let canonical = codex.canonicalize().unwrap().to_string_lossy().into_owned();
        assert!(result.ok);
        assert_eq!(result.resolved_path.as_deref(), Some(canonical.as_str()));
        assert_eq!(result.version.as_deref(), Some("codex-cli 1.0"));
    }
}

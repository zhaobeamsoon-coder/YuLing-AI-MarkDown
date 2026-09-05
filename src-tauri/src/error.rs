use std::io;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("未授权访问此路径：{0}")]
    Unauthorized(String),
    #[error("文件已被其他程序修改：{0}")]
    Conflict(String),
    #[error("无效请求：{0}")]
    Invalid(String),
    #[error("文件操作失败：{0}")]
    Io(#[from] io::Error),
    #[error("索引操作失败：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("网络请求失败：{0}")]
    Network(#[from] reqwest::Error),
    #[error("JSON 解析失败：{0}")]
    Json(#[from] serde_json::Error),
    #[error("系统凭据操作失败：{0}")]
    Credential(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

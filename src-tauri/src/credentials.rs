use crate::error::{AppError, AppResult};

const SERVICE: &str = "ai.yuling.md";

#[cfg(target_os = "macos")]
fn store(name: &str, secret: &[u8]) -> AppResult<()> {
    security_framework::passwords::set_generic_password(SERVICE, name, secret)
        .map_err(|error| AppError::Credential(error.to_string()))
}

#[cfg(target_os = "macos")]
pub fn load(name: &str) -> AppResult<Vec<u8>> {
    security_framework::passwords::get_generic_password(SERVICE, name)
        .map_err(|error| AppError::Credential(error.to_string()))
}

#[cfg(target_os = "macos")]
fn remove(name: &str) -> AppResult<()> {
    security_framework::passwords::delete_generic_password(SERVICE, name)
        .map_err(|error| AppError::Credential(error.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn store(_name: &str, _secret: &[u8]) -> AppResult<()> {
    Err(AppError::Credential("当前平台尚未实现系统凭据存储".to_string()))
}

#[cfg(not(target_os = "macos"))]
pub fn load(_name: &str) -> AppResult<Vec<u8>> {
    Err(AppError::Credential("当前平台尚未实现系统凭据存储".to_string()))
}

#[cfg(not(target_os = "macos"))]
fn remove(_name: &str) -> AppResult<()> {
    Err(AppError::Credential("当前平台尚未实现系统凭据存储".to_string()))
}

fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.len() > 120 || !name.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')) {
        return Err(AppError::Invalid("凭据名称不合法".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub fn save_credential(name: String, secret: String) -> AppResult<()> {
    validate_name(&name)?;
    if secret.is_empty() {
        return Err(AppError::Invalid("凭据不能为空".to_string()));
    }
    store(&name, secret.as_bytes())
}

#[tauri::command]
pub fn has_credential(name: String) -> AppResult<bool> {
    validate_name(&name)?;
    Ok(load(&name).is_ok())
}

#[tauri::command]
pub fn delete_credential(name: String) -> AppResult<()> {
    validate_name(&name)?;
    remove(&name)
}

#[cfg(test)]
mod tests {
    use super::validate_name;

    #[test]
    fn credential_names_are_bounded_and_path_free() {
        assert!(validate_name("openai.personal").is_ok());
        assert!(validate_name("../../secret").is_err());
        assert!(validate_name("").is_err());
    }
}

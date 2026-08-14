use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

pub const EVENT_FILE: &str = "app-events.jsonl";
pub const ROTATED_FILE: &str = "app-events.1.jsonl";
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
pub const RING_LIMIT: usize = 2000;

const SENSITIVE_KEYS: &[&str] = &[
    "token",
    "access_token",
    "accesstoken",
    "refresh_token",
    "authorization",
    "cookie",
    "cookies",
    "password",
    "verifier",
    "stronghold",
    "input_text",
    "inputtext",
    "transcript",
    "email",
    "bearer",
    "secret",
];

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.replace(['-', '_'], "").to_ascii_lowercase();
    SENSITIVE_KEYS.iter().any(|item| {
        let item_norm = item.replace('_', "");
        normalized == item_norm || normalized.contains(&item_norm)
    })
}

pub fn redact_string(value: &str) -> String {
    let mut redacted = replace_emails(value);
    if redacted.to_ascii_lowercase().contains("bearer ") {
        redacted = "[redacted]".into();
    }
    redacted
}

fn replace_emails(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::new();
    let mut last = 0;
    let mut found = false;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' {
            let mut start = i;
            while start > last && is_email_byte(bytes[start - 1]) {
                start -= 1;
            }
            let mut end = i + 1;
            while end < bytes.len() && is_email_byte(bytes[end]) {
                end += 1;
            }
            if start < i && end > i + 1 {
                found = true;
                output.push_str(&input[last..start]);
                output.push_str("[redacted-email]");
                last = end;
                i = end;
                continue;
            }
        }
        i += 1;
    }
    if !found {
        return input.to_string();
    }
    output.push_str(&input[last..]);
    output
}

fn is_email_byte(value: u8) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'%' | b'+' | b'-')
}

pub fn redact_value(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut next = Map::new();
            for (key, child) in map {
                if is_sensitive_key(&key) {
                    next.insert(key, Value::String("[redacted]".into()));
                } else {
                    next.insert(key, redact_value(child));
                }
            }
            Value::Object(next)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(redact_value).collect()),
        Value::String(text) => Value::String(redact_string(&text)),
        other => other,
    }
}

pub fn rotate_if_needed(dir: &Path) -> Result<(), String> {
    let path = dir.join(EVENT_FILE);
    let Ok(meta) = fs::metadata(&path) else {
        return Ok(());
    };
    if meta.len() < MAX_LOG_BYTES {
        return Ok(());
    }
    let rotated = dir.join(ROTATED_FILE);
    let _ = fs::remove_file(&rotated);
    fs::rename(&path, &rotated).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn redacts_sensitive_metadata_and_emails() {
        let value = json!({
            "token": "secret-token",
            "Authorization": "Bearer abc",
            "nested": { "input_text": "finished the report", "path": "/api/work-os/me/workday" },
            "note": "contact jane@example.com"
        });
        let redacted = redact_value(value);
        assert_eq!(redacted["token"], "[redacted]");
        assert_eq!(redacted["Authorization"], "[redacted]");
        assert_eq!(redacted["nested"]["input_text"], "[redacted]");
        assert_eq!(redacted["nested"]["path"], "/api/work-os/me/workday");
        assert!(redacted["note"].as_str().unwrap().contains("[redacted-email]"));
        assert!(!redacted["note"].as_str().unwrap().contains("jane@example.com"));
    }

    #[test]
    fn export_payload_cannot_keep_tokens_or_update_bodies() {
        let summary = redact_value(json!({
            "count": 1,
            "paths": ["/api/work-os/check-ins"],
            "body": { "input_text": "secret update", "token": "abc" }
        }));
        assert_eq!(summary["paths"][0], "/api/work-os/check-ins");
        assert_eq!(summary["body"]["input_text"], "[redacted]");
        assert_eq!(summary["body"]["token"], "[redacted]");
    }

    #[test]
    fn rotates_oversized_log_file() {
        let dir = std::env::temp_dir().join(format!(
            "work-os-diag-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(EVENT_FILE);
        let mut file = File::create(&path).unwrap();
        file.write_all(&vec![b'x'; (MAX_LOG_BYTES as usize) + 8]).unwrap();
        rotate_if_needed(&dir).unwrap();
        assert!(!path.exists());
        assert!(dir.join(ROTATED_FILE).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}

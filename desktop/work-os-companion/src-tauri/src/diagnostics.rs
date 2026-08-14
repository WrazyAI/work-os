use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use work_os_diagnostics_core::{
    redact_string, redact_value, rotate_if_needed, EVENT_FILE, RING_LIMIT, ROTATED_FILE,
};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

static STATE: OnceLock<Mutex<DiagnosticsState>> = OnceLock::new();
static SESSION_ID: OnceLock<String> = OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSource {
    Frontend,
    Rust,
    Ipc,
    Sync,
    Storage,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub id: String,
    pub timestamp: String,
    pub level: DiagnosticLevel,
    pub source: DiagnosticSource,
    pub category: String,
    pub message: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IncomingEvent {
    pub id: Option<String>,
    pub timestamp: Option<String>,
    pub level: Option<DiagnosticLevel>,
    pub source: Option<DiagnosticSource>,
    pub category: String,
    pub message: String,
    pub session_id: Option<String>,
    pub correlation_id: Option<String>,
    pub span_id: Option<String>,
    pub duration_ms: Option<u64>,
    pub metadata: Option<Value>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportInput {
    pub runtime_health: Option<Value>,
    pub queue_summary: Option<Value>,
    pub sanitized_config: Option<Value>,
}

struct DiagnosticsState {
    dir: PathBuf,
    ring: VecDeque<DiagnosticEvent>,
}

fn session_id() -> String {
    SESSION_ID.get_or_init(|| Uuid::new_v4().to_string()).clone()
}

fn now_rfc3339() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let secs = millis / 1000;
    let nanos = (millis % 1000) * 1_000_000;
    format!(
        "{}.{:03}Z",
        chrono_lite(secs),
        nanos / 1_000_000
    )
}

fn chrono_lite(secs: u128) -> String {
    // Keep timestamps parseable without pulling chrono. Format is UNIX seconds plus a Z marker
    // replaced below with a proper UTC datetime via a tiny conversion.
    let seconds = secs as i64;
    let days = seconds.div_euclid(86_400);
    let tod = seconds.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i32 + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 24);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

pub fn normalize_event(incoming: IncomingEvent) -> DiagnosticEvent {
    let metadata = incoming.metadata.map(redact_value);
    DiagnosticEvent {
        id: incoming.id.filter(|value| !value.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string()),
        timestamp: incoming.timestamp.filter(|value| !value.is_empty()).unwrap_or_else(now_rfc3339),
        level: incoming.level.unwrap_or(DiagnosticLevel::Info),
        source: incoming.source.unwrap_or(DiagnosticSource::Frontend),
        category: redact_string(&incoming.category),
        message: redact_string(&incoming.message),
        session_id: incoming
            .session_id
            .filter(|value| !value.is_empty())
            .unwrap_or_else(session_id),
        correlation_id: incoming.correlation_id,
        span_id: incoming.span_id,
        duration_ms: incoming.duration_ms,
        metadata,
    }
}

fn logs_dir_from(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?
        .join("diagnostics");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let dir = logs_dir_from(app)?;
    let _ = SESSION_ID.get_or_init(|| Uuid::new_v4().to_string());
    STATE.get_or_init(|| {
        Mutex::new(DiagnosticsState {
            dir: dir.clone(),
            ring: VecDeque::new(),
        })
    });
    install_panic_hook();
    record(
        app,
        IncomingEvent {
            category: "app.startup".into(),
            message: "Companion host starting".into(),
            source: Some(DiagnosticSource::Rust),
            level: Some(DiagnosticLevel::Info),
            ..IncomingEvent::default()
        },
    );
    Ok(())
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(state) = STATE.get() {
            if let Ok(mut inner) = state.lock() {
                let event = normalize_event(IncomingEvent {
                    category: "rust.panic".into(),
                    message: redact_string(&info.to_string()),
                    source: Some(DiagnosticSource::Rust),
                    level: Some(DiagnosticLevel::Error),
                    ..IncomingEvent::default()
                });
                let _ = persist_locked(&mut inner, &event);
            }
        }
        previous(info);
    }));
}

fn persist_locked(state: &mut DiagnosticsState, event: &DiagnosticEvent) -> Result<(), String> {
    rotate_if_needed(&state.dir)?;
    let path = state.dir.join(EVENT_FILE);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let line = serde_json::to_string(event).map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())?;
    let _ = file.flush();
    if state.ring.len() >= RING_LIMIT {
        state.ring.pop_front();
    }
    state.ring.push_back(event.clone());
    Ok(())
}

fn record(app: &AppHandle, incoming: IncomingEvent) -> DiagnosticEvent {
    let event = normalize_event(incoming);
    if let Some(state) = STATE.get() {
        if let Ok(mut inner) = state.lock() {
            let _ = persist_locked(&mut inner, &event);
        }
    }
    let _ = app.emit("work-os://diagnostics", &event);
    event
}

pub fn host_event(app: &AppHandle, category: &str, message: &str, level: DiagnosticLevel) {
    record(
        app,
        IncomingEvent {
            category: category.into(),
            message: message.into(),
            source: Some(DiagnosticSource::Rust),
            level: Some(level),
            ..IncomingEvent::default()
        },
    );
}

#[tauri::command]
pub fn diagnostics_emit(app: AppHandle, event: IncomingEvent) -> Result<DiagnosticEvent, String> {
    Ok(record(&app, event))
}

#[tauri::command]
pub fn diagnostics_snapshot() -> Result<Vec<DiagnosticEvent>, String> {
    let Some(state) = STATE.get() else {
        return Ok(Vec::new());
    };
    let inner = state.lock().map_err(|error| error.to_string())?;
    Ok(inner.ring.iter().cloned().collect())
}

#[tauri::command]
pub fn open_logs_dir(app: AppHandle) -> Result<String, String> {
    let dir = logs_dir_from(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn diagnostics_export(app: AppHandle, extras: Option<ExportInput>) -> Result<String, String> {
    let dir = logs_dir_from(&app)?;
    let extras = extras.unwrap_or_default();
    let stamp = now_rfc3339().replace([':', '.'], "-");
    let zip_path = dir.join(format!("work-os-diagnostics-{stamp}.zip"));
    let file = File::create(&zip_path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest = json!({
        "app": "work-os-companion",
        "sessionId": session_id(),
        "exportedAt": now_rfc3339(),
        "files": ["manifest.json", "app-events.jsonl", "runtime-health.json", "queue-summary.json", "sanitized-config.json"],
        "redacted": ["tokens", "authorization", "cookies", "stronghold", "transcripts", "input_text", "email"]
    });
    write_zip_json(&mut zip, options, "manifest.json", &manifest)?;
    write_zip_events(&mut zip, options, &dir)?;
    write_zip_json(
        &mut zip,
        options,
        "runtime-health.json",
        &redact_value(extras.runtime_health.unwrap_or_else(|| json!({}))),
    )?;
    write_zip_json(
        &mut zip,
        options,
        "queue-summary.json",
        &redact_value(extras.queue_summary.unwrap_or_else(|| json!({ "count": 0, "paths": [] }))),
    )?;
    write_zip_json(
        &mut zip,
        options,
        "sanitized-config.json",
        &redact_value(extras.sanitized_config.unwrap_or_else(|| json!({}))),
    )?;
    zip.finish().map_err(|error| error.to_string())?;
    Ok(zip_path.to_string_lossy().into_owned())
}

fn write_zip_json(
    zip: &mut ZipWriter<File>,
    options: SimpleFileOptions,
    name: &str,
    value: &Value,
) -> Result<(), String> {
    zip.start_file(name, options).map_err(|error| error.to_string())?;
    let body = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    zip.write_all(&body).map_err(|error| error.to_string())
}

fn write_zip_events(
    zip: &mut ZipWriter<File>,
    options: SimpleFileOptions,
    dir: &Path,
) -> Result<(), String> {
    zip.start_file("app-events.jsonl", options)
        .map_err(|error| error.to_string())?;
    for name in [ROTATED_FILE, EVENT_FILE] {
        let path = dir.join(name);
        if !path.exists() {
            continue;
        }
        let file = File::open(&path).map_err(|error| error.to_string())?;
        for line in BufReader::new(file).lines() {
            let line = line.map_err(|error| error.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(&line).unwrap_or(json!({ "raw": line }));
            let redacted = serde_json::to_string(&redact_value(value)).map_err(|error| error.to_string())?;
            writeln!(zip, "{redacted}").map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

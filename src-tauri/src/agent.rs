//! Opt-in local automation for the actual webview and native backend.
//! Compile with `agent-control`; set DIGIATLAS_AGENT_TOKEN to start the server.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, State};

type PendingReply = Option<(u64, mpsc::Sender<Value>)>;

#[derive(Default)]
pub struct AgentState {
    pub pending: Arc<Mutex<PendingReply>>,
    pub next_disc: Mutex<Option<String>>,
}

#[tauri::command]
pub fn agent_reply(id: u64, result: Value, state: State<'_, AgentState>) {
    let mut pending = state.pending.lock().unwrap();
    if pending.as_ref().is_some_and(|(expected, _)| *expected == id) {
        if let Some((_, sender)) = pending.take() {
            let _ = sender.send(result);
        }
    }
}

fn request(stream: &mut TcpStream, token: &str) -> Result<String, String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let end = loop {
        let mut chunk = [0; 4096];
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("incomplete request".into());
        }
        bytes.extend_from_slice(&chunk[..n]);
        if bytes.len() > 1_048_576 {
            return Err("request too large".into());
        }
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let headers = std::str::from_utf8(&bytes[..end]).map_err(|e| e.to_string())?;
    if !headers.starts_with("POST /eval HTTP/1.1\r\n") {
        return Err("use POST /eval".into());
    }
    let mut length = None;
    let mut authorized = false;
    for line in headers.lines().skip(1) {
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
            if key.eq_ignore_ascii_case("authorization") {
                authorized = value.trim() == format!("Bearer {token}");
            }
        }
    }
    if !authorized {
        return Err("unauthorized".into());
    }
    let length = length.ok_or("content-length required")?;
    if length > 1_000_000 {
        return Err("request too large".into());
    }
    while bytes.len() < end + length {
        let mut chunk = [0; 4096];
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("incomplete body".into());
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
    let body: Value = serde_json::from_slice(&bytes[end..end + length]).map_err(|e| e.to_string())?;
    body["script"].as_str().map(str::to_owned).ok_or("script required".into())
}

pub fn start(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Ok(token) = std::env::var("DIGIATLAS_AGENT_TOKEN") else {
        return Ok(());
    };
    if token.len() < 24 {
        return Err("DIGIATLAS_AGENT_TOKEN must have at least 24 characters".into());
    }
    let port = std::env::var("DIGIATLAS_AGENT_PORT").unwrap_or_else(|_| "17365".into()).parse::<u16>()?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let pending = app.state::<AgentState>().pending.clone();
    std::thread::spawn(move || {
        for (index, mut stream) in listener.incoming().flatten().enumerate() {
            let id = index as u64 + 1;
            let result = request(&mut stream, &token).and_then(|script| {
                let (sender, receiver) = mpsc::channel();
                *pending.lock().unwrap() = Some((id, sender));
                let js = format!(
                    r#"(async () => {{
                    let result;
                    try {{ result = {{ok: true, value: (await (async () => {{ {script} }})()) ?? null}}; }}
                    catch (error) {{ result = {{ok: false, error: String(error)}}; }}
                    await window.__TAURI_INTERNALS__.invoke('agent_reply', {{id: {id}, result}});
                }})()"#
                );
                app.get_webview_window("main").ok_or("main window missing")?.eval(&js).map_err(|e| e.to_string())?;
                receiver.recv_timeout(Duration::from_secs(10)).map_err(|e| e.to_string())
            });
            *pending.lock().unwrap() = None;
            let body = match result {
                Ok(value) => value,
                Err(error) => json!({"ok": false, "error": error}),
            }
            .to_string();
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok(())
}

/// File injection is available only in this opt-in automation build.
#[tauri::command]
pub fn agent_read_file(path: String) -> Result<tauri::ipc::Response, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 128 * 1024 * 1024 {
        return Err("expected a save or memory-card file of at most 128 MiB".into());
    }
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    if data.len() > 128 * 1024 * 1024 {
        return Err("file grew beyond the size limit".into());
    }
    Ok(tauri::ipc::Response::new(data))
}

/// Let the next real disc-picker action use this file, without opening a native dialog.
#[tauri::command]
pub fn agent_set_disc_image(path: String, state: State<'_, AgentState>) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err("disc image not found".into());
    }
    *state.next_disc.lock().unwrap() = Some(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(bytes: Vec<u8>) -> Result<String, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        let sender = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(&bytes).unwrap();
            stream.shutdown(std::net::Shutdown::Write).unwrap();
        });
        let mut stream = listener.accept().unwrap().0;
        let result = request(&mut stream, "private-test-token-123456789");
        sender.join().unwrap();
        result
    }
    #[test]
    fn requires_token_and_bounded_script_body() {
        let body = r#"{"script":"return document.title;"}"#;
        let make = |auth: &str, length: usize| {
            format!("POST /eval HTTP/1.1\r\nAuthorization: Bearer {auth}\r\nContent-Length: {length}\r\n\r\n{body}")
                .into_bytes()
        };
        assert_eq!(parse(make("private-test-token-123456789", body.len())).unwrap(), "return document.title;");
        assert_eq!(parse(make("wrong", body.len())).unwrap_err(), "unauthorized");
        assert_eq!(parse(make("private-test-token-123456789", 1_000_001)).unwrap_err(), "request too large");
    }
    #[test]
    fn refuses_missing_save_files_and_directories() {
        assert!(agent_read_file(std::env::temp_dir().to_string_lossy().into_owned()).is_err());
        assert!(agent_read_file("/missing-digiatlas-save-test-file".into()).is_err());
    }
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::Response, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// The folder the exporter wrote (it holds `manifest.json`).
#[derive(Default)]
struct DataDir(Mutex<Option<PathBuf>>);

fn is_export(dir: &Path) -> bool {
    dir.join("manifest.json").is_file()
}

/// `rel` must stay inside `dir`: no absolute paths, no `..`.
fn resolve(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    if rel.is_empty() || path.is_absolute() || path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Not a data file: {rel}"));
    }
    Ok(dir.join(path))
}

fn saved_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("data-dir.txt"))
}

fn remember(app: &tauri::AppHandle, dir: &Path) {
    if let Some(file) = saved_path(app) {
        if let Some(parent) = file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(file, dir.to_string_lossy().as_bytes());
    }
}

/// `--data PATH`, then `DIGIATLAS_DATA`, then the remembered folder, then the exporter's default
/// output next to the project.
fn initial_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let from_arg = args.iter().position(|a| a == "--data").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let from_env = std::env::var_os("DIGIATLAS_DATA").map(PathBuf::from);
    let saved = saved_path(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .map(|s| PathBuf::from(s.trim()));
    let defaults = ["data/generated/ps2", "../data/generated/ps2"].map(PathBuf::from);
    [from_arg, from_env, saved]
        .into_iter()
        .flatten()
        .chain(defaults)
        .find(|p| is_export(p))
}

/// `--open "#/map/stag0101?d=hard&enemy=Numemon"` starts the app on that view (same format as the address bar).
#[tauri::command]
fn start_view() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == "--open").and_then(|i| args.get(i + 1)).cloned()
}

#[tauri::command]
fn get_data_dir(state: State<DataDir>) -> Option<String> {
    state.0.lock().ok()?.as_ref().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn choose_data_dir(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DataDir>,
) -> Result<Option<String>, String> {
    // The plugin's JS open command omits a parent on Linux; set it so the portal can attach.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Choose the DigiAtlas data folder (contains manifest.json)")
            .blocking_pick_folder()
            .map(|p| p.into_path().map_err(|e| e.to_string()))
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some(dir) = picked else { return Ok(None) };
    if !is_export(&dir) {
        return Err(format!(
            "{} has no manifest.json. Choose the folder the exporter wrote (for example data/generated/ps2).",
            dir.display()
        ));
    }
    remember(&app, &dir);
    *state.0.lock().map_err(|e| e.to_string())? = Some(dir.clone());
    Ok(Some(dir.to_string_lossy().into_owned()))
}

#[tauri::command]
fn read_data_file(state: State<DataDir>, rel: String) -> Result<Response, String> {
    let dir = state.0.lock().map_err(|e| e.to_string())?.clone().ok_or("No data folder is chosen")?;
    let path = resolve(&dir, &rel)?;
    fs::read(&path).map(Response::new).map_err(|e| format!("{rel}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DataDir::default())
        .setup(|app| {
            if let Some(dir) = initial_dir(app.handle()) {
                *app.state::<DataDir>().0.lock().unwrap() = Some(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_data_dir, choose_data_dir, read_data_file, start_view])
        .run(tauri::generate_context!())
        .expect("Could not start DigiAtlas");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_files_inside_the_folder() {
        let dir = Path::new("/data");
        assert_eq!(resolve(dir, "stages.json").unwrap(), Path::new("/data/stages.json"));
        assert_eq!(resolve(dir, "maps/stag0102.png").unwrap(), Path::new("/data/maps/stag0102.png"));
    }

    #[test]
    fn rejects_paths_that_could_leave_the_folder() {
        let dir = Path::new("/data");
        for bad in ["", "../secret", "maps/../../secret", "/etc/passwd", "./stages.json"] {
            assert!(resolve(dir, bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn recognises_an_export_folder() {
        let tmp = std::env::temp_dir().join(format!("digiatlas-test-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        assert!(!is_export(&tmp));
        fs::write(tmp.join("manifest.json"), "{}").unwrap();
        assert!(is_export(&tmp));
        fs::remove_dir_all(&tmp).unwrap();
    }
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, ipc::Response, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// The name the importer writes into `manifest.exporter.name`.
const IMPORTER_NAME: &str = "digiatlas-importer";

/// Where the imported disc lives: the app keeps its own copy, so the ISO can be moved or deleted
/// after the import. `importing` is set while an import runs (one at a time).
struct Cache {
    dir: PathBuf,
    importing: Arc<AtomicBool>,
}

impl Cache {
    /// `<app data>/data/ps2-usa` (one folder per platform and region the importer reads).
    fn new(app_data: &Path) -> Self {
        Cache { dir: app_data.join("data").join("ps2-usa"), importing: Arc::new(AtomicBool::new(false)) }
    }
}

/// A sibling of the cache folder with a suffix (`ps2-usa.new`, `ps2-usa.old`).
fn sibling(dir: &Path, suffix: &str) -> PathBuf {
    let mut name = dir.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    dir.with_file_name(name)
}

/// What the cache holds: nothing yet, data the built-in importer wrote, or data that must be
/// imported again (written by another importer version, or incomplete). Stale data is never shown.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
enum CacheState {
    None,
    Ready,
    Stale { reason: String },
}

/// Judges a cache folder by its manifest.
fn cache_state(dir: &Path) -> CacheState {
    if !dir.is_dir() {
        return CacheState::None;
    }
    let stale = |reason: &str| CacheState::Stale { reason: reason.to_string() };
    let Ok(text) = fs::read_to_string(dir.join("manifest.json")) else {
        return stale("The imported data is incomplete.");
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&text) else {
        return stale("The imported data is damaged.");
    };
    let exporter = &manifest["exporter"];
    if exporter["name"] != IMPORTER_NAME || exporter["version"] != importer::IMPORTER_VERSION {
        return stale("DigiAtlas has been updated since your disc was imported.");
    }
    CacheState::Ready
}

/// Finishes a swap that was cut short (the app closed between the two renames in `install`), so a
/// good import is never lost; leftovers of an unfinished import are removed.
fn recover(dir: &Path) {
    let old = sibling(dir, ".old");
    if !dir.exists() && old.join("manifest.json").is_file() {
        let _ = fs::rename(&old, dir);
    }
    for leftover in [old, sibling(dir, ".new")] {
        if leftover.exists() {
            let _ = fs::remove_dir_all(leftover);
        }
    }
}

/// Moves a finished import from `fresh` into `dir`, replacing what was there. Directory renames
/// cannot overwrite on every OS, so the old data steps aside first and is deleted last.
fn install(fresh: &Path, dir: &Path) -> std::io::Result<()> {
    let old = sibling(dir, ".old");
    if old.exists() {
        fs::remove_dir_all(&old)?;
    }
    if dir.exists() {
        fs::rename(dir, &old)?;
    }
    if let Err(e) = fs::rename(fresh, dir) {
        let _ = fs::rename(&old, dir);
        return Err(e);
    }
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

/// Imports `iso` into a temporary sibling of `dir` and swaps it in only when everything was
/// written. A failure (or an importer panic) leaves the previous cache untouched.
fn import_into(iso: &Path, dir: &Path, progress: &mut dyn FnMut(importer::Progress)) -> Result<(), String> {
    let fresh = sibling(dir, ".new");
    if fresh.exists() {
        fs::remove_dir_all(&fresh).map_err(|e| format!("{}: {e}", fresh.display()))?;
    }
    fs::create_dir_all(&fresh).map_err(|e| format!("{}: {e}", fresh.display()))?;
    let result = catch_unwind(AssertUnwindSafe(|| importer::export(iso, &fresh, true, progress)));
    let outcome = match result {
        Ok(Ok(_)) => install(&fresh, dir).map_err(|e| format!("Could not store the imported data: {e}")),
        Ok(Err(e)) => Err(e.to_string()),
        Err(panic) => {
            let detail = panic
                .downcast_ref::<String>()
                .map(String::as_str)
                .or_else(|| panic.downcast_ref::<&str>().copied())
                .unwrap_or("unknown error");
            Err(format!("The importer stopped unexpectedly: {detail}"))
        }
    };
    if fresh.exists() {
        let _ = fs::remove_dir_all(&fresh);
    }
    outcome
}

/// What an import reports to the window that started it.
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
enum ImportEvent {
    Progress { done: usize, total: usize, message: String },
    Finished,
    Failed { message: String },
}

/// `rel` must stay inside `dir`: no absolute paths, no `..`.
fn resolve(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    if rel.is_empty() || path.is_absolute() || path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Not a data file: {rel}"));
    }
    Ok(dir.join(path))
}

/// The value after `flag` on the command line.
fn arg_after(flag: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

/// `--open "#/stag0101?d=hard&enemy=Numemon"` starts the app on that view (same format as the address bar).
#[tauri::command]
fn start_view() -> Option<String> {
    arg_after("--open")
}

/// `--iso PATH` imports that disc image on start, as if it had been picked in the app. Handed out
/// once, so reloading the window does not import again.
struct StartIso(Mutex<Option<String>>);

#[tauri::command]
fn start_iso(iso: State<StartIso>) -> Option<String> {
    iso.0.lock().ok()?.take()
}

#[tauri::command]
fn data_state(cache: State<Cache>) -> CacheState {
    cache_state(&cache.dir)
}

#[tauri::command]
async fn choose_disc_image(window: tauri::Window) -> Result<Option<String>, String> {
    // The plugin's JS open command omits a parent on Linux; set it so the portal can attach.
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Choose your Digimon World 4 disc image (USA, PS2)")
            .add_filter("Disc images (.iso)", &["iso", "ISO"])
            .add_filter("All files", &["*"])
            .blocking_pick_file()
            .map(|p| p.into_path().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string()))
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts importing `path` on its own thread (the importer is synchronous and not `Send` inside)
/// and returns at once; progress and the outcome arrive on `events`.
#[tauri::command]
fn import_disc(cache: State<Cache>, path: String, events: Channel<ImportEvent>) -> Result<(), String> {
    let iso = PathBuf::from(&path);
    if !iso.is_file() {
        return Err(format!("Could not find the disc image {path}."));
    }
    if cache.importing.swap(true, Ordering::SeqCst) {
        return Err("An import is already running.".into());
    }
    let importing = cache.importing.clone();
    let dir = cache.dir.clone();
    let spawned =
        std::thread::Builder::new().name("disc-import".into()).stack_size(importer::STACK_SIZE).spawn(move || {
            let mut progress = |p: importer::Progress| {
                let _ = events.send(ImportEvent::Progress { done: p.done, total: p.total, message: p.message });
            };
            let outcome = import_into(&iso, &dir, &mut progress);
            importing.store(false, Ordering::SeqCst);
            let _ = events.send(match outcome {
                Ok(()) => ImportEvent::Finished,
                Err(message) => ImportEvent::Failed { message },
            });
        });
    if let Err(e) = spawned {
        cache.importing.store(false, Ordering::SeqCst);
        return Err(e.to_string());
    }
    Ok(())
}

/// Opens (or focuses) a popout window running the same frontend. `hash` is the address-bar format,
/// for example `#/popout?item=weapon:0&d=normal`.
#[tauri::command]
async fn open_popout(app: tauri::AppHandle, label: String, hash: String, title: String) -> Result<(), String> {
    if !label.starts_with("popout-") || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("Not a popout label: {label}"));
    }
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(format!("index.html{hash}").into()))
            .title(title)
            .inner_size(440.0, 520.0)
            .min_inner_size(340.0, 300.0);
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_data_file(cache: State<Cache>, rel: String) -> Result<Response, String> {
    if cache.importing.load(Ordering::SeqCst) {
        return Err("The data is being imported".into());
    }
    let path = resolve(&cache.dir, &rel)?;
    fs::read(&path).map(Response::new).map_err(|e| format!("{rel}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StartIso(Mutex::new(arg_after("--iso"))))
        .setup(|app| {
            let cache = Cache::new(&app.path().app_data_dir()?);
            recover(&cache.dir);
            app.manage(cache);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_state,
            choose_disc_image,
            import_disc,
            read_data_file,
            start_view,
            start_iso,
            open_popout
        ])
        .run(tauri::generate_context!())
        .expect("Could not start DigiAtlas");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the system temp dir, removed when dropped.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("digiatlas-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_manifest(dir: &Path, name: &str, version: &str) {
        fs::create_dir_all(dir).unwrap();
        let manifest = serde_json::json!({"exporter": {"name": name, "version": version}});
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
    }

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
    fn a_missing_cache_is_none() {
        let tmp = TempDir::new("none");
        assert_eq!(cache_state(&tmp.0.join("ps2-usa")), CacheState::None);
    }

    #[test]
    fn a_cache_from_the_built_in_importer_is_ready() {
        let tmp = TempDir::new("ready");
        write_manifest(&tmp.0, IMPORTER_NAME, importer::IMPORTER_VERSION);
        assert_eq!(cache_state(&tmp.0), CacheState::Ready);
    }

    #[test]
    fn other_or_incomplete_data_is_stale() {
        let tmp = TempDir::new("stale");
        assert!(matches!(cache_state(&tmp.0), CacheState::Stale { .. }), "no manifest");
        fs::write(tmp.0.join("manifest.json"), "{not json").unwrap();
        assert!(matches!(cache_state(&tmp.0), CacheState::Stale { .. }), "damaged manifest");
        write_manifest(&tmp.0, IMPORTER_NAME, "0.0.0-older");
        assert!(matches!(cache_state(&tmp.0), CacheState::Stale { .. }), "older importer");
        write_manifest(&tmp.0, "ps2_export", importer::IMPORTER_VERSION);
        assert!(matches!(cache_state(&tmp.0), CacheState::Stale { .. }), "Python exporter");
    }

    #[test]
    fn installing_replaces_the_cache_and_cleans_up() {
        let tmp = TempDir::new("install");
        let dir = tmp.0.join("ps2-usa");
        write_manifest(&dir, IMPORTER_NAME, "old");
        let fresh = sibling(&dir, ".new");
        write_manifest(&fresh, IMPORTER_NAME, importer::IMPORTER_VERSION);
        install(&fresh, &dir).unwrap();
        assert_eq!(cache_state(&dir), CacheState::Ready);
        assert!(!fresh.exists() && !sibling(&dir, ".old").exists());
    }

    #[test]
    fn recovers_a_swap_cut_short() {
        let tmp = TempDir::new("recover");
        let dir = tmp.0.join("ps2-usa");
        write_manifest(&sibling(&dir, ".old"), IMPORTER_NAME, importer::IMPORTER_VERSION);
        fs::create_dir_all(sibling(&dir, ".new")).unwrap();
        recover(&dir);
        assert_eq!(cache_state(&dir), CacheState::Ready);
        assert!(!sibling(&dir, ".new").exists() && !sibling(&dir, ".old").exists());
    }

    #[test]
    fn a_failed_import_keeps_the_previous_cache() {
        let tmp = TempDir::new("failed");
        let dir = tmp.0.join("ps2-usa");
        write_manifest(&dir, IMPORTER_NAME, importer::IMPORTER_VERSION);
        let not_a_disc = tmp.0.join("notes.iso");
        fs::write(&not_a_disc, vec![0u8; 64 * 1024]).unwrap();
        let err = import_into(&not_a_disc, &dir, &mut |_| {}).unwrap_err();
        assert!(err.contains("disc"), "{err}");
        assert_eq!(cache_state(&dir), CacheState::Ready);
        assert!(!sibling(&dir, ".new").exists());
    }
}

//! Compares two import folders value by value (JSON) and pixel by pixel (PNG), to check that a
//! change to the importer leaves its output alone. Exits non-zero when anything differs.
//!
//!     cargo run --release --example compare_exports -- <before> <after>
//!
//! The manifest's time, importer version, known-gaps text and disc file name are not compared.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::ExitCode;

use serde_json::Value;

const FILES: [&str; 5] = ["manifest.json", "enemies.json", "stages.json", "drops.json", "items.json"];
const IMAGE_FOLDERS: [&str; 2] = ["banners", "maps"];
const SHOWN: usize = 15;

fn load(dir: &Path, name: &str) -> Value {
    let text = std::fs::read_to_string(dir.join(name)).unwrap_or_else(|e| panic!("{}: {e}", dir.join(name).display()));
    serde_json::from_str(&text).unwrap()
}

fn diff(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
    if out.len() > 40 {
        return;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys: BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            for k in keys {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => diff(p, q, &format!("{path}.{k}"), out),
                    (Some(_), None) => out.push(format!("{path}.{k}: only before")),
                    _ => out.push(format!("{path}.{k}: only after")),
                }
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: length before {} after {}", x.len(), y.len()));
            }
            for (i, (p, q)) in x.iter().zip(y).enumerate() {
                diff(p, q, &format!("{path}[{i}]"), out);
            }
        }
        // Numbers compare by value, so 1 and 1.0 are the same, as in the app.
        (Value::Number(x), Value::Number(y)) if x.as_f64() == y.as_f64() => {}
        _ if a == b => {}
        _ => out.push(format!("{path}: before {a} after {b}")),
    }
}

fn pixels(path: &Path) -> (u32, u32, Vec<u8>) {
    let decoder = png::Decoder::new(std::fs::File::open(path).unwrap());
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).unwrap();
    buf.truncate(info.buffer_size());
    (info.width, info.height, buf)
}

fn pngs(dir: &Path) -> BTreeSet<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return BTreeSet::new() };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".png"))
        .collect()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [before, after] = args.as_slice() else {
        eprintln!("usage: compare_exports <before> <after>");
        return ExitCode::from(2);
    };
    let (before, after) = (Path::new(before), Path::new(after));
    let mut total = 0;
    for name in FILES {
        let (mut a, mut b) = (load(before, name), load(after, name));
        if name == "manifest.json" {
            for m in [&mut a, &mut b] {
                let m = m.as_object_mut().unwrap();
                for key in ["generatedAt", "exporter", "knownGaps"] {
                    m.remove(key);
                }
                if let Some(source) = m.get_mut("source").and_then(Value::as_object_mut) {
                    source.remove("name");
                }
            }
        }
        let mut out = Vec::new();
        diff(&a, &b, name, &mut out);
        total += out.len();
        println!("{name}: {}", if out.is_empty() { "same".to_string() } else { format!("{} differences", out.len()) });
        for line in out.iter().take(SHOWN) {
            println!("   {line}");
        }
    }
    for folder in IMAGE_FOLDERS {
        let (a, b) = (pngs(&before.join(folder)), pngs(&after.join(folder)));
        let changed: Vec<&String> = a
            .intersection(&b)
            .filter(|n| pixels(&before.join(folder).join(n)) != pixels(&after.join(folder).join(n)))
            .collect();
        let missing: Vec<&String> = a.symmetric_difference(&b).collect();
        total += changed.len() + missing.len();
        println!(
            "{folder}: {} before, {} after, {} with different pixels {:?}, {} on one side only {:?}",
            a.len(),
            b.len(),
            changed.len(),
            &changed[..changed.len().min(5)],
            missing.len(),
            &missing[..missing.len().min(5)]
        );
    }
    println!("{total} differences");
    if total == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

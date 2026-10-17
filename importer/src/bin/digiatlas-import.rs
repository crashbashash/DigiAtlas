//! Command-line importer, for development and testing:
//!
//!     digiatlas-import "Digimon World 4 (USA).iso" --out data/generated/ps2 [--maps]

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let (mut iso, mut out, mut maps) = (None, PathBuf::from("data/generated/ps2"), false);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--out" => out = args.next().map(PathBuf::from).unwrap_or(out),
            "--maps" => maps = true,
            "-h" | "--help" => {
                eprintln!("usage: digiatlas-import <disc image> [--out DIR] [--maps]");
                return ExitCode::SUCCESS;
            }
            _ => iso = Some(PathBuf::from(a)),
        }
    }
    let Some(iso) = iso else {
        eprintln!("usage: digiatlas-import <disc image> [--out DIR] [--maps]");
        return ExitCode::from(2);
    };
    let started = std::time::Instant::now();
    let worker = std::thread::Builder::new().stack_size(importer::STACK_SIZE).spawn(move || {
        importer::export(&iso, &out, maps, &mut |p| eprintln!("[{}/{}] {}", p.done, p.total, p.message))
    });
    let result = match worker.map(|w| w.join()) {
        Ok(Ok(result)) => result,
        _ => Err(importer::Error("the import stopped unexpectedly".into())),
    };
    match result {
        Ok(manifest) => {
            println!("{}", serde_json::to_string_pretty(&manifest["counts"]).unwrap_or_default());
            eprintln!("done in {:.1}s", started.elapsed().as_secs_f64());
            if manifest["source"]["statTableVerified"] != true {
                eprintln!("warning: stat table anchors did not match; the disc may be modified or not vanilla USA");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

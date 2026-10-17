//! Compares the Lua decompiler with a reference dump from the Python exporter.
//!
//! The reference is JSON lines, one per `\x1bLua` magic in every NDMW.AFS entry that has one:
//! `{"entry": N, "off": J, "src": "..."}`, or `{"entry": N, "off": J, "err": "..."}` where
//! `luadec.decompile_chunks` would skip the chunk.
//!
//! Usage: `cargo run --example luadec_parity -- <disc.iso> <reference.jsonl>`
//!
//! With `--blobs <cases.jsonl>` it instead checks standalone blobs (mutated chunks, to exercise
//! the failure paths): `{"blob": hex, "chunks": [[off, src], ...], "errs": [[off, type], ...]}`.
//! Cases where the Python hit its recursion limit are counted, not compared.

use std::collections::BTreeMap;
use std::path::Path;

use importer::afs::Afs;
use importer::{iso, luadec};

fn main() -> importer::Result<()> {
    // deep mutated chunks recurse further than the default stack allows
    std::thread::Builder::new().stack_size(1 << 30).spawn(run).unwrap().join().unwrap()
}

fn run() -> importer::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args[1] == "--blobs" {
        return check_blobs(&args[2]);
    }
    let disc = iso::Source::open(Path::new(&args[1]))?;
    let files = iso::list_files(&disc)?;
    let ndmw = Afs::open(iso::open_disc_file(&disc, &files, "NDMW.AFS")?)?;

    let mut expected: BTreeMap<(usize, usize), Option<String>> = BTreeMap::new();
    for line in std::fs::read_to_string(&args[2])?.lines() {
        let rec: serde_json::Value = serde_json::from_str(line)?;
        let key = (rec["entry"].as_u64().unwrap() as usize, rec["off"].as_u64().unwrap() as usize);
        expected.insert(key, rec["src"].as_str().map(str::to_string));
    }

    let mut actual: BTreeMap<(usize, usize), String> = BTreeMap::new();
    for index in 0..ndmw.count() {
        let blob = ndmw.entry(index)?;
        for (off, src) in luadec::decompile_chunks(&blob) {
            actual.insert((index, off), src);
        }
    }

    let (mut compared, mut skipped, mut diffs) = (0, 0, 0);
    for (key, want) in &expected {
        match (want, actual.get(key)) {
            (Some(want), Some(got)) => {
                compared += 1;
                if want != got {
                    diffs += 1;
                    let line = want.lines().zip(got.lines()).position(|(a, b)| a != b);
                    println!("DIFF entry {} off {}: first differing line {:?}", key.0, key.1, line);
                    if let Some(n) = line {
                        println!("  python: {:?}", want.lines().nth(n));
                        println!("  rust:   {:?}", got.lines().nth(n));
                    }
                }
            }
            (None, None) => skipped += 1,
            (Some(_), None) => {
                diffs += 1;
                println!("SKIPPED BY RUST ONLY: entry {} off {}", key.0, key.1);
            }
            (None, Some(_)) => {
                diffs += 1;
                println!("SKIPPED BY PYTHON ONLY: entry {} off {}", key.0, key.1);
            }
        }
    }
    for key in actual.keys().filter(|k| !expected.contains_key(k)) {
        diffs += 1;
        println!("NOT IN REFERENCE: entry {} off {}", key.0, key.1);
    }
    println!("{compared} chunks compared, {skipped} skipped by both, {diffs} differences");
    if diffs > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn check_blobs(path: &str) -> importer::Result<()> {
    let (mut cases, mut chunks, mut skipped, mut recursion, mut diffs) = (0, 0, 0, 0, 0);
    for (n, line) in std::fs::read_to_string(path)?.lines().enumerate() {
        let rec: serde_json::Value = serde_json::from_str(line)?;
        let errs = rec["errs"].as_array().unwrap();
        if errs.iter().any(|e| e[1] == "RecursionError") {
            recursion += 1;
            continue;
        }
        let hex = rec["blob"].as_str().unwrap().as_bytes();
        let blob: Vec<u8> = hex
            .chunks(2)
            .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
            .collect();
        let want: Vec<(usize, String)> = rec["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (c[0].as_u64().unwrap() as usize, c[1].as_str().unwrap().to_string()))
            .collect();
        let got = luadec::decompile_chunks(&blob);
        cases += 1;
        chunks += want.len();
        skipped += errs.len();
        if want != got {
            diffs += 1;
            let want_offs: Vec<usize> = want.iter().map(|c| c.0).collect();
            let got_offs: Vec<usize> = got.iter().map(|c| c.0).collect();
            println!("DIFF case {n}: python chunks {want_offs:?} errs {errs:?}, rust chunks {got_offs:?}");
            for ((_, a), (_, b)) in want.iter().zip(&got) {
                if let Some(l) = a.lines().zip(b.lines()).position(|(x, y)| x != y) {
                    println!("  python: {:?}", a.lines().nth(l));
                    println!("  rust:   {:?}", b.lines().nth(l));
                }
            }
        }
    }
    println!(
        "{cases} cases: {chunks} chunks decompiled, {skipped} skipped by Python, \
         {recursion} cases with a Python RecursionError not compared, {diffs} differing cases"
    );
    if diffs > 0 {
        std::process::exit(1);
    }
    Ok(())
}

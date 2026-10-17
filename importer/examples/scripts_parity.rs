//! Parity check of the script and trade text logic against the Python exporter's output.
//!
//! Feeds sources decompiled by the Python luadec (a JSON dump: `digimon`, `packs` by entry with
//! `chunks`, `trade` and `files`, and `stages` with their `packs`) through `scripts` and `trades`,
//! and compares each spawner's script info and each stage's traders with Python's stages.json.
//!
//!     cargo run --example scripts_parity -- <dump.json> <stages.json>

use std::collections::HashMap;

use importer::{pyfmt, scripts, trades};
use serde_json::{json, Value};

/// The `script` field of a generator record, as the exporter writes it.
fn script_info(name: &str, ss: &scripts::StageScripts) -> Value {
    let (status, refs) = ss.status(name);
    let mut seen: Vec<(String, Vec<String>)> = Vec::new();
    let mut out = Vec::new();
    for r in refs {
        let key = (r.verb.clone(), r.when.clone());
        if !seen.contains(&key) {
            seen.push(key);
            out.push(json!({"verb": r.verb, "when": r.when}));
        }
    }
    out.truncate(8);
    let mut info = json!({"status": status});
    if !out.is_empty() {
        info["refs"] = Value::Array(out);
    }
    info
}

/// A trader as (name, position, facing, tables), with floats rounded as the exporter does.
fn trader_json(t: &trades::Placed) -> Value {
    let tables: serde_json::Map<String, Value> = t
        .tables
        .iter()
        .map(|(d, offers)| {
            let list = offers
                .iter()
                .map(|o| json!({"give": {"category": o.give.0, "id": o.give.1}, "get": {"category": o.get.0, "id": o.get.1}}))
                .collect();
            ((*d).to_string(), Value::Array(list))
        })
        .collect();
    let r = |v: f64| pyfmt::round(v, 3);
    json!({
        "trader": t.name,
        "position": [r(t.position[0]), r(t.position[1]), r(t.position[2])],
        "facing": r(t.facing),
        "tables": tables,
    })
}

fn python_trader(t: &Value) -> Value {
    let f = |v: &Value| v.as_f64().unwrap();
    let p = &t["position"];
    json!({
        "trader": t["trader"],
        "position": [f(&p["x"]), f(&p["y"]), f(&p["z"])],
        "facing": f(&t["facing"]),
        "tables": t["tables"],
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dump: Value = serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
    let digimon: HashMap<String, String> =
        dump["digimon"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect();
    let meanings = scripts::load_flag_names();
    let packs = dump["packs"].as_object().unwrap();
    let python: HashMap<&str, &Value> =
        expected["stages"].as_array().unwrap().iter().map(|s| (s["id"].as_str().unwrap(), s)).collect();

    let (mut generators, mut with_refs, mut traders, mut diffs) = (0, 0, 0, 0);
    for stage in dump["stages"].as_array().unwrap() {
        let id = stage["id"].as_str().unwrap();
        let py = python[id];
        assert_eq!(py["packs"], stage["packs"], "{id}: pack list differs from stages.json");
        let pack_ids: Vec<String> = stage["packs"].as_array().unwrap().iter().map(|p| p.to_string()).collect();

        if stage["generator"].as_bool().unwrap() {
            let sources = pack_ids.iter().flat_map(|p| packs[p]["chunks"].as_array().unwrap()).map(|s| s.as_str().unwrap());
            let ss = scripts::analyse_sources(sources, &digimon, &meanings);
            for (difficulty, d) in py["difficulties"].as_object().unwrap() {
                for g in d["generators"].as_array().unwrap() {
                    generators += 1;
                    let name = g["name"].as_str().unwrap();
                    let got = script_info(name, &ss);
                    with_refs += usize::from(got.get("refs").is_some());
                    if got != g["script"] {
                        diffs += 1;
                        eprintln!("{id} {difficulty} {name}:\n  rust   {got}\n  python {}", g["script"]);
                    }
                }
            }
        } else {
            for d in py["difficulties"].as_object().unwrap().values() {
                assert!(d["generators"].as_array().unwrap().iter().all(|g| g.get("script").is_none()), "{id}: unexpected script");
            }
        }

        let trade_packs = pack_ids.iter().filter(|p| packs.get(*p).is_some_and(|r| r["trade"].as_bool().unwrap())).map(|p| {
            let rec = &packs[p];
            trades::PackScripts {
                files: rec["files"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect(),
                chunks: rec["chunks"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect(),
            }
        });
        let got: Vec<Value> = trades::extract_from(trade_packs, &digimon).iter().map(trader_json).collect();
        let want: Vec<Value> = py["trades"].as_array().unwrap().iter().map(python_trader).collect();
        traders += want.len();
        if got != want {
            diffs += 1;
            eprintln!("{id} trades:\n  rust   {}\n  python {}", Value::Array(got), Value::Array(want));
        }
    }
    println!("{generators} generators ({with_refs} with refs), {traders} traders, {diffs} differences");
    std::process::exit(i32::from(diffs > 0));
}

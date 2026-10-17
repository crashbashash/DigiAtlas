//! Compares the importer's databases, items, enemies, drop pools, spawners and banners with the
//! Python exporter's output, field by field. The scripts, trades and maps have their own checks.
//!
//!     cargo run --example core_parity -- <disc image> <python output dir>

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use importer::afs::Afs;
use importer::generators::Pack;
use importer::{database, iso, stages};
use serde_json::Value;

fn load(dir: &Path, name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join(name)).expect(name)).expect(name)
}

/// RGBA pixels of a PNG written by either exporter (8-bit RGBA, filter type 0 on every row).
fn png_pixels(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
    let (mut pos, mut idat, mut size) = (8, Vec::new(), (0, 0));
    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[pos..pos + 4].try_into().unwrap()) as usize;
        let tag = &bytes[pos + 4..pos + 8];
        let body = &bytes[pos + 8..pos + 8 + len];
        if tag == b"IHDR" {
            size = (u32::from_be_bytes(body[0..4].try_into().unwrap()), u32::from_be_bytes(body[4..8].try_into().unwrap()));
        } else if tag == b"IDAT" {
            idat.extend_from_slice(body);
        }
        pos += 12 + len;
    }
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(&idat[..]).read_to_end(&mut raw).unwrap();
    let stride = size.0 as usize * 4 + 1;
    let pixels = raw.chunks(stride).flat_map(|row| row[1..].to_vec()).collect();
    (size.0, size.1, pixels)
}

fn report(label: &str, diffs: &[String], compared: usize) {
    println!("{label}: {compared} compared, {} different", diffs.len());
    for d in diffs.iter().take(8) {
        println!("  {d}");
    }
}

fn main() {
    let args: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    let (iso_path, py) = (&args[0], &args[1]);
    let disc = iso::Source::open(iso_path).unwrap();
    let files = iso::list_files(&disc).unwrap();
    let area = Afs::open(iso::open_disc_file(&disc, &files, "AREA.AFS").unwrap()).unwrap();
    let ndmw = Afs::open(iso::open_disc_file(&disc, &files, "NDMW.AFS").unwrap()).unwrap();

    // Items: name, description, skill type, stats.
    let tables = database::read_tables(area.entry(database::DATABASE_ENTRY).unwrap()).unwrap();
    let py_items = load(py, "items.json");
    let mut diffs = Vec::new();
    let items = database::parse_items(&tables).unwrap();
    for (rust, python) in items.iter().zip(py_items["items"].as_array().unwrap()) {
        let mut stats = serde_json::Map::new();
        for (k, v) in &rust.stats {
            stats.insert((*k).into(), v.to_json());
        }
        let checks = [
            ("name", serde_json::json!(rust.name)),
            ("description", serde_json::json!(rust.description)),
            ("skillType", rust.skill_type.map(Value::from).unwrap_or(Value::Null)),
            ("stats", if stats.is_empty() { Value::Null } else { Value::Object(stats) }),
            ("unidentified", if rust.unidentified { Value::Bool(true) } else { Value::Null }),
        ];
        for (key, value) in checks {
            let theirs = python.get(key).cloned().unwrap_or(Value::Null);
            if theirs != value {
                diffs.push(format!("{}:{} {key}: rust {value} python {theirs}", rust.category, rust.id));
            }
        }
    }
    if items.len() != py_items["items"].as_array().unwrap().len() {
        diffs.push(format!("item count rust {} python {}", items.len(), py_items["items"].as_array().unwrap().len()));
    }
    report("items", &diffs, items.len());

    // Enemy stat rows.
    let stats_rows = importer::stats::from_database(&tables["enemy"]).unwrap();
    let models = database::enemy_models(&tables).unwrap();
    let py_enemies = load(py, "enemies.json");
    let mut diffs = Vec::new();
    let by_row: HashMap<i64, &Value> = py_enemies["rows"].as_array().unwrap().iter().map(|r| (r["row"].as_i64().unwrap(), r)).collect();
    let mut compared = 0;
    for r in &stats_rows {
        if r.is_empty() || !models.contains_key(&r.row) {
            continue;
        }
        compared += 1;
        let Some(p) = by_row.get(&(r.row as i64)) else {
            diffs.push(format!("row {} missing in python", r.row));
            continue;
        };
        let mine = [r.hp, r.strength, r.defense, r.wisdom, r.spirit, r.speed, r.exp, r.crit_rate, r.paralysis_rate, r.rarity];
        let theirs = [
            &p["hp"], &p["stats"]["strength"], &p["stats"]["defense"], &p["stats"]["wisdom"], &p["stats"]["spirit"],
            &p["stats"]["speed"], &p["stats"]["exp"], &p["rates"]["crit"], &p["rates"]["paralysis"], &p["rarity"],
        ]
        .map(|v| v.as_i64().unwrap());
        if mine != theirs || p["model"] != models[&r.row].as_str() {
            diffs.push(format!("row {}: rust {mine:?} python {theirs:?}", r.row));
        }
    }
    if compared != by_row.len() {
        diffs.push(format!("row count rust {compared} python {}", by_row.len()));
    }
    report("enemies", &diffs, compared);

    // Stages, spawners (without script info) and drop pools.
    let py_stages = load(py, "stages.json");
    let py_pools = load(py, "drops.json");
    let py_by_id: HashMap<&str, &Value> = py_stages["stages"].as_array().unwrap().iter().map(|s| (s["id"].as_str().unwrap(), s)).collect();
    let all = stages::list_stages(&ndmw).unwrap();
    let mut diffs = Vec::new();
    let mut generators = 0;
    for st in &all {
        let Some(p) = py_by_id.get(st.id.as_str()) else {
            diffs.push(format!("{} missing in python", st.id));
            continue;
        };
        if p["packs"] != serde_json::json!(st.packs) || p["manifestEntry"] != st.manifest_entry {
            diffs.push(format!("{} packs/manifest differ", st.id));
        }
        for d in ["normal", "hard", "veryhard"] {
            let Some(idx) = st.generator_pack(d) else { continue };
            if p["generatorPacks"][d] != idx {
                diffs.push(format!("{} {d} generator pack rust {idx} python {}", st.id, p["generatorPacks"][d]));
            }
            let gens = Pack::new(ndmw.entry(idx).unwrap()).unwrap().generators().unwrap();
            let theirs = p["difficulties"][d]["generators"].as_array().unwrap();
            if gens.len() != theirs.len() {
                diffs.push(format!("{} {d}: {} spawners vs {}", st.id, gens.len(), theirs.len()));
                continue;
            }
            for (g, t) in gens.iter().zip(theirs) {
                generators += 1;
                let spawns: Vec<Vec<f64>> = g.spawns().iter().map(|p| p.iter().map(|v| importer::pyfmt::round(*v, 3)).collect()).collect();
                let checks = [
                    ("name", serde_json::json!(g.name)),
                    ("spawns", serde_json::json!(spawns)),
                    ("rotations", serde_json::json!(g.rotations)),
                    ("startMode", serde_json::json!(g.start_mode.str())),
                    ("fillMode", serde_json::json!(g.fill_mode.str())),
                ];
                for (key, value) in checks {
                    if t[key] != value {
                        diffs.push(format!("{} {d} {} {key}: rust {value} python {}", st.id, g.name, t[key]));
                    }
                }
                let trigger = g.trigger().map(|(c, r)| serde_json::json!({"center": c.map(|v| importer::pyfmt::round(v, 3)), "radius": r}));
                if t.get("trigger").cloned() != trigger {
                    diffs.push(format!("{} {d} {} trigger: rust {trigger:?} python {:?}", st.id, g.name, t.get("trigger")));
                }
                for pool in g.slots.iter().flat_map(|s| s.pools.iter().chain(&s.last_pools)) {
                    let total: i64 = pool.entries.iter().map(|e| e.rate).sum();
                    if py_pools["pools"][&pool.name]["totalRate"] != total {
                        diffs.push(format!("pool {} totalRate rust {total} python {}", pool.name, py_pools["pools"][&pool.name]["totalRate"]));
                    }
                }
            }
        }
    }
    report("stages and spawners", &diffs, generators);

    // Banners: same pixels.
    let names = importer::manifest::read_names(&iso::open_disc_file(&disc, &files, "NDMW.IGB").unwrap().read_all().unwrap()).unwrap();
    let mut diffs = Vec::new();
    let mut compared = 0;
    for st in &all {
        let tex = importer::banners::load(&area, &names, &st.id).unwrap();
        let path = py.join("banners").join(format!("{}.png", st.id));
        match (tex, path.exists()) {
            (Some(t), true) => {
                compared += 1;
                let (w, h, px) = png_pixels(&std::fs::read(&path).unwrap());
                if (w as usize, h as usize) != (t.width, t.height) || px != t.rgba {
                    diffs.push(format!("{} banner pixels differ", st.id));
                }
            }
            (None, false) => {}
            (mine, theirs) => diffs.push(format!("{} banner: rust {} python {theirs}", st.id, mine.is_some())),
        }
    }
    report("banners", &diffs, compared);
}

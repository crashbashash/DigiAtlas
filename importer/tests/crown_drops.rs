//! Verify loot links and weights against the patched disc, including shared names and exemptions.
//! Set DIGIATLAS_CROWN_DROPS_GC_ISO / DIGIATLAS_CROWN_DROPS_PS2_ISO to opt in.
use importer::{afs::Afs, generators::Pack, iso};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[test]
fn crown_drops_match_disc_tables_for_all_difficulties_and_party_sizes() {
    for platform in ["GC", "PS2"] {
        let Some(path) = std::env::var_os(format!("DIGIATLAS_CROWN_DROPS_{platform}_ISO")) else { continue };
        let keep = std::env::var_os("DIGIATLAS_CROWN_DROPS_OUT");
        let out = keep
            .as_ref()
            .map(|p| Path::new(p).join(platform.to_lowercase()))
            .unwrap_or_else(|| std::env::temp_dir().join(format!("digiatlas-drops-{platform}-{}", std::process::id())));
        let image = path.clone();
        let worker_out = out.clone();
        let metadata = std::thread::Builder::new()
            .stack_size(importer::STACK_SIZE)
            .spawn(move || importer::export(Path::new(&image), &worker_out, false, &mut |_| {}))
            .unwrap()
            .join()
            .unwrap()
            .unwrap();
        assert_eq!(metadata["mod"]["options"]["betterLoot"], true);
        let load = |name: &str| serde_json::from_slice::<Value>(&std::fs::read(out.join(name)).unwrap()).unwrap();
        let stages = load("stages.json");
        let drops = load("drops.json");
        let source = iso::Source::open(Path::new(&path)).unwrap();
        let files =
            if platform == "GC" { importer::gamecube::list_files(&source) } else { iso::list_files(&source) }.unwrap();
        let ndmw = Afs::open(iso::open_disc_file(&source, &files, "NDMW.AFS").unwrap()).unwrap();
        let mut checked = 0;
        let mut failed = 0;
        let mut examples = Vec::new();
        let mut named = HashMap::<String, HashSet<String>>::new();
        for stage in stages["stages"].as_array().unwrap() {
            for difficulty in ["normal", "hard", "veryhard"] {
                let Some(pack) = stage["generatorPacks"][difficulty].as_u64() else { continue };
                let raw = Pack::new(ndmw.entry(pack as usize).unwrap()).unwrap().generators().unwrap();
                let records = stage["difficulties"][difficulty]["generators"].as_array().unwrap();
                for (g, record) in raw.iter().zip(records) {
                    assert_eq!(record["name"], g.name);
                    for (player, slot) in g.slots.iter().enumerate() {
                        let profile = record.get("players").and_then(|p| p.get(player));
                        for (field, pools) in [("drops", &slot.pools), ("lastDrops", &slot.last_pools)] {
                            let links = profile.and_then(|p| p.get(field)).unwrap_or(&record[field]);
                            for (d, name) in ["normal", "hard", "veryhard"].iter().enumerate() {
                                let actual = links[*name].as_str().map(|key| &drops["pools"][key]);
                                let expected = pools.get(d).map(|pool| {
                                    let entries: Vec<_> = pool.entries.iter().map(|e| json!({"category":e.category,"id":e.id,"rank":e.rank,"rate":e.rate})).collect();
                                    named.entry(pool.name.clone()).or_default().insert(serde_json::to_string(&entries).unwrap());
                                    json!({"entries":entries,"totalRate":pool.entries.iter().map(|e| e.rate).sum::<i64>()})
                                });
                                let matches = match (&expected, actual) {
                                    (Some(e), Some(a)) => {
                                        a["entries"] == e["entries"] && a["totalRate"] == e["totalRate"]
                                    }
                                    (None, None) => true,
                                    _ => false,
                                };
                                checked += 1;
                                if !matches {
                                    failed += 1;
                                    if examples.len() < 10 {
                                        examples.push(format!(
                                            "{} {difficulty} {} players={} {field}.{name}: exported={} expected={}",
                                            stage["id"],
                                            g.name,
                                            player + 1,
                                            actual
                                                .map(|a| a["totalRate"].to_string())
                                                .unwrap_or_else(|| "missing".into()),
                                            expected
                                                .as_ref()
                                                .map(|e| e["totalRate"].to_string())
                                                .unwrap_or_else(|| "none".into())
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        eprintln!(
            "{platform}: checked {checked} loot references; {failed} mismatches; {} names have multiple disc tables",
            named.values().filter(|v| v.len() > 1).count()
        );
        for example in examples {
            eprintln!("{example}");
        }
        assert_eq!(failed, 0, "every party/difficulty/ordinary/final loot reference must match the disc");
        if keep.is_none() {
            std::fs::remove_dir_all(out).unwrap();
        }
    }
}

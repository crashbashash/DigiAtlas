//! Checks against a real disc. They run only when `DIGIATLAS_PS2_ISO` names a Digimon World 4
//! (USA) PS2 image; without it every test passes without doing anything.
//!
//!     DIGIATLAS_PS2_ISO="/path/to/Digimon World 4 (USA).iso" cargo test --test disc

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use importer::afs::Afs;
use importer::{banners, iso, manifest as archive_manifest, maps, names};
use regex::Regex;
use serde_json::{json, Value};

fn disc() -> Option<PathBuf> {
    std::env::var_os("DIGIATLAS_PS2_ISO").map(PathBuf::from)
}

/// The disc exported once (without maps) for every test, or None when no disc is set.
fn exported() -> Option<&'static Path> {
    static OUT: OnceLock<Option<PathBuf>> = OnceLock::new();
    OUT.get_or_init(|| {
        let iso = disc()?;
        let out = std::env::temp_dir().join(format!("digiatlas-disc-test-{}", std::process::id()));
        // A fresh folder: files left by an earlier run would change the counts.
        let _ = std::fs::remove_dir_all(&out);
        importer::export(&iso, &out, false, &mut |_| {}).expect("export the disc");
        Some(out)
    })
    .as_deref()
}

fn load(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(exported().unwrap().join(name)).unwrap()).unwrap()
}

fn stages() -> BTreeMap<String, Value> {
    load("stages.json")["stages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["id"].as_str().unwrap().to_string(), s.clone()))
        .collect()
}

fn generators<'a>(stage: &'a Value, difficulty: &str) -> HashMap<&'a str, &'a Value> {
    stage["difficulties"][difficulty]["generators"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| (g["name"].as_str().unwrap(), g))
        .collect()
}

fn every_generator(f: &mut dyn FnMut(&str, &Value)) {
    for (id, stage) in stages() {
        for d in stage["difficulties"].as_object().unwrap().values() {
            for g in d["generators"].as_array().unwrap() {
                f(&id, g);
            }
        }
    }
}

fn ndmw() -> Afs {
    let source = iso::Source::open(&disc().unwrap()).unwrap();
    let files = iso::list_files(&source).unwrap();
    Afs::open(iso::open_disc_file(&source, &files, "NDMW.AFS").unwrap()).unwrap()
}

fn packs(stage: &Value) -> Vec<usize> {
    stage["packs"].as_array().unwrap().iter().map(|p| p.as_u64().unwrap() as usize).collect()
}

macro_rules! needs_disc {
    () => {
        if exported().is_none() {
            eprintln!("set DIGIATLAS_PS2_ISO to run the disc checks");
            return;
        }
    };
}

#[test]
fn counts_and_verification() {
    needs_disc!();
    let manifest = load("manifest.json");
    assert_eq!(manifest["serial"], "SLUS-20836");
    assert_eq!(manifest["source"]["statTableVerified"], true);
    assert_eq!(manifest["counts"]["enemyRows"], 580);
    assert_eq!(manifest["counts"]["stages"], 98);
    assert_eq!(manifest["counts"]["stagesWithGenerators"], 81);
    assert_eq!(manifest["exporter"], json!({"name": "digiatlas-importer", "version": importer::IMPORTER_VERSION}));
}

#[test]
fn documented_pool_totals() {
    needs_disc!();
    // DW4_Decomp docs/systems/drop-tables.md section 2: crate pools and the guaranteed boss drop.
    let pools = load("drops.json")["pools"].clone();
    assert_eq!(pools["nZ1obje1"]["totalRate"], 4330);
    assert_eq!(pools["hZ1obje1"]["totalRate"], 6050);
    assert_eq!(pools["vZ1obje1"]["totalRate"], 5910);
    assert_eq!(pools["nZ1mec41"]["totalRate"], 10000);
}

#[test]
fn difficulty_packs_scale_spawn_rows() {
    needs_disc!();
    // Goblin Fortress guard room: the same spawner points at stronger rows per difficulty.
    let stage = &stages()["stagGF01"];
    let rows: BTreeMap<&str, &Value> = stage["difficulties"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(d, v)| (d.as_str(), &v["generators"][0]["row"]))
        .collect();
    assert_eq!(rows, BTreeMap::from([("hard", &json!(6)), ("normal", &json!(2)), ("veryhard", &json!(10))]));
}

#[test]
fn known_names() {
    needs_disc!();
    let enemies: HashMap<i64, Value> = load("enemies.json")["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["row"].as_i64().unwrap(), r.clone()))
        .collect();
    assert_eq!(enemies[&1]["name"], "Goburimon");
    assert_eq!(enemies[&1]["hp"], 58);
    assert_eq!(enemies[&36]["name"], "Ogremon");
    assert_eq!(enemies[&370]["kind"], "object");
    let items = load("items.json");
    let name = |cat: &str, id: i64| {
        items["items"].as_array().unwrap().iter().find(|i| i["category"] == cat && i["id"] == id).unwrap()["name"]
            .as_str()
            .unwrap()
            .to_string()
    };
    // DW4_Decomp docs/systems/drop-tables.md section 5: guard-room boss drops.
    assert!(name("weapon", 175).starts_with("Mighty Talon"));
    assert!(name("weapon", 200).starts_with("Beam Magnum"));
}

#[test]
fn item_stats_agree_with_their_description_text() {
    needs_disc!();
    let recovers = Regex::new(r"Recovers (\d+) (HP|MP)").unwrap();
    let equip = Regex::new(r"Equip\. Level (\d+)").unwrap();
    let chip = Regex::new(r"^(Wisdom|Spirit|Speed) up (\d+) pts").unwrap();
    let mut checked = 0;
    for i in load("items.json")["items"].as_array().unwrap() {
        let text = i["description"].as_str().unwrap_or("");
        let stat = |k: &str| i["stats"].get(k).and_then(Value::as_i64);
        if let Some(m) = recovers.captures(text) {
            let key = if &m[2] == "HP" { "restoreHp" } else { "restoreMp" };
            assert_eq!(stat(key), m[1].parse().ok(), "{}", i["name"]);
            checked += 1;
        }
        if ["armor1", "armor2"].contains(&i["category"].as_str().unwrap()) {
            if let Some(m) = equip.captures(text) {
                assert_eq!(stat("equipLevel"), m[1].parse().ok(), "{}", i["name"]);
                checked += 1;
            }
        }
        if i["category"] == "abChip" {
            if let Some(m) = chip.captures(text) {
                assert_eq!(stat(&m[1].to_lowercase()), m[2].parse().ok(), "{}", i["name"]);
                checked += 1;
            }
        }
    }
    assert!(checked > 100);
}

#[test]
fn weapon_skill_text_matches_the_data_except_known_quirks() {
    needs_disc!();
    let skill = Regex::new(r"Equip\. Skill (\w+) Skill\s+(\d+)").unwrap();
    let (mut quirks, mut checked) = (Vec::new(), 0);
    for i in load("items.json")["items"].as_array().unwrap().iter().filter(|i| i["category"] == "weapon") {
        if i["unidentified"] == true {
            // The placeholder weapon has no skill text or type.
            assert_eq!((&i["id"], i.get("skillType")), (&json!(276), None));
            continue;
        }
        checked += 1;
        let text = i["description"].as_str().unwrap();
        let m = skill.captures(text).unwrap();
        let unique = text.contains("nontransferable");
        let required = i["stats"].get("requiredSkill").and_then(Value::as_i64).unwrap_or(0);
        if Some(&m[1]) != i["skillType"].as_str() || (!unique && m[2].parse::<i64>().unwrap() != required) {
            quirks.push(i["id"].as_i64().unwrap());
        }
    }
    assert_eq!(checked, 276);
    // Dbl Axe .. Meteor Force (ids 100-124) read "Bash Skill" but are stored as Blunt.
    assert_eq!(quirks, (100..125).collect::<Vec<_>>());
}

#[test]
fn stage_names_match_their_banners() {
    needs_disc!();
    let out = exported().unwrap();
    let all = stages();
    assert_eq!(all.len(), 98);
    let mut with_banner = 0;
    for (id, s) in &all {
        let entry = &names::stages()[id];
        assert_eq!((&s["area"], &s["room"]), (&entry["area"], &entry["room"]), "{id}");
        if entry["source"] == "banner" {
            assert!(out.join(s["banner"].as_str().unwrap()).is_file(), "{id}");
            with_banner += 1;
        }
    }
    assert_eq!(with_banner, 92);
    assert_eq!(std::fs::read_dir(out.join("banners")).unwrap().count(), 92);
}

#[test]
fn banner_fingerprints_match_the_transcriptions() {
    needs_disc!();
    let source = iso::Source::open(&disc().unwrap()).unwrap();
    let files = iso::list_files(&source).unwrap();
    let names_bytes = iso::open_disc_file(&source, &files, "NDMW.IGB").unwrap().read_all().unwrap();
    let archive_names = archive_manifest::read_names(&names_bytes).unwrap();
    let area = Afs::open(iso::open_disc_file(&source, &files, "AREA.AFS").unwrap()).unwrap();
    for (id, entry) in names::stages().as_object().unwrap() {
        if id.starts_with('_') || entry["source"] != "banner" {
            continue;
        }
        let tex = banners::load(&area, &archive_names, id).unwrap().unwrap();
        assert_eq!(banners::fingerprint(&tex), entry["band"].as_str().unwrap(), "{id}");
    }
}

#[test]
fn goblin_pass_scripts_match_what_the_scripts_do() {
    needs_disc!();
    // Hand-read from DW4_Decomp lua_cleaned/02-valley-overworld/01-stag0101-valley-entrance_e614.
    let all = stages();
    let gens = generators(&all["stag0101"], "normal");
    for name in ["GENE-01", "GENE-02", "GENE-03", "GENE-04", "GENE-05", "GENE-14"] {
        assert_eq!(gens[name]["script"]["status"], "none", "{name}");
    }
    let trap = &gens["GENE-53"]["script"];
    assert_eq!(trap["status"], "referenced");
    assert!(trap["refs"][0]["when"][0].as_str().unwrap().contains("this is the first time (event 339)"));
    let whens = |g: &str| -> Vec<String> {
        gens[g]["script"]["refs"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|r| r["when"].as_array().unwrap().iter().map(|w| w.as_str().unwrap().to_string()))
            .collect()
    };
    assert!(whens("GENE-22").iter().any(|w| w.contains("this is the first time (event 355)")));
    let epic = gens["GENE-e00"]["script"]["refs"][0]["when"].as_array().unwrap();
    assert!(epic[0].as_str().unwrap().contains("events 598-610 done"));
    assert!(epic[0].as_str().unwrap().contains("610: Final boss story scene done"));
    assert!(epic[1].as_str().unwrap().contains("you play as Agumon"));
    assert_eq!(gens["GENE-00"]["startMode"], "radar");
    // The Field Box is gated by the lever.
    assert!(whens("GBOX-01").join(" ").contains("lever"));
}

#[test]
fn every_spawner_has_a_script_status() {
    needs_disc!();
    every_generator(&mut |id, g| {
        assert!(
            ["referenced", "dynamic", "unknown", "none"].contains(&g["script"]["status"].as_str().unwrap()),
            "{id}"
        );
    });
}

#[test]
fn player_counts_scale_spawners() {
    needs_disc!();
    let all = stages();
    let gens = generators(&all["stag0101"], "normal");
    let counts = |g: &str, key: &str| -> Vec<i64> {
        gens[g]["players"].as_array().unwrap().iter().map(|e| e[key].as_i64().unwrap()).collect()
    };
    // The bridge spawner places 2, 3, 4 or 5 enemies for 1 to 4 players.
    assert_eq!(counts("GENE-00", "count"), [2, 3, 4, 5]);
    // A lone Numemon grows by one per player but is capped at one alive at a time.
    assert_eq!(counts("GENE-14", "count"), [1, 2, 3, 4]);
    assert_eq!(counts("GENE-14", "maxCount"), [1, 1, 1, 1]);
    // The fourth entry of GENE-01 repeats the third; a set would have lost it.
    assert_eq!(gens["GENE-01"]["players"].as_array().unwrap().len(), 4);
    let pools = load("drops.json")["pools"].clone();
    every_generator(&mut |_, g| {
        let entries = std::iter::once(g).chain(g.get("players").and_then(Value::as_array).into_iter().flatten());
        for e in entries {
            for key in ["drops", "lastDrops"] {
                for name in e.get(key).and_then(Value::as_object).into_iter().flat_map(|m| m.values()) {
                    assert!(pools.get(name.as_str().unwrap()).is_some(), "{name}");
                }
            }
        }
    });
}

#[test]
fn radar_triggers_match_the_documented_radii() {
    needs_disc!();
    let mut radii = BTreeSet::new();
    every_generator(&mut |id, g| {
        if g["startMode"] == "radar" {
            let r = g["trigger"]["radius"].as_f64().unwrap_or_else(|| panic!("{id} {} has no trigger", g["name"]));
            radii.insert((r * 1000.0) as i64);
            // The game stores squared radii as whole numbers, from tight (20) to wide arenas.
            assert!(r > 0.0 && r <= 500.0 && ((r * r).round() - r * r).abs() < 1e-9, "{id} {r}");
        }
    });
    assert!(!radii.is_empty());
    let all = stages();
    assert_eq!(
        generators(&all["stag0101"], "normal")["GENE-00"]["trigger"],
        json!({"center": [455.0, 50.0, 15.0], "radius": 65.0})
    );
}

#[test]
fn stage_maps_cover_their_spawn_points() {
    needs_disc!();
    // Three stage types: field, dungeon floor and fortress room, each cropped to its spawn area.
    let ndmw = ndmw();
    let all = stages();
    for id in ["stag0102", "dng101b1", "stagGF01"] {
        let st = &all[id];
        let mut points = Vec::new();
        every_generator(&mut |sid, g| {
            if sid == id {
                for p in g["spawns"].as_array().unwrap() {
                    let p: Vec<f64> = p.as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
                    points.push([p[0], p[1], p[2]]);
                }
            }
        });
        let built = maps::build(&ndmw, &packs(st), &points, &[]).unwrap().unwrap_or_else(|| panic!("{id} has no map"));
        assert!(built.coverage >= 0.95, "{id}");
        assert!(built.raster.fill() > 0.0, "{id}");
        assert!(built.png().unwrap().starts_with(b"\x89PNG"));
    }
}

#[test]
fn stages_without_spawners_do_not_borrow_the_next_stages() {
    needs_disc!();
    // Trader Hall (a shop) has no generator packs; the Dungeon of Doom's follow it on the disc.
    let all = stages();
    for id in ["dngq5b1e", "dngq5b1h", "dngq5b1v"] {
        assert!(all[id]["generatorPacks"].is_null(), "{id}");
        assert!(all[id]["difficulties"].as_object().unwrap().is_empty(), "{id}");
    }
    assert_eq!(all["dngq6b01"]["difficulties"]["normal"]["generators"].as_array().unwrap().len(), 39);
}

#[test]
fn shop_and_lobby_rooms_get_a_map_without_spawn_points() {
    needs_disc!();
    let ndmw = ndmw();
    let all = stages();
    for id in ["dngq5b1e", "dngq5b1h", "dngq5b1v", "stagML11"] {
        let built =
            maps::build(&ndmw, &packs(&all[id]), &[], &[]).unwrap().unwrap_or_else(|| panic!("{id} has no map"));
        assert!(built.raster.fill() < 0.9, "{id}"); // an outline, not a flat arena
    }
}

#[test]
fn trader_hall_trades() {
    needs_disc!();
    let all = stages();
    let items = load("items.json");
    let item_names: HashMap<(String, i64), String> = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            (
                (i["category"].as_str().unwrap().to_string(), i["id"].as_i64().unwrap()),
                i["name"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    let key = |side: &Value| (side["category"].as_str().unwrap().to_string(), side["id"].as_i64().unwrap());
    let mut counts = BTreeMap::new();
    for id in ["dngq5b1e", "dngq5b1h", "dngq5b1v"] {
        let traders = all[id]["trades"].as_array().unwrap();
        counts.insert(id, traders.len());
        for t in traders {
            assert!(!t["tables"].as_object().unwrap().is_empty(), "{id} {}", t["trader"]);
            for offers in t["tables"].as_object().unwrap().values() {
                for o in offers.as_array().unwrap() {
                    assert!(
                        item_names.contains_key(&key(&o["give"])) && item_names.contains_key(&key(&o["get"])),
                        "{id} {o}"
                    );
                }
            }
        }
    }
    // Everyone stands in the room, and the variants differ in who is there.
    assert_eq!(counts, BTreeMap::from([("dngq5b1e", 10), ("dngq5b1h", 8), ("dngq5b1v", 10)]));
    let agumons: Vec<&Value> =
        all["dngq5b1h"]["trades"].as_array().unwrap().iter().filter(|t| t["trader"] == "Agumon").collect();
    assert_eq!(agumons.iter().map(|t| t["number"].clone()).collect::<Vec<_>>(), [json!(1), json!(2)]);
    assert_eq!(agumons[0]["position"], json!({"x": -80.0, "y": 10.0, "z": 20.0}));
    assert_eq!(item_names[&key(&agumons[0]["tables"]["hard"][0]["give"])], "Offering");
    // Each difficulty has its own table.
    assert_ne!(agumons[0]["tables"]["normal"], agumons[0]["tables"]["hard"]);
    assert_eq!(all["stag0101"]["trades"], json!([]));
}

#[test]
fn appraiser_tables() {
    needs_disc!();
    let data = load("items.json");
    let items: HashMap<(String, i64), &Value> = data["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| ((i["category"].as_str().unwrap().to_string(), i["id"].as_i64().unwrap()), i))
        .collect();
    let block = &data["appraisal"];
    assert_eq!(block["cost"], 300);
    assert_eq!(block["tiers"].as_array().unwrap().len(), 6);
    for tier in block["tiers"].as_array().unwrap() {
        for (category, found) in tier["results"].as_object().unwrap() {
            let found = found.as_array().unwrap();
            assert_eq!(
                found.iter().map(|r| r["rate"].as_i64().unwrap()).sum::<i64>(),
                10000,
                "{} {category}",
                tier["tier"]
            );
            for r in found {
                let item = items[&(r["category"].as_str().unwrap().to_string(), r["id"].as_i64().unwrap())];
                assert!(item.get("unidentified").is_none());
            }
        }
    }
    let first = &block["tiers"][0]["results"]["weapon"][0];
    let item = items[&(first["category"].as_str().unwrap().to_string(), first["id"].as_i64().unwrap())];
    assert_eq!((&item["name"], &first["rate"]), (&json!("Battle Hawk α"), &json!(5960)));
}

#[test]
fn unidentified_placeholders() {
    needs_disc!();
    let items = load("items.json");
    let items = items["items"].as_array().unwrap();
    let flagged: BTreeSet<(String, i64)> = items
        .iter()
        .filter(|i| i["unidentified"] == true)
        .map(|i| (i["category"].as_str().unwrap().to_string(), i["id"].as_i64().unwrap()))
        .collect();
    assert_eq!(flagged, BTreeSet::from([("armor1".into(), 31), ("armor2".into(), 44), ("weapon".into(), 276)]));
    assert!(items.iter().all(|i| !i["name"].as_str().unwrap().contains('?')));
    assert!(items.iter().filter(|i| i["unidentified"] == true).all(|i| i["stats"].get("equipLevel").is_none()));
}

#[test]
fn every_dropped_item_has_a_name() {
    needs_disc!();
    let items = load("items.json");
    let known: BTreeSet<(String, i64)> = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| (i["category"].as_str().unwrap().to_string(), i["id"].as_i64().unwrap()))
        .collect();
    for pool in load("drops.json")["pools"].as_object().unwrap().values() {
        for e in pool["entries"].as_array().unwrap() {
            assert!(known.contains(&(e["category"].as_str().unwrap().to_string(), e["id"].as_i64().unwrap())), "{e}");
        }
    }
}

#[test]
fn spawner_rows_resolve_except_the_known_empty_slot() {
    needs_disc!();
    // Three Kokatorimon spawners in stag0104 point at row 90, an empty slot between the Blossomon
    // and Kokatorimon rows (a quirk of the game's data).
    let rows: BTreeSet<i64> =
        load("enemies.json")["rows"].as_array().unwrap().iter().map(|r| r["row"].as_i64().unwrap()).collect();
    let mut missing = BTreeSet::new();
    every_generator(&mut |_, g| {
        let row = g["row"].as_i64().unwrap();
        if !rows.contains(&row) {
            missing.insert(row);
        }
    });
    assert!(missing.is_subset(&BTreeSet::from([90])), "unresolved spawn rows: {missing:?}");
}

#[test]
fn disc_sourced_enemy_names_appear_in_the_card_album() {
    needs_disc!();
    let source = iso::Source::open(&disc().unwrap()).unwrap();
    let files = iso::list_files(&source).unwrap();
    let area = Afs::open(iso::open_disc_file(&source, &files, "AREA.AFS").unwrap()).unwrap();
    let graph = importer::igb::Graph::new(area.entry(621).unwrap()).unwrap();
    let album: BTreeSet<&str> =
        graph.s2.iter().filter(|r| r.class == "igNamedObject").filter_map(|r| r.name.as_deref()).collect();
    for (model, entry) in names::enemies().as_object().unwrap() {
        if !model.starts_with('_') && entry["source"] == "disc" {
            assert!(album.contains(entry["name"].as_str().unwrap()), "{model} is not in the card album");
        }
    }
}

#[test]
fn output_matches_the_published_schema() {
    needs_disc!();
    let schemas = Path::new(env!("CARGO_MANIFEST_DIR")).join("../schema/v1");
    for name in ["manifest", "enemies", "drops", "stages", "items"] {
        let schema: Value =
            serde_json::from_str(&std::fs::read_to_string(schemas.join(format!("{name}.schema.json"))).unwrap())
                .unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        assert!(!validator.is_valid(&json!({"unexpected": true})), "{name} schema accepts anything");
        let doc = load(&format!("{name}.json"));
        let errors: Vec<String> =
            validator.iter_errors(&doc).take(5).map(|e| format!("{} at {}", e, e.instance_path)).collect();
        assert!(errors.is_empty(), "{name}.json: {errors:#?}");
    }
}

#[test]
fn boss_health_bars_mark_the_boss_fights() {
    needs_disc!();
    let all = stages();
    let bar = |id: &str, gene: &str| generators(&all[id], "normal")[gene].get("bossHealthBar") == Some(&json!(true));
    // The Goblin Fortress guard before Leomon, a dungeon boss and an overworld boss.
    assert!(bar("stagGF03", "GENE-00"));
    assert!(bar("dng101b2", "GENE-08"));
    assert!(bar("stag0202", "GENE-s01"));
    // Regular spawners in the same rooms have none.
    assert!(!bar("dng101b2", "GENE-01"));
    let mut count = 0;
    every_generator(&mut |_, g| count += g.get("bossHealthBar").is_some() as usize);
    assert!(count > 40, "{count}");
}

#[test]
fn power_spell_data_and_save_growth() {
    needs_disc!();
    let data = load("items.json");
    let spells = data["powerSpells"].as_array().unwrap();
    assert_eq!(spells.len(), 10);
    for tier in 0..5 {
        assert_eq!(spells[tier]["baseFrames"], 1800 + tier * 360);
        assert_eq!(spells[tier + 5]["baseFrames"], 1200 + tier * 360);
        assert_eq!(spells[tier]["kind"], "up");
        assert_eq!(spells[tier + 5]["kind"], "down");
        assert_eq!(spells[tier]["row"], 80 + tier);
        assert_eq!(spells[tier + 5]["row"], 85 + tier);
    }
    let forms = data["saveStats"]["forms"].as_array().unwrap();
    assert_eq!(forms.len(), 16);
    assert_eq!(forms[3]["model"], "p_dorumon");
    assert_eq!(forms[3]["name"], "Dorumon");
    assert!(forms.iter().all(|f| f["strengthInitial"].is_i64() && f["strengthGrowth"].is_i64()));
    assert!(data["saveStats"]["strengthBoards"].is_array());
    assert!(data["saveStats"]["speedBoards"].is_array());
    assert!(forms.iter().all(|f| f["speedInitial"].is_i64() && f["speedGrowth"].is_i64()));
    assert!(forms.iter().all(|f| f["wisdomInitial"].is_i64() && f["wisdomGrowth"].is_i64()));
}

#[test]
fn normal_attack_counts_follow_weapon_sequence_mapping() {
    needs_disc!();
    let data = load("items.json");
    let items = data["items"].as_array().unwrap();
    let weapon = |id| items.iter().find(|i| i["category"] == "weapon" && i["id"] == id).unwrap();
    for id in 150..=154 {
        assert_eq!(weapon(id)["normalHits"], 2, "Dbl Rapier grade {id}");
    }
    assert_eq!(weapon(274)["normalHits"], 2, "Crush Arm");
    assert_eq!(weapon(100)["normalHits"], 2, "Dbl Axe");
    assert_eq!(weapon(0)["normalHits"], 1, "Battle Hawk");
    assert_eq!(weapon(30)["normalHits"], 1, "War Sword");
    assert!(weapon(264).get("normalHits").is_none(), "Unverified gun profiles must not be guessed");
}

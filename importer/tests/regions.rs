//! Optional end-to-end checks against privately supplied PS2 discs; no game data is checked in.
//! Set DIGIATLAS_PS2_USA_ISO / DIGIATLAS_PS2_EUROPE_ISO / DIGIATLAS_PS2_JAPAN_ISO.
use std::path::Path;

use importer::regions::{GAMECUBE_RELEASES, RELEASES};
use serde_json::Value;

#[test]
fn battle_arena_map_covers_its_spawns() {
    for release in RELEASES.into_iter().chain(GAMECUBE_RELEASES) {
        let variable = format!("DIGIATLAS_{}_{}_ISO", release.platform.to_uppercase(), release.region.to_uppercase());
        let Some(path) = std::env::var_os(&variable) else { continue };
        let source = importer::iso::Source::open(Path::new(&path)).unwrap();
        let files = if release.platform == "gc" {
            importer::gamecube::list_files(&source)
        } else {
            importer::iso::list_files(&source)
        }
        .unwrap();
        let ndmw =
            importer::afs::Afs::open(importer::iso::open_disc_file(&source, &files, "NDMW.AFS").unwrap()).unwrap();
        let directory = importer::manifest::read_files(
            importer::iso::open_disc_file(&source, &files, "NDMW.IGB").unwrap().read_all().unwrap(),
        )
        .unwrap();
        let stages = importer::stages::list_stages(&ndmw, &directory).unwrap();
        let stage = stages.iter().find(|s| s.id == "stag0401").unwrap();
        let spawns: Vec<_> = stage
            .generator_packs
            .iter()
            .flat_map(|(_, entry)| {
                importer::generators::Pack::new(ndmw.entry(*entry).unwrap()).unwrap().generators().unwrap()
            })
            .flat_map(|g| g.spawns())
            .collect();
        assert!(!spawns.is_empty(), "{} {}", release.platform, release.region);
        // GameCube USA's type metadata contains an incidental two-record chain before
        // the real directory. It must not make the geometry pack disappear.
        let map = importer::maps::build(&ndmw, &stage.id, &stage.packs, &spawns, &[])
            .unwrap()
            .unwrap_or_else(|| panic!("{} {} Battle Arena has no map", release.platform, release.region));
        assert!(map.coverage >= 0.95, "{} {}: {}", release.platform, release.region, map.coverage);
        assert!(map.raster.fill() > 0.0);
        assert!(map.png().unwrap().starts_with(b"\x89PNG"));
    }
}

#[test]
fn imports_supported_disc_regions() {
    let with_maps = std::env::var("DIGIATLAS_REGION_MAPS").as_deref() != Ok("0");
    for release in RELEASES.into_iter().chain(GAMECUBE_RELEASES) {
        let variable = format!("DIGIATLAS_{}_{}_ISO", release.platform.to_uppercase(), release.region.to_uppercase());
        let Some(path) = std::env::var_os(&variable) else { continue };
        let out = std::env::temp_dir().join(format!(
            "digiatlas-region-{}-{}-{}",
            release.platform,
            release.region,
            std::process::id()
        ));
        // The importer requires extra stack for the Lua decompiler even in test builds.
        let worker_out = out.clone();
        let manifest = std::thread::Builder::new()
            .stack_size(importer::STACK_SIZE)
            .spawn(move || importer::export(Path::new(&path), &worker_out, with_maps, &mut |_| {}))
            .unwrap()
            .join()
            .unwrap()
            .unwrap();
        assert_eq!(manifest["platform"], release.platform);
        assert_eq!(manifest["region"], release.region);
        assert_eq!(manifest["serial"], release.serial);
        assert_eq!(manifest["framesPerSecond"], release.frames_per_second);
        assert_eq!(manifest["counts"]["enemyRows"], 580);
        assert_eq!(manifest["counts"]["items"], 590);
        if with_maps {
            assert!(manifest["counts"]["stageMaps"].as_u64().unwrap() > 0);
        }
        let load = |name| serde_json::from_slice::<Value>(&std::fs::read(out.join(name)).unwrap()).unwrap();
        let stages = load("stages.json");
        for (id, count) in [("stagML11", 1), ("stagML12", 6), ("stagML13", 6)] {
            let stage = stages["stages"].as_array().unwrap().iter().find(|s| s["id"] == id).unwrap();
            assert_eq!(stage["services"].as_array().unwrap().len(), count, "{} {id}", release.region);
        }
        let river = stages["stages"].as_array().unwrap().iter().find(|s| s["id"] == "stag0103").unwrap();
        assert_eq!(river["landmarks"].as_array().unwrap().len(), 2);
        assert_eq!(river["boatRoute"].as_array().unwrap().len(), 46);
        let items = load("items.json");
        assert_eq!(items["powerSpells"].as_array().unwrap().len(), 10);
        assert_eq!(items["mpTechs"].as_array().unwrap().len(), 100);
        for tech in items["mpTechs"].as_array().unwrap() {
            assert!(tech["mpCost"].as_i64().unwrap() > 0);
            if tech["kind"] == "venom" || tech["kind"] == "fire" {
                assert!(tech["power"].as_i64().unwrap() > 0);
                assert_eq!(tech["skill"], "blast");
            }
        }
        let techs = items["mpTechs"].as_array().unwrap();
        assert_eq!(techs[50]["revive"]["hp"], 100);
        assert_eq!(techs[54]["revive"]["hp"], 6400);
        assert_eq!(techs[50]["revive"]["experiencePercent"], 59);
        assert_eq!(techs[54]["revive"]["experiencePercent"], 95);
        assert_eq!(techs[40]["healBase"], 300);
        assert_eq!(items["saveStats"]["forms"].as_array().unwrap().len(), 16);
        for form in items["saveStats"]["forms"].as_array().unwrap() {
            for stat in ["hp", "mp", "strength", "defense", "wisdom", "spirit", "speed"] {
                assert!(form[format!("{stat}Initial")].is_i64());
                assert!(form[format!("{stat}Growth")].is_i64());
            }
        }
        assert!(items["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["category"] == "weapon" && i["normalHits"].is_number()));
        for (name, schema_name) in [
            ("manifest.json", "manifest"),
            ("enemies.json", "enemies"),
            ("items.json", "items"),
            ("stages.json", "stages"),
            ("drops.json", "drops"),
        ] {
            let schema_path =
                Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../schema/v1/{schema_name}.schema.json"));
            let schema: Value = serde_json::from_slice(&std::fs::read(schema_path).unwrap()).unwrap();
            let validator = jsonschema::validator_for(&schema).unwrap();
            let data = load(name);
            let errors: Vec<_> = validator.iter_errors(&data).map(|e| e.to_string()).collect();
            assert!(errors.is_empty(), "{} {name}: {errors:?}", release.region);
        }
        std::fs::remove_dir_all(out).unwrap();
    }
}

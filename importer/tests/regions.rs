//! Optional end-to-end checks against privately supplied PS2 discs; no game data is checked in.
//! Set DIGIATLAS_PS2_USA_ISO / DIGIATLAS_PS2_EUROPE_ISO / DIGIATLAS_PS2_JAPAN_ISO.
use std::path::Path;

use importer::regions::{GAMECUBE_RELEASES, RELEASES};
use serde_json::Value;

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

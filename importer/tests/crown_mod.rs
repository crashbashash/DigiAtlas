//! Opt-in checks against signed Crown Mod images; game data stays outside the repository.
//! DIGIATLAS_CROWN_GC_ISO / DIGIATLAS_CROWN_PS2_ISO should name images with enemy randomization.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use importer::{afs::Afs, database, generators::Pack, iso, manifest, names, stats};
use serde_json::Value;

#[test]
fn randomized_spawns_match_each_stages_own_database_on_every_difficulty() {
    for platform in ["GC", "PS2"] {
        let Some(path) = std::env::var_os(format!("DIGIATLAS_CROWN_{platform}_ISO")) else { continue };
        let retained = std::env::var_os("DIGIATLAS_CROWN_OUT");
        let out = retained
            .as_ref()
            .map(|dir| Path::new(dir).join(platform))
            .unwrap_or_else(|| std::env::temp_dir().join(format!("digiatlas-crown-{platform}-{}", std::process::id())));
        let image = path.clone();
        let worker_out = out.clone();
        let metadata = std::thread::Builder::new()
            .stack_size(importer::STACK_SIZE)
            .spawn(move || importer::export(Path::new(&image), &worker_out, true, &mut |_| {}))
            .unwrap()
            .join()
            .unwrap()
            .unwrap();
        assert_eq!(metadata["mod"]["options"]["randomEnemies"], true);
        let load = |name: &str| serde_json::from_slice::<Value>(&std::fs::read(out.join(name)).unwrap()).unwrap();
        let enemies = load("enemies.json");
        let by_id: HashMap<_, _> =
            enemies["rows"].as_array().unwrap().iter().map(|e| (e["row"].as_u64().unwrap(), e)).collect();
        assert_eq!(by_id.len(), enemies["rows"].as_array().unwrap().len(), "enemy IDs are unique");

        let source = iso::Source::open(Path::new(&path)).unwrap();
        let files =
            if platform == "GC" { importer::gamecube::list_files(&source) } else { iso::list_files(&source) }.unwrap();
        let area = Afs::open(iso::open_disc_file(&source, &files, "AREA.AFS").unwrap()).unwrap();
        let ndmw = Afs::open(iso::open_disc_file(&source, &files, "NDMW.AFS").unwrap()).unwrap();
        let directory =
            manifest::read_files(iso::open_disc_file(&source, &files, "NDMW.IGB").unwrap().read_all().unwrap())
                .unwrap();
        let stages = load("stages.json");
        let mut checked = 0;
        let mut variants = 0;
        let mut boss_encounters = 0;
        let mut physical: BTreeMap<usize, BTreeSet<(String, i64, u64)>> = BTreeMap::new();
        for stage in stages["stages"].as_array().unwrap() {
            let boss_generator = match stage["id"].as_str().unwrap() {
                "dng101b2" => Some("GENE-08"),
                "dng102b3" => Some("GENE-12"),
                "dng204b2" => Some("GENE-13"),
                "dng205b3" => Some("GENE-15"),
                "dng307b2" => Some("GENE-11"),
                "dng308b3" => Some("GENE-19"),
                "dng309b4" => Some("GENE-24"),
                "dng411b3" => Some("GENE-23"),
                "dng412b4" => Some("GENE-21"),
                _ => None,
            };
            for difficulty in ["normal", "hard", "veryhard"] {
                if let Some(generator) = boss_generator {
                    assert!(
                        stage["generatorPacks"][difficulty].is_u64(),
                        "{} {difficulty}: missing boss pack",
                        stage["id"]
                    );
                    assert!(
                        stage["difficulties"][difficulty]["generators"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|g| g["name"] == generator),
                        "{} {difficulty}: missing boss encounter",
                        stage["id"]
                    );
                    boss_encounters += 1;
                }
                let Some(pack) = stage["generatorPacks"][difficulty].as_u64() else { continue };
                let entry = manifest::stage_database(&directory, pack as usize).unwrap().unwrap();
                let tables = database::read_tables(area.entry(entry).unwrap()).unwrap();
                let models = database::enemy_models(&tables).unwrap();
                let stats = stats::from_database(&tables["enemy"]).unwrap();
                let raw = Pack::new(ndmw.entry(pack as usize).unwrap()).unwrap().generators().unwrap();
                let exported = stage["difficulties"][difficulty]["generators"].as_array().unwrap();
                assert_eq!(exported.len(), raw.len());
                for (g, record) in raw.iter().zip(exported) {
                    let row = g.row.int().unwrap() as usize;
                    assert_eq!(record["name"], g.name);
                    let Some(model) = models.get(&row).filter(|_| !stats[row].is_empty()) else { continue };
                    let id = record["row"].as_u64().unwrap();
                    let enemy = by_id.get(&id).unwrap_or_else(|| {
                        panic!("{platform} {} {difficulty} {}: unresolved row {row}", stage["id"], g.name)
                    });
                    assert_eq!(enemy["model"], *model);
                    assert_eq!(enemy["name"], names::enemies()[model]["name"]);
                    assert_eq!(enemy["hp"], stats[row].hp);
                    assert_eq!(enemy["stats"]["strength"], stats[row].strength);
                    assert_eq!(enemy["stats"]["exp"], stats[row].exp);
                    assert_eq!(enemy["rarity"], stats[row].rarity);
                    for (key, value) in &stats[row].resist {
                        assert_eq!(enemy["resist"][*key], *value);
                    }
                    let positions: Vec<_> =
                        g.spawns().iter().map(|p| p.map(|v| importer::pyfmt::round(v, 3))).collect();
                    assert_eq!(record["spawns"], serde_json::json!(positions));
                    if !enemy["database"].is_null() {
                        assert_eq!(enemy["database"], serde_json::json!({"entry": entry, "row": row}));
                        physical.entry(row).or_default().insert((model.clone(), stats[row].hp, id));
                        variants += 1;
                    }
                    checked += 1;
                }
            }
            if matches!(stage["id"].as_str(), Some("stag0101" | "stag0102")) {
                assert_eq!(stage["map"]["floorSource"], "collision");
                assert!(stage["map"]["coverage"].as_f64().unwrap() >= 0.97);
            }
        }
        assert!(checked > 1000);
        assert!(variants > 100);
        assert_eq!(boss_encounters, 27, "all nine dungeon bosses export on all difficulties");
        assert!(
            physical.values().any(|rows| rows.iter().map(|(m, hp, _)| (m, hp)).collect::<BTreeSet<_>>().len() > 1),
            "physical rows are reused with different enemies or stats across stages"
        );
        for schema in ["manifest", "enemies", "stages", "items", "drops"] {
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../schema/v1/{schema}.schema.json"));
            let schema_json: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let validator = jsonschema::validator_for(&schema_json).unwrap();
            let data = load(&format!("{schema}.json"));
            let errors: Vec<_> = validator.iter_errors(&data).map(|e| e.to_string()).collect();
            assert!(errors.is_empty(), "{platform} {schema}: {errors:?}");
        }
        eprintln!("{platform}: checked {checked} spawns, {variants} local variants, {boss_encounters} boss encounters, all difficulties and schemas");
        if retained.is_none() {
            std::fs::remove_dir_all(out).unwrap();
        }
    }
}

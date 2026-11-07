//! Optional real-disc checks: the same door relationships must hold across supported releases.
use importer::{
    afs::Afs,
    doors, generators, iso,
    regions::{GAMECUBE_RELEASES, RELEASES},
    stages,
};
use serde_json::json;
use std::{collections::BTreeMap, path::Path};

#[test]
fn doors_link_buttons_keys_and_enemy_groups_on_supported_discs() {
    for release in RELEASES.into_iter().chain(GAMECUBE_RELEASES) {
        let variable = format!("DIGIATLAS_{}_{}_ISO", release.platform.to_uppercase(), release.region.to_uppercase());
        let Some(path) = std::env::var_os(variable) else { continue };
        let source = iso::Source::open(Path::new(&path)).unwrap();
        let files =
            if release.platform == "gc" { importer::gamecube::list_files(&source) } else { iso::list_files(&source) }
                .unwrap();
        let ndmw = Afs::open(iso::open_disc_file(&source, &files, "NDMW.AFS").unwrap()).unwrap();
        let all = stages::list_stages(&ndmw).unwrap();
        let extract = |id| {
            let stage = all.iter().find(|s| s.id == id).unwrap();
            let packs = stage.packs.iter().map(|entry| ndmw.entry(*entry).unwrap()).collect::<Vec<_>>();
            let diffs: BTreeMap<_, _> = stage
                .generator_packs
                .iter()
                .map(|(d, entry)| {
                    let generators = generators::Pack::new(ndmw.entry(*entry).unwrap())
                        .unwrap()
                        .generators()
                        .unwrap()
                        .iter()
                        .map(|g| json!({"name":g.name,"lua":g.lua.str()}))
                        .collect::<Vec<_>>();
                    (*d, json!({"generators":generators}))
                })
                .collect();
            doors::extract_mechanisms(&packs, &json!(diffs))
        };
        let dungeon = extract("dng102b1").doors;
        for (door, button) in [(1, 0), (3, 1)] {
            let door = dungeon.iter().find(|d| d.id == format!("g_d1door:{door}")).unwrap();
            assert_eq!(door.activations.len(), 1, "{} {}", release.platform, release.region);
            assert_eq!(door.activations[0].switches.len(), 1);
            assert_eq!(door.activations[0].switches[0].id, format!("g_dbutton1:{button}"));
        }
        let fortress = extract("stagGF01").doors;
        let gate = fortress.iter().find(|d| d.id == "g_breakinggatez05:0").unwrap();
        assert!(gate.activations.iter().any(|a| a.generators == ["GENE-00", "GENE-19"]));
        let arena_mechanisms = extract("stag0401");
        let arena = arena_mechanisms.doors;
        let exit = arena.iter().find(|d| d.id == "g_entrywayz04:0").unwrap();
        assert!(exit.activations.iter().any(|a| a.items.iter().map(|item| item.id).collect::<Vec<_>>() == [9, 10]));
        let mummy = extract("stag0201");
        assert!(mummy.doors.is_empty(), "train models should be excluded");
        let bridge = mummy.platforms.iter().find(|p| p.placement.model == "g_movepass01z02").unwrap();
        assert!(bridge
            .movements
            .iter()
            .flat_map(|m| &m.activations)
            .any(|a| a.switches.iter().any(|s| s.id == "g_lever01z02:0")));
        let cave = extract("dng310f2");
        let platform = cave.platforms.iter().find(|p| p.placement.model == "g_d3movecell1").unwrap();
        assert!(platform.movements.iter().any(|m| m.id == "SQ_SWON"));
        assert!(platform.movements.iter().any(|m| m.id == "SQ_SWOF"));
        assert!(!cave.platforms.iter().any(|p| p.placement.model == "g_d3movecell1w"));
        let ruins = extract("dng205b1");
        let puzzle = ruins.doors.iter().find(|d| d.id == "g_d2door:7").unwrap();
        assert_eq!(puzzle.activations.len(), 1);
        assert_eq!(puzzle.activations[0].switches.len(), 2);
        let sand = extract("dng204b1");
        let clear = sand.doors.iter().find(|d| d.id == "g_d2door:5").unwrap();
        assert_eq!(clear.activations.len(), 1);
        assert_eq!(clear.activations[0].generators, ["GENE-07", "GENE-12", "GENE-13", "GENE-14"]);
        assert!(clear.activations[0].switches.iter().any(|s| s.action == "destroy"));
        let station = extract("stag0204");
        let entrance = station.doors.iter().find(|d| d.id == "g_bossgatez02:0").unwrap();
        for players in 1..=4 {
            let paths: Vec<_> = entrance.activations.iter().filter(|a| a.players.contains(&players)).collect();
            assert_eq!(paths.len(), 1, "Station X {} {} party {players}: {paths:#?}", release.platform, release.region);
            assert!(!paths[0].unresolved);
            assert_eq!(paths[0].switches.iter().filter(|s| s.action == "hold").count(), players as usize);
            assert_eq!(paths[0].switches.iter().filter(|s| s.action == "break").count(), 4);
        }
        for p in mummy.platforms.iter().chain(&cave.platforms).chain(&arena_mechanisms.platforms) {
            assert!(!p.movements.is_empty());
            for m in &p.movements {
                assert!(!m.activations.is_empty());
                for a in &m.activations {
                    assert!(
                        !a.switches.is_empty()
                            || !a.areas.is_empty()
                            || !a.generators.is_empty()
                            || !a.enemy_models.is_empty()
                            || !a.items.is_empty()
                    );
                }
            }
        }
        for door in dungeon.iter().chain(&fortress).chain(&arena) {
            assert!(door.position.x.is_finite() && door.position.y.is_finite() && door.position.z.is_finite());
        }
    }
}

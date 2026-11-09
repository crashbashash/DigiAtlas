use importer::{
    afs::Afs,
    iso,
    regions::{GAMECUBE_RELEASES, RELEASES},
    stages, train,
};
use std::path::Path;

#[test]
fn train_controls_and_fastest_rail_route_match_the_supported_discs() {
    for release in RELEASES.into_iter().chain(GAMECUBE_RELEASES) {
        let key = format!("DIGIATLAS_{}_{}_ISO", release.platform.to_uppercase(), release.region.to_uppercase());
        let Some(path) = std::env::var_os(key) else { continue };
        let source = iso::Source::open(Path::new(&path)).unwrap();
        let files =
            if release.platform == "gc" { importer::gamecube::list_files(&source) } else { iso::list_files(&source) }
                .unwrap();
        let ndmw = Afs::open(iso::open_disc_file(&source, &files, "NDMW.AFS").unwrap()).unwrap();
        let directory = importer::manifest::read_files(
            iso::open_disc_file(&source, &files, "NDMW.IGB").unwrap().read_all().unwrap(),
        )
        .unwrap();
        let stages = stages::list_stages(&ndmw, &directory).unwrap();
        let stage = stages.iter().find(|s| s.id == "stag0203").unwrap();
        let packs = stage.packs.iter().map(|i| ndmw.entry(*i).unwrap()).collect::<Vec<_>>();
        let journey = train::extract(&packs).unwrap_or_else(|| panic!("{} {} train", release.platform, release.region));
        assert_eq!(journey.controls.len(), 20);
        assert!(journey.controls.iter().all(|c| c.preview.len() >= 2
            && !c.preview_destination.is_empty()
            && c.preview.iter().flatten().all(|n| n.is_finite())));
        assert_eq!(
            journey.controls.iter().find(|c| c.id == "g_turnright:0").unwrap().preview_destination,
            "Junction 4"
        );
        assert_eq!(journey.controls.iter().find(|c| c.id == "g_turnstra:0").unwrap().preview_destination, "Junction 7");
        let first_turn = &journey.controls.iter().find(|c| c.id == "g_turnright:0").unwrap().preview;
        assert!(first_turn[0][0] > -1300.0 && first_turn[0][0] < -1100.0);
        assert!((first_turn.last().unwrap()[0] - 1700.0).abs() < 1.0);
        assert!(first_turn.iter().any(|p| p[2] > 1000.0));
        assert_eq!(
            journey.steps.iter().map(|s| s.control_id.as_str()).collect::<Vec<_>>(),
            [
                "g_turnstra:0",
                "g_turnstra:6",
                "g_turnstra:1",
                "g_turnright:2",
                "g_turnstra:7",
                "g_turnright:4",
                "g_turnleft:2",
                "g_gatesign:0",
                "g_gatesign:1"
            ]
        );
        assert_eq!(journey.rail_frames, 11101.0);
        assert_eq!(journey.destination, "stag0205");
        assert!(journey.points.len() > 30);
        for (actual, expected) in journey.points[0].iter().zip([-2300.0, 10.0, 1300.0]) {
            assert!((actual - expected).abs() < 0.1);
        }
        for (actual, expected) in journey.points.last().unwrap().iter().zip([4100.0, 10.0, -1600.0]) {
            assert!((actual - expected).abs() < 0.1);
        }
        // The train's child shifts sideways while its parent stops and rotates. Plotting only
        // the parent would cut diagonally to (-2160, 340), missing the actual corner arc.
        for expected in [[-2300.0, 10.0, 340.0], [-2258.99495, 10.0, 241.00505], [-2160.0, 10.0, 200.0]] {
            assert!(
                journey.points.iter().any(|p| p.iter().zip(expected).all(|(a, b)| (a - b).abs() < 0.1)),
                "{} {} missing train-body corner point {expected:?}",
                release.platform,
                release.region
            );
        }
        assert!(!journey.points.iter().any(|p| (p[0] + 2160.0).abs() < 0.1 && (p[2] - 340.0).abs() < 0.1));
        assert!(journey.points.iter().flatten().all(|n| n.is_finite()));
    }
}

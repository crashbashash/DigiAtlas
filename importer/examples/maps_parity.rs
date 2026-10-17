//! Builds every stage's map with the Rust port and compares it with the Python exporter's output:
//! the PNG pixels and the `map` record in stages.json (bounds, size, pixels per unit, coverage,
//! fill).
//!
//! Usage: `cargo run --release --example maps_parity -- [ISO] [PYTHON_OUTPUT_DIR] [STAGE_ID...]`

use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use importer::afs::Afs;
use importer::generators::Pack;
use importer::{iso, maps, pyfmt, stages};
use serde_json::Value;

const DEFAULT_ISO: &str = "/path/to/Digimon World 4 (USA).iso";
const DEFAULT_REFERENCE: &str = "data/generated/python-reference";
const DIFFICULTIES: [&str; 3] = ["normal", "hard", "veryhard"];

fn decode_png(path: &Path) -> Result<(usize, usize, Vec<u8>), Box<dyn Error>> {
    let decoder = png::Decoder::new(std::fs::File::open(path)?);
    let mut reader = decoder.read_info()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf)?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return Err(format!("{}: not 8-bit RGBA", path.display()).into());
    }
    buf.truncate(info.buffer_size());
    Ok((info.width as usize, info.height as usize, buf))
}

/// The differences between a built map and the Python record and image, empty when they match.
fn compare(built: &maps::StageMap, expected: &Value, reference: &Path) -> Result<Vec<String>, Box<dyn Error>> {
    let mut diffs = Vec::new();
    let mut check = |what: &str, ours: f64, theirs: Option<f64>| {
        if theirs != Some(ours) {
            diffs.push(format!("{what}: {} vs {:?}", pyfmt::repr(ours), theirs.map(pyfmt::repr)));
        }
    };
    let b = &expected["bounds"];
    for (i, k) in ["minX", "maxX", "minZ", "maxZ"].into_iter().enumerate() {
        check(k, built.bounds[i], b[k].as_f64());
    }
    let r = &built.raster;
    check("width", r.width as f64, expected["width"].as_f64());
    check("height", r.height as f64, expected["height"].as_f64());
    check("pixelsPerUnit", pyfmt::round(r.pixels_per_unit, 4), expected["pixelsPerUnit"].as_f64());
    check("coverage", pyfmt::round(built.coverage, 3), expected["coverage"].as_f64());
    check("fill", pyfmt::round(r.fill(), 3), expected["fill"].as_f64());
    let image = expected["image"].as_str().ok_or("map without an image")?;
    let (w, h, rgba) = decode_png(&reference.join(image))?;
    if (w, h) != (r.width, r.height) {
        diffs.push(format!("image size {}x{} vs {w}x{h}", r.width, r.height));
    } else if rgba != r.rgba {
        let differing = rgba.chunks(4).zip(r.rgba.chunks(4)).filter(|(a, b)| a != b).count();
        diffs.push(format!("{differing} of {} pixels differ", w * h));
    }
    Ok(diffs)
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let iso_path = PathBuf::from(args.first().map_or(DEFAULT_ISO, String::as_str));
    let reference = PathBuf::from(args.get(1).map_or(DEFAULT_REFERENCE, String::as_str));
    let only: Vec<&str> = args.iter().skip(2).map(String::as_str).collect();

    let start = Instant::now();
    let disc = iso::Source::open(&iso_path)?;
    let files = iso::list_files(&disc)?;
    let ndmw = Afs::open(iso::open_disc_file(&disc, &files, "NDMW.AFS")?)?;
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(reference.join("stages.json"))?)?;
    let by_id: HashMap<&str, &Value> =
        doc["stages"].as_array().ok_or("stages.json without stages")?.iter().filter_map(|s| Some((s["id"].as_str()?, s))).collect();

    let (mut matched, mut failed, mut maps_built) = (0, 0, 0);
    let mut build_time = Duration::ZERO;
    for st in stages::list_stages(&ndmw)? {
        if !only.is_empty() && !only.contains(&st.id.as_str()) {
            continue;
        }
        let expected = by_id.get(st.id.as_str()).map_or(&Value::Null, |r| &r["map"]);
        let mut points: Vec<[f64; 3]> = Vec::new();
        for d in DIFFICULTIES {
            if let Some(idx) = st.generator_pack(d) {
                points.extend(Pack::new(ndmw.entry(idx)?)?.generators()?.iter().flat_map(|g| g.spawns()));
            }
        }
        // Trader positions come from the stage script as whole numbers, so the rounded copies in
        // stages.json are exact.
        let extra: Vec<(f64, f64)> = by_id
            .get(st.id.as_str())
            .and_then(|r| r["trades"].as_array())
            .map(|ts| ts.iter().filter_map(|t| Some((t["position"]["x"].as_f64()?, t["position"]["z"].as_f64()?))).collect())
            .unwrap_or_default();
        let system = stages::describe(&st.id)["kind"] == "system";
        let t = Instant::now();
        let built = if system && points.is_empty() { None } else { maps::build(&ndmw, &st.packs, &points, &extra)? };
        let took = t.elapsed();
        build_time += took;
        let diffs = match (&built, expected.is_null()) {
            (None, true) => Vec::new(),
            (None, false) => vec!["no map built, Python has one".to_string()],
            (Some(_), true) => vec!["map built, Python has none".to_string()],
            (Some(m), false) => {
                maps_built += 1;
                compare(m, expected, &reference)?
            }
        };
        let label = if built.is_some() { "map" } else { "no map" };
        if diffs.is_empty() {
            matched += 1;
            println!("ok   {:<10} {label} ({:.2}s)", st.id, took.as_secs_f64());
        } else {
            failed += 1;
            println!("FAIL {:<10} {}", st.id, diffs.join("; "));
        }
    }
    println!(
        "{matched} stages match ({maps_built} with maps), {failed} differ; building took {:.1}s, the whole run {:.1}s",
        build_time.as_secs_f64(),
        start.elapsed().as_secs_f64()
    );
    if failed > 0 {
        std::process::exit(1);
    }
    Ok(())
}

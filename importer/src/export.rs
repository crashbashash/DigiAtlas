//! Build DigiAtlas JSON from a Digimon World 4 PS2 or GameCube disc image.
//!
//! Writes manifest.json, enemies.json, stages.json, drops.json and items.json (schema v1, see
//! docs/schema.md), plus banners/ and maps/ images.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::afs::Afs;
use crate::error::{Error, Result};
use crate::generators::{DropPool, Generator, Pack, PlayerSlot};
use crate::igb::Value as Field;
use crate::iso::{self, Source};
use crate::{
    appraisal, banners, database, fail, manifest as archive_manifest, maps, names, png, pyfmt, scripts, stages, stats,
    trades,
};

pub const SCHEMA_VERSION: i64 = 1;
/// Bumped whenever the data the importer writes changes, so the app knows a cache is stale.
/// Stack an import thread should have: deeply nested scripts recurse in the Lua decompiler.
pub const STACK_SIZE: usize = 64 << 20;

pub const IMPORTER_VERSION: &str = "1.16.0";
const DIFFICULTIES: [&str; 3] = ["normal", "hard", "veryhard"];
const KNOWN_GAPS: [&str; 5] = [
    "enemies[].name: Mecha Rogue names follow Wikipedia and Wikimon; object names are not in the game text",
    "items[].stats: attack delay, upgrade costs and item flags are not exported (meaning unconfirmed)",
    "stages[]: stage names for 3 system scenes (stagIS07, stagIS08, stagIS20) are unknown",
    "maps: top-down footprints only (floors and walls from the terrain mesh); no room names or icons",
    "trigger-placed item spawns (scripted pickups) are not extracted yet",
];
const REQUIRED_FILES: [&str; 3] = ["/AREA.AFS", "/NDMW.AFS", "/NDMW.IGB"];

/// Import progress, for a progress bar: `done` of `total` steps, and what is happening now.
#[derive(Debug, Clone)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub message: String,
}

fn kinds(prefix: char) -> &'static str {
    match prefix {
        'e' => "enemy",
        'f' => "boss",
        _ => "object",
    }
}

fn float(x: f64) -> Value {
    serde_json::Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null)
}

fn field_json(v: &Field) -> Value {
    match v {
        Field::Int(i) => json!(i),
        Field::Float(f) => float(*f),
        Field::Str(s) => json!(s),
        Field::Floats(fs) => Value::Array(fs.iter().map(|f| float(*f)).collect()),
    }
}

fn pool_record(pool: &DropPool) -> Value {
    static POOL_NAME: OnceLock<Regex> = OnceLock::new();
    let re = POOL_NAME
        .get_or_init(|| Regex::new(r"^(?P<d>[nhv])(?P<zone>Z\d+)(?P<family>[A-Za-z]+?)(?P<variant>\d*)$").unwrap());
    let entries: Vec<Value> = pool
        .entries
        .iter()
        .map(|e| json!({"category": e.category, "id": e.id, "rank": e.rank, "rate": e.rate}))
        .collect();
    let total: i64 = pool.entries.iter().map(|e| e.rate).sum();
    let mut rec = Map::new();
    rec.insert("entries".into(), Value::Array(entries));
    rec.insert("totalRate".into(), json!(total));
    if let Some(m) = re.captures(&pool.name) {
        let difficulty = match &m["d"] {
            "n" => "normal",
            "h" => "hard",
            _ => "veryhard",
        };
        rec.insert("difficulty".into(), json!(difficulty));
        rec.insert("zone".into(), json!(&m["zone"]));
        rec.insert("family".into(), json!(&m["family"]));
        let variant = &m["variant"];
        rec.insert("variant".into(), if variant.is_empty() { Value::Null } else { json!(variant) });
    }
    Value::Object(rec)
}

fn drop_map(pools: &[DropPool]) -> Map<String, Value> {
    let mut out = Map::new();
    for (i, pool) in pools.iter().enumerate() {
        let key = pool.difficulty().map(str::to_string).unwrap_or_else(|| format!("slot{i}"));
        out.insert(key, json!(pool.name));
    }
    out
}

/// Per-player-count numbers, only when they differ from the one-player case.
fn player_slots(g: &Generator) -> Option<Vec<Value>> {
    let first = g.slots.first()?;
    let same = |sl: &PlayerSlot| {
        sl.count == first.count
            && sl.max_count == first.max_count
            && drop_map(&sl.pools) == drop_map(&first.pools)
            && drop_map(&sl.last_pools) == drop_map(&first.last_pools)
    };
    if g.slots.iter().all(same) {
        return None;
    }
    Some(
        g.slots
            .iter()
            .map(|sl| {
                let mut entry = Map::new();
                entry.insert("count".into(), field_json(&sl.count));
                entry.insert("maxCount".into(), field_json(&sl.max_count));
                if !sl.pools.is_empty() {
                    entry.insert("drops".into(), Value::Object(drop_map(&sl.pools)));
                }
                if !sl.last_pools.is_empty() {
                    entry.insert("lastDrops".into(), Value::Object(drop_map(&sl.last_pools)));
                }
                Value::Object(entry)
            })
            .collect(),
    )
}

/// What the stage's scripts say about a spawner.
fn script_info(name: &str, stage_scripts: Option<&scripts::StageScripts>) -> Option<Value> {
    let ss = stage_scripts?;
    let (status, refs) = ss.status(name);
    let mut info = Map::new();
    info.insert("status".into(), json!(status));
    let mut seen: Vec<(String, Vec<String>)> = Vec::new();
    let mut out: Vec<Value> = Vec::new();
    for r in refs {
        let key = (r.verb.clone(), r.when.clone());
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(json!({"verb": r.verb, "when": r.when}));
    }
    if !out.is_empty() {
        out.truncate(8);
        info.insert("refs".into(), Value::Array(out));
    }
    Some(Value::Object(info))
}

/// `boss_bar`: the stage shows a boss health bar for this spawner's enemy.
fn generator_record(g: &Generator, stage_scripts: Option<&scripts::StageScripts>, boss_bar: bool) -> Value {
    let round3 = |p: &[f64; 3]| Value::Array(p.iter().map(|v| float(pyfmt::round(*v, 3))).collect());
    let mut rec = Map::new();
    rec.insert("name".into(), json!(g.name));
    rec.insert("row".into(), field_json(&g.row));
    rec.insert("count".into(), g.gene_count.as_ref().map(field_json).unwrap_or(Value::Null));
    rec.insert("maxCount".into(), g.gene_max_count.as_ref().map(field_json).unwrap_or(Value::Null));
    rec.insert("spawns".into(), Value::Array(g.spawns().iter().map(round3).collect()));
    rec.insert("rotations".into(), Value::Array(g.rotations.iter().map(|r| float(*r)).collect()));
    rec.insert("startMode".into(), field_json(&g.start_mode));
    rec.insert("fillMode".into(), field_json(&g.fill_mode));
    if let Some((center, radius)) = g.trigger() {
        rec.insert("trigger".into(), json!({"center": round3(&center), "radius": float(radius)}));
    }
    if g.lua.truthy() {
        rec.insert("lua".into(), field_json(&g.lua));
    }
    if !g.pools.is_empty() {
        rec.insert("drops".into(), Value::Object(drop_map(&g.pools)));
    }
    if !g.last_pools.is_empty() {
        rec.insert("lastDrops".into(), Value::Object(drop_map(&g.last_pools)));
    }
    if let Some(players) = player_slots(g) {
        rec.insert("players".into(), Value::Array(players));
    }
    if let Some(info) = script_info(&g.name, stage_scripts) {
        rec.insert("script".into(), info);
    }
    if boss_bar {
        rec.insert("bossHealthBar".into(), json!(true));
    }
    Value::Object(rec)
}

/// Traders as JSON; several of one Digimon are numbered so they can be told apart.
fn trades_json(found: &[trades::Placed]) -> Value {
    let mut seen: HashMap<&str, i64> = HashMap::new();
    let out: Vec<Value> = found
        .iter()
        .map(|t| {
            let total = found.iter().filter(|x| x.name == t.name).count();
            let n = seen.entry(&t.name).or_insert(0);
            *n += 1;
            let [x, y, z] = t.position;
            let mut tables = Map::new();
            for (difficulty, offers) in &t.tables {
                let list: Vec<Value> = offers
                    .iter()
                    .map(|o| {
                        json!({"give": {"category": o.give.0, "id": o.give.1}, "get": {"category": o.get.0, "id": o.get.1}})
                    })
                    .collect();
                tables.insert((*difficulty).into(), Value::Array(list));
            }
            json!({
                "trader": t.name,
                "number": if total > 1 { json!(*n) } else { Value::Null },
                "position": {"x": float(pyfmt::round(x, 3)), "y": float(pyfmt::round(y, 3)), "z": float(pyfmt::round(z, 3))},
                "facing": float(pyfmt::round(t.facing, 3)),
                "tables": tables,
            })
        })
        .collect();
    Value::Array(out)
}

/// Display name, kind and the optional form and boss-part fields for an enemy model.
fn enemy_naming(model: &str) -> Result<Map<String, Value>> {
    let Some(entry) = names::enemies().get(model) else {
        fail!("no display name for enemy model {model}; add it to importer/names/enemies.json");
    };
    let mut out = Map::new();
    out.insert("name".into(), entry["name"].clone());
    let kind = entry.get("kind").cloned().unwrap_or_else(|| json!(kinds(model.chars().next().unwrap_or('e'))));
    out.insert("kind".into(), kind);
    for key in ["form", "role", "partOf"] {
        if let Some(v) = entry.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    Ok(out)
}

/// Seconds since 1970 as an ISO 8601 UTC timestamp (`2026-10-17T16:05:00+00:00`).
fn utc_timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}+00:00", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn write_json(path: &Path, value: &Value) -> Result<()> {
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    serde::Serialize::serialize(value, &mut ser)?;
    buf.push(b'\n');
    std::fs::write(path, buf).map_err(|e| Error(format!("{}: {e}", path.display())))
}

/// Read the disc at `iso_path` and write its data into `out_dir`. Returns the manifest.
pub fn export(iso_path: &Path, out_dir: &Path, with_maps: bool, progress: &mut dyn FnMut(Progress)) -> Result<Value> {
    let disc = Source::open(iso_path)?;
    let crown_mod = crate::crown_signature::read(&disc)?;
    let gamecube = crate::gamecube::is_gamecube(&disc)?;
    let files = if gamecube { crate::gamecube::list_files(&disc)? } else { iso::list_files(&disc)? };
    for needed in REQUIRED_FILES {
        if !files.contains_key(needed) {
            fail!("this does not look like a Digimon World 4 disc (missing {})", &needed[1..]);
        }
    }
    let src = |name: &str| iso::open_disc_file(&disc, &files, name);
    let release = if gamecube {
        crate::regions::from_gamecube_header(&disc.read(0, 6)?)?
    } else {
        crate::regions::from_system_cnf(&src("SYSTEM.CNF")?.read_all()?)?
    };
    if let Some(signature) = &crown_mod {
        let signature_release = if gamecube { &release.serial[..4] } else { release.executable };
        if signature["platform"] != release.platform || signature["release"] != signature_release {
            fail!("Crown Mod signature does not match this disc");
        }
    }
    let executable = src(release.executable)?.read_all()?;
    let area = Afs::open(src("AREA.AFS")?)?;
    let ndmw = Afs::open(src("NDMW.AFS")?)?;

    // --- text databases (English copy) -------------------------------------------------
    progress(Progress { done: 0, total: 1, message: "Reading the game's databases".into() });
    let tables = database::read_tables(area.entry(database::DATABASE_ENTRY)?)?;
    let power_spells = crate::power_spells::extract(&tables)?;
    let mp_techs = crate::mp_techs::extract(&tables, &executable, gamecube)?;
    let save_stats = crate::power_spells::save_stats(&tables)?;
    let models = database::enemy_models(&tables)?;
    let flag_names = scripts::load_flag_names();
    let mut player_digimon: HashMap<String, String> = HashMap::new();
    for r in tables.get("shinka").map(Vec::as_slice).unwrap_or(&[]) {
        if let (Some(model), Some(name)) =
            (r.get("MODEL_NAME").and_then(database::Cell::str), r.get("NAME").and_then(database::Cell::str))
        {
            if !model.is_empty() && !name.is_empty() {
                player_digimon.insert(model.to_string(), name.to_string());
            }
        }
    }

    // --- enemies -----------------------------------------------------------------------
    let enemy_rows = tables.get("enemy").ok_or_else(|| Error("database 'enemy' missing".into()))?;
    let table = stats::from_database(enemy_rows)?;
    let anchors_ok = stats::anchors_match(&table);
    let mut rows = Vec::new();
    for r in &table {
        let Some(model) = models.get(&r.row) else { continue };
        if r.is_empty() {
            continue;
        }
        let mut rec = Map::new();
        rec.insert("row".into(), json!(r.row));
        rec.extend(enemy_naming(model)?);
        rec.insert("model".into(), json!(model));
        rec.insert("hp".into(), json!(r.hp));
        rec.insert(
            "stats".into(),
            json!({"strength": r.strength, "defense": r.defense, "wisdom": r.wisdom, "spirit": r.spirit, "speed": r.speed, "exp": r.exp}),
        );
        let resist: Map<String, Value> = r.resist.iter().map(|(k, v)| ((*k).to_string(), json!(v))).collect();
        rec.insert("resist".into(), Value::Object(resist));
        rec.insert("rates".into(), json!({"crit": r.crit_rate, "paralysis": r.paralysis_rate}));
        rec.insert("rarity".into(), json!(r.rarity));
        if r.rarity == 127 && crown_mod.as_ref().is_some_and(|m| m["options"]["randomCrownColours"] == true) {
            rec.insert("crownStyle".into(), json!("random"));
        }
        rows.push(Value::Object(rec));
    }
    let enemies = json!({"rowCount": table.len(), "rows": rows});

    // --- stages, generators, drop pools --------------------------------------------------
    let manifest_bytes = src("NDMW.IGB")?.read_all()?;
    let archive_names = archive_manifest::read_names(&manifest_bytes)?;
    let normal_hits = crate::attack_profiles::extract(&ndmw, &archive_names, &tables)?;
    let map_dir = out_dir.join("maps");
    let banner_dir = out_dir.join("banners");
    std::fs::create_dir_all(&banner_dir)?;
    let all_stages = stages::list_stages(&ndmw)?;
    let stage_names = names::stages();
    let mut unnamed: Vec<&str> =
        all_stages.iter().map(|s| s.id.as_str()).filter(|id| stage_names.get(id).is_none()).collect();
    unnamed.sort();
    if !unnamed.is_empty() {
        fail!("no name entry for stages {unnamed:?}; add them to importer/names/stages.json");
    }
    let mut stage_records: Vec<Value> = Vec::new();
    let mut pools = Map::new();
    let total = all_stages.len() + 2;
    for (n, st) in all_stages.iter().enumerate() {
        let label = &stage_names[&st.id];
        progress(Progress {
            done: n + 1,
            total,
            message: format!(
                "{} · {}",
                label["area"].as_str().unwrap_or("Stages"),
                label["room"].as_str().unwrap_or(&st.id)
            ),
        });
        let tex = banners::load(&area, &archive_names, &st.id)?;
        if let Some(t) = &tex {
            std::fs::write(banner_dir.join(format!("{}.png", st.id)), png::encode_rgba(t.width, t.height, &t.rgba)?)?;
        }
        let mut rec = Map::new();
        rec.insert("id".into(), json!(st.id));
        rec.insert("area".into(), label["area"].clone());
        rec.insert("room".into(), label["room"].clone());
        rec.extend(stages::describe(&st.id));
        rec.insert("banner".into(), if tex.is_some() { json!(format!("banners/{}.png", st.id)) } else { Value::Null });
        rec.insert("manifestEntry".into(), json!(st.manifest_entry));
        rec.insert("packs".into(), json!(st.packs));
        let gen_packs: Map<String, Value> =
            st.generator_packs.iter().map(|(d, e)| ((*d).to_string(), json!(e))).collect();
        rec.insert("generatorPacks".into(), if gen_packs.is_empty() { Value::Null } else { Value::Object(gen_packs) });
        let pack_data: Vec<Vec<u8>> = st.packs.iter().map(|&pk| ndmw.entry(pk)).collect::<Result<_>>()?;
        let stage_scripts = if st.generator_packs.is_empty() {
            None
        } else {
            Some(scripts::analyse(&pack_data, &player_digimon, &flag_names))
        };
        let mut map_points: Vec<[f64; 3]> = Vec::new();
        let mut difficulties = Map::new();
        for difficulty in DIFFICULTIES {
            let Some(idx) = st.generator_pack(difficulty) else { continue };
            let gens = Pack::new(ndmw.entry(idx)?)?.generators()?;
            map_points.extend(gens.iter().flat_map(|g| g.spawns()));
            for g in &gens {
                let fallback = [PlayerSlot {
                    count: Field::Int(0),
                    max_count: Field::Int(0),
                    pools: g.pools.clone(),
                    last_pools: g.last_pools.clone(),
                }];
                let slots: &[PlayerSlot] = if g.slots.is_empty() { &fallback } else { &g.slots };
                for slot in slots {
                    for pool in slot.pools.iter().chain(&slot.last_pools) {
                        if !pools.contains_key(&pool.name) {
                            pools.insert(pool.name.clone(), pool_record(pool));
                        }
                    }
                }
            }
            let records: Vec<Value> = gens
                .iter()
                .map(|g| {
                    let boss_bar = match (
                        &stage_scripts,
                        g.row.int().and_then(|r| usize::try_from(r).ok()).and_then(|r| models.get(&r)),
                    ) {
                        (Some(ss), Some(model)) => ss.boss_models.contains(model),
                        _ => false,
                    };
                    generator_record(g, stage_scripts.as_ref(), boss_bar)
                })
                .collect();
            difficulties.insert(difficulty.into(), json!({"generators": records}));
        }
        rec.insert("difficulties".into(), Value::Object(difficulties));
        let placed = trades::extract(&pack_data, &player_digimon);
        rec.insert("trades".into(), trades_json(&placed));
        if rec["kind"] == "hub" {
            rec.insert("services".into(), json!(crate::services::extract(&pack_data)));
        }
        if st.id == "stag0103" {
            if let Some((markers, points)) = crate::landmarks::boat_route(&pack_data) {
                rec.insert("landmarks".into(), json!(markers));
                rec.insert("boatRoute".into(), json!(points));
            }
        }
        rec.insert("map".into(), Value::Null);
        let system = rec["kind"] == "system";
        if with_maps && !(system && map_points.is_empty()) {
            let extra: Vec<(f64, f64)> = placed.iter().map(|t| (t.position[0], t.position[2])).collect();
            if let Some(built) = maps::build(&ndmw, &st.id, &st.packs, &map_points, &extra)? {
                std::fs::create_dir_all(&map_dir)?;
                std::fs::write(map_dir.join(format!("{}.png", st.id)), built.png()?)?;
                let [min_x, max_x, min_z, max_z] = built.bounds;
                rec.insert(
                    "map".into(),
                    json!({
                        "image": format!("maps/{}.png", st.id),
                        "bounds": {"minX": float(min_x), "maxX": float(max_x), "minZ": float(min_z), "maxZ": float(max_z)},
                        "width": built.raster.width,
                        "height": built.raster.height,
                        "pixelsPerUnit": float(pyfmt::round(built.raster.pixels_per_unit, 4)),
                        "shading": "height",
                        "floorSource": built.floor_source,
                        "scenery": built.scenery,
                        "coverage": float(pyfmt::round(built.coverage, 3)),
                        "fill": float(pyfmt::round(built.raster.fill(), 3)),
                    }),
                );
            }
        }
        stage_records.push(Value::Object(rec));
    }

    // --- appraiser (what an unidentified item turns into) ---------------------------------
    progress(Progress { done: total - 1, total, message: "Reading items and the appraiser".into() });
    let mut hub_packs: Vec<usize> =
        all_stages.iter().filter(|s| s.id.starts_with("stagML")).flat_map(|s| s.packs.iter().copied()).collect();
    hub_packs.sort();
    hub_packs.dedup();
    let appraisal_block = appraisal::find_tables(&ndmw, &hub_packs)?.map(|t| appraisal::build(&t));

    // --- items (every item in the game database) -----------------------------------------
    let mut items = Vec::new();
    for i in database::parse_items(&tables)? {
        let mut rec = Map::new();
        rec.insert("category".into(), json!(i.category));
        rec.insert("id".into(), json!(i.id));
        rec.insert("name".into(), json!(i.name));
        rec.insert("description".into(), json!(i.description));
        if let Some((attribute, amount)) = i.pickup {
            rec.insert("pickup".into(), json!({ "attribute": attribute, "amount": amount }));
        }
        if i.unidentified {
            rec.insert("unidentified".into(), json!(true));
        }
        if let Some(element) = tables
            .get(i.category)
            .and_then(|t| t.get(i.id))
            .and_then(|r| r.get("ZOKUSEI"))
            .and_then(database::Cell::str)
            .filter(|e| ["fire", "ice", "thunder", "dark"].contains(e))
        {
            rec.insert("element".into(), json!(element));
        }
        if i.category == "weapon" {
            if let Some(hits) = normal_hits.get(&i.id) {
                rec.insert("normalHits".into(), json!(hits));
            }
        }
        if let Some(skill) = i.skill_type {
            rec.insert("skillType".into(), json!(skill));
        }
        if !i.stats.is_empty() {
            let stats: Map<String, Value> = i.stats.iter().map(|(k, v)| ((*k).to_string(), v.to_json())).collect();
            rec.insert("stats".into(), Value::Object(stats));
        }
        items.push(Value::Object(rec));
    }

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let count_generators: usize = stage_records
        .iter()
        .map(|s| {
            s["difficulties"]
                .as_object()
                .map(|d| d.values().map(|v| v["generators"].as_array().map_or(0, Vec::len)).sum::<usize>())
                .unwrap_or(0)
        })
        .sum();
    let manifest = json!({
        "schemaVersion": SCHEMA_VERSION,
        "platform": release.platform,
        "region": release.region,
        "serial": release.serial,
        "framesPerSecond": release.frames_per_second,
        "mod": crown_mod,
        "source": {
            "kind": "iso",
            "name": iso_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            "executableSha1": sha1_smol::Sha1::from(&executable).digest().to_string(),
            "statTableVerified": anchors_ok,
        },
        "exporter": {"name": "digiatlas-importer", "version": IMPORTER_VERSION},
        "generatedAt": utc_timestamp(now),
        "counts": {
            "enemyRows": rows_len(&enemies),
            "stages": stage_records.len(),
            "stagesWithGenerators": stage_records.iter().filter(|s| s["difficulties"].as_object().is_some_and(|d| !d.is_empty())).count(),
            "stageMaps": stage_records.iter().filter(|s| !s["map"].is_null()).count(),
            "generators": count_generators,
            "dropPools": pools.len(),
            "items": items.len(),
        },
        "files": ["enemies.json", "stages.json", "drops.json", "items.json"],
        "assets": if with_maps { json!(["banners/", "maps/"]) } else { json!(["banners/"]) },
        "knownGaps": KNOWN_GAPS,
    });

    progress(Progress { done: total, total, message: "Writing the data".into() });
    std::fs::create_dir_all(out_dir)?;
    let mut items_doc = Map::new();
    items_doc.insert("items".into(), Value::Array(items));
    items_doc.insert("powerSpells".into(), power_spells);
    items_doc.insert("mpTechs".into(), mp_techs);
    items_doc.insert("saveStats".into(), save_stats);
    if let Some(a) = appraisal_block {
        items_doc.insert("appraisal".into(), a);
    }
    write_json(&out_dir.join("manifest.json"), &manifest)?;
    write_json(&out_dir.join("enemies.json"), &enemies)?;
    write_json(&out_dir.join("stages.json"), &json!({"stages": stage_records}))?;
    write_json(&out_dir.join("drops.json"), &json!({"pools": pools}))?;
    write_json(&out_dir.join("items.json"), &Value::Object(items_doc))?;
    Ok(manifest)
}

fn rows_len(enemies: &Value) -> usize {
    enemies["rows"].as_array().map_or(0, Vec::len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(utc_timestamp(0), "1970-01-01T00:00:00+00:00");
        assert_eq!(utc_timestamp(1_792_253_100), "2026-10-17T16:05:00+00:00");
        assert_eq!(utc_timestamp(951_782_400), "2000-02-29T00:00:00+00:00");
    }

    use crate::generators::tests::generator;
    use crate::generators::DropEntry;

    fn pool(name: &str) -> DropPool {
        DropPool { name: name.into(), entries: Vec::new() }
    }

    #[test]
    fn a_record_carries_the_trigger() {
        let rec =
            generator_record(&generator([1.0, 2.0, 3.0], vec![[1.0, 2.0, 3.0]], true, "radar", 625.0), None, false);
        assert_eq!(rec["trigger"], json!({"center": [1.0, 2.0, 3.0], "radius": 25.0}));
        assert!(generator_record(&generator([1.0, 2.0, 3.0], vec![], true, "direct", 0.0), None, false)
            .get("trigger")
            .is_none());
    }

    fn slots(rows: &[(i64, i64, &str)]) -> Vec<PlayerSlot> {
        rows.iter()
            .map(|&(c, m, p)| PlayerSlot {
                count: Field::Int(c),
                max_count: Field::Int(m),
                pools: if p.is_empty() { vec![] } else { vec![pool(p)] },
                last_pools: vec![],
            })
            .collect()
    }

    #[test]
    fn identical_player_entries_collapse_to_the_plain_fields() {
        let mut g = generator([0.0; 3], vec![], true, "", 0.0);
        g.slots = slots(&[(1, 1, "nA"); 4]);
        assert_eq!(player_slots(&g), None);
        assert_eq!(player_slots(&generator([0.0; 3], vec![], true, "", 0.0)), None);
    }

    #[test]
    fn differing_player_entries_are_exported_in_order() {
        let mut g = generator([0.0; 3], vec![], true, "", 0.0);
        g.slots = slots(&[(2, 2, "nA"), (3, 3, "nA"), (4, 4, "nB"), (4, 4, "nB")]);
        let out = player_slots(&g).unwrap();
        assert_eq!(out.iter().map(|e| e["count"].as_i64().unwrap()).collect::<Vec<_>>(), [2, 3, 4, 4]);
        assert_eq!(out[2]["drops"], json!({"normal": "nB"}));
    }

    #[test]
    fn a_pool_record_parses_its_name_and_totals() {
        let p = DropPool {
            name: "hZ1gobr3".into(),
            entries: vec![
                DropEntry { category: "weapon".into(), id: 0, rank: 0, rate: 250 },
                DropEntry { category: "conItem".into(), id: 1, rank: 0, rate: 1600 },
            ],
        };
        let rec = pool_record(&p);
        assert_eq!(rec["totalRate"], 1850);
        assert_eq!(
            (&rec["difficulty"], &rec["zone"], &rec["family"], &rec["variant"]),
            (&json!("hard"), &json!("Z1"), &json!("gobr"), &json!("3"))
        );
        assert_eq!(pool_record(&pool("comonNOTG01")), json!({"entries": [], "totalRate": 0}));
    }

    #[test]
    fn drop_maps_are_keyed_by_difficulty() {
        let pools = ["nZ1a1", "hZ1a1", "vZ1a1"].map(pool);
        assert_eq!(Value::Object(drop_map(&pools)), json!({"normal": "nZ1a1", "hard": "hZ1a1", "veryhard": "vZ1a1"}));
    }

    #[test]
    fn several_traders_of_one_digimon_are_numbered() {
        let offer = vec![trades::Offer { give: ("weapon".into(), 1), get: ("weapon".into(), 2) }];
        let placed = |name: &str, instance, position, facing, tables: Vec<(&'static str, Vec<trades::Offer>)>| {
            trades::Placed { name: name.into(), instance, position, facing, tables }
        };
        let out = trades_json(&[
            placed("Agumon", 0, [-80.0, 10.0, 20.0], 90.0, vec![("hard", offer.clone())]),
            placed("Agumon", 1, [240.0, 10.0, -180.0], -45.0, vec![("hard", offer.clone())]),
            placed("Dorumon", 0, [0.0, 10.0, 0.0], 0.0, vec![]),
        ]);
        let numbered: Vec<(&str, Value)> =
            out.as_array().unwrap().iter().map(|x| (x["trader"].as_str().unwrap(), x["number"].clone())).collect();
        assert_eq!(numbered, [("Agumon", json!(1)), ("Agumon", json!(2)), ("Dorumon", Value::Null)]);
        assert_eq!(out[0]["position"], json!({"x": -80.0, "y": 10.0, "z": 20.0}));
        assert_eq!(out[0]["facing"], 90.0);
        assert_eq!(
            out[0]["tables"]["hard"][0],
            json!({"give": {"category": "weapon", "id": 1}, "get": {"category": "weapon", "id": 2}})
        );
    }

    #[test]
    fn names_enemies_with_kind_overrides_and_parts() {
        let orb = enemy_naming("f_luce2").unwrap();
        assert_eq!(
            (orb["role"].as_str(), orb["partOf"].as_str(), orb["kind"].as_str()),
            (Some("part"), Some("Lucemon"), Some("boss"))
        );
        assert_eq!(enemy_naming("e_goburi").unwrap()["kind"], "enemy");
        assert!(enemy_naming("nope").is_err());
    }
}

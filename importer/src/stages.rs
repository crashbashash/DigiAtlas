//! Enumerate stages from the NDMW.AFS stage manifests (entries 80-177).

use std::sync::OnceLock;

use regex::bytes::Regex;
use serde_json::{json, Value as Json};

use crate::afs::Afs;
use crate::error::Result;
use crate::generators;

const MANIFEST_RANGE: std::ops::Range<usize> = 80..178;
/// Three consecutive generator packs follow a stage's data packs, in this order.
const GENERATOR_DIFFICULTIES: [&str; 3] = ["hard", "normal", "veryhard"];

pub struct Stage {
    pub id: String,
    pub manifest_entry: usize,
    pub packs: Vec<usize>,
    /// (difficulty, AFS entry), in the export's order.
    pub generator_packs: Vec<(&'static str, usize)>,
}

impl Stage {
    pub fn generator_pack(&self, difficulty: &str) -> Option<usize> {
        self.generator_packs.iter().find(|(d, _)| *d == difficulty).map(|(_, e)| *e)
    }
}

/// Floor, variant and kind derived from the engine id (`dng101b2` is floor B2).
pub fn describe(stage_id: &str) -> serde_json::Map<String, Json> {
    static FLOOR: OnceLock<regex::Regex> = OnceLock::new();
    let floor = FLOOR.get_or_init(|| regex::Regex::new(r"^dng(?:\d{3}|q\d)(?P<kind>[bf])(?P<n>\d+)(?P<variant>[ehv])?$").unwrap());
    let mut kind = "field";
    let (mut fl, mut variant) = (Json::Null, Json::Null);
    if stage_id.starts_with("dng") {
        kind = "dungeon";
        if let Some(m) = floor.captures(stage_id) {
            let n: i64 = m["n"].parse().unwrap_or(0);
            fl = json!(format!("{}{}", m["kind"].to_uppercase(), n));
            variant = m.name("variant").map(|v| json!(v.as_str())).unwrap_or(Json::Null);
        }
    } else if stage_id.starts_with("stagBS") {
        kind = "boss";
    } else if stage_id.starts_with("stagML") || ["stagIS11", "stagIS12", "stagIS13"].contains(&stage_id) {
        kind = "hub"; // Home Server lobby areas
    } else if stage_id.starts_with("stagIS") {
        kind = "system"; // logo, opening, title and other non-area scenes
    }
    let mut out = serde_json::Map::new();
    out.insert("kind".into(), json!(kind));
    out.insert("floor".into(), fl);
    out.insert("variant".into(), variant);
    out
}

/// The stage id and the pack entries a manifest references.
fn parse_manifest(data: &[u8]) -> (Option<String>, Vec<usize>) {
    static PACK_REF: OnceLock<Regex> = OnceLock::new();
    static PRINTABLE: OnceLock<Regex> = OnceLock::new();
    static STAGE_ID: OnceLock<Regex> = OnceLock::new();
    let pack_ref = PACK_REF.get_or_init(|| Regex::new(r"(?-u)\[0\.(\d+)\]").unwrap());
    let printable = PRINTABLE.get_or_init(|| Regex::new(r"(?-u)[ -~]{4,}").unwrap());
    let stage_id = STAGE_ID.get_or_init(|| Regex::new(r"(?-u)^(stag[0-9A-Za-z]+|dng[0-9a-z]+)$").unwrap());
    let packs = pack_ref
        .captures_iter(data)
        .filter_map(|c| std::str::from_utf8(&c[1]).ok()?.parse().ok())
        .collect();
    let ids: Vec<&[u8]> = printable.find_iter(data).map(|m| m.as_bytes()).filter(|t| stage_id.is_match(t)).collect();
    (ids.last().map(|t| String::from_utf8_lossy(t).into_owned()), packs)
}

pub fn list_stages(ndmw: &Afs) -> Result<Vec<Stage>> {
    let mut stages = Vec::new();
    for entry in MANIFEST_RANGE {
        if entry >= ndmw.count() {
            break;
        }
        let (id, mut packs) = parse_manifest(&ndmw.entry(entry)?);
        let Some(id) = id else { continue };
        if packs.is_empty() {
            continue;
        }
        packs.sort();
        packs.dedup();
        stages.push(Stage { id, manifest_entry: entry, packs, generator_packs: Vec::new() });
    }
    let mut starts: Vec<usize> = stages.iter().flat_map(|s| s.packs.iter().copied()).collect();
    starts.sort();
    starts.dedup();
    for stage in &mut stages {
        let last = *stage.packs.iter().max().unwrap();
        let first = last + 1;
        // The generator packs sit between this stage's packs and the next stage's first pack.
        let later = starts.iter().copied().find(|&p| p > last);
        let stop = [Some(first + 12), Some(ndmw.count()), later].into_iter().flatten().min().unwrap();
        let mut found = Vec::new();
        for idx in first..stop {
            if generators::has_generators(&ndmw.entry(idx)?) {
                found.push(idx);
            }
        }
        if found.len() >= 3 && found[1] == found[0] + 1 && found[2] == found[0] + 2 {
            stage.generator_packs = GENERATOR_DIFFICULTIES.iter().copied().zip(found[..3].iter().copied()).collect();
        }
    }
    Ok(stages)
}

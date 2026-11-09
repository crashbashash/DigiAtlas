//! Enumerate stages from the NDMW.AFS stage manifests (entries 80-177).

use std::sync::OnceLock;

use regex::bytes::Regex;
use serde_json::{json, Value as Json};

use crate::afs::Afs;
use crate::error::{Error, Result};
use crate::generators;
use crate::manifest::ArchiveFile;

const MANIFEST_RANGE: std::ops::Range<usize> = 80..178;
const GENERATOR_FILES: [(&str, &str); 3] =
    [("hard", "generatorh.igb"), ("normal", "generatorn.igb"), ("veryhard", "generatorv.igb")];

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
    let floor = FLOOR
        .get_or_init(|| regex::Regex::new(r"^dng(?:\d{3}|q\d)(?P<kind>[bf])(?P<n>\d+)(?P<variant>[ehv])?$").unwrap());
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
    let packs = pack_ref.captures_iter(data).filter_map(|c| std::str::from_utf8(&c[1]).ok()?.parse().ok()).collect();
    let ids: Vec<&[u8]> = printable.find_iter(data).map(|m| m.as_bytes()).filter(|t| stage_id.is_match(t)).collect();
    (ids.last().map(|t| String::from_utf8_lossy(t).into_owned()), packs)
}

pub fn list_stages(ndmw: &Afs, files: &[ArchiveFile]) -> Result<Vec<Stage>> {
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
    for stage in &mut stages {
        // Model and sound selectors can reference appended difficulty variants.
        // Generator identity belongs to the native virtual directory, independently
        // of archive order or the highest model entry in the stage manifest.
        for (difficulty, name) in GENERATOR_FILES {
            let mut matches = files.iter().filter(|file| {
                file.archive == "NDMW.AFS"
                    && file.directory.len() == 2
                    && file.directory[0].eq_ignore_ascii_case(&stage.id)
                    && file.directory[1].eq_ignore_ascii_case("separate")
                    && file.name.eq_ignore_ascii_case(name)
            });
            let Some(file) = matches.next() else { continue };
            if matches.any(|other| other.entry != file.entry) {
                return Err(Error(format!("stage {} has ambiguous {difficulty} generator files", stage.id)));
            }
            if file.entry >= ndmw.count() {
                return Err(Error(format!("stage {} generator entry {} is outside NDMW.AFS", stage.id, file.entry)));
            }
            if generators::has_generators(&ndmw.entry(file.entry)?) {
                stage.generator_packs.push((difficulty, file.entry));
            }
        }
    }
    Ok(stages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_floors_and_kinds() {
        assert_eq!(Json::Object(describe("dng101b2")), json!({"kind": "dungeon", "floor": "B2", "variant": null}));
        assert_eq!(describe("dng103f1")["floor"], "F1");
        assert_eq!(Json::Object(describe("dngq4b2v")), json!({"kind": "dungeon", "floor": "B2", "variant": "v"}));
        assert_eq!(describe("dngq6b01")["floor"], "B1");
        assert_eq!(describe("stag0102")["kind"], "field");
        assert_eq!(describe("stagBS04")["kind"], "boss");
        assert_eq!(describe("stagML12")["kind"], "hub");
        assert_eq!(describe("stagIS12")["kind"], "hub");
        assert_eq!(describe("stagIS10")["kind"], "system");
    }

    #[test]
    fn reads_a_stage_manifest() {
        let (id, packs) = parse_manifest(b"\x00[0.231]\x00xx[0.230]\x00stag0102\x00junk");
        assert_eq!((id.as_deref(), packs), (Some("stag0102"), vec![231, 230]));
    }

    fn randomized_archive(name: &str) -> (crate::iso::tests::TempFile, Afs, Vec<ArchiveFile>) {
        use crate::iso::tests::{build_afs, TempFile};
        let mut entries: Vec<&[u8]> = vec![b""; 200];
        entries[80] = b"\0[0.120]|[0.190]|[0.191]\0[0.119]/s\0stag0101\0";
        entries[81] = b"\0[0.121]\0dngq5b1e\0";
        entries[99] = b"beGeneraterData\0";
        entries[101] = b"beGeneraterData\0";
        entries[115] = b"beGeneraterData\0";
        let file = TempFile::new(name, &build_afs(&entries));
        let afs = Afs::open(crate::iso::Source::open(&file.0).unwrap()).unwrap();
        let files = [("generatorh.igb", 101), ("generatorn.igb", 115), ("generatorv.igb", 99)]
            .map(|(name, entry)| ArchiveFile {
                name: name.into(),
                archive: "NDMW.AFS",
                entry,
                directory: vec!["stag0101".into(), "separate".into()],
            })
            .to_vec();
        (file, afs, files)
    }

    #[test]
    fn appended_models_do_not_hide_generators_or_lend_them_to_an_empty_stage() {
        let (_file, afs, files) = randomized_archive("stage-variants.afs");
        let stages = list_stages(&afs, &files).unwrap();
        assert_eq!(stages[0].packs, [119, 120, 190, 191]);
        assert_eq!(stages[0].generator_packs, [("hard", 101), ("normal", 115), ("veryhard", 99)]);
        assert!(stages[1].generator_packs.is_empty());
    }

    #[test]
    fn ambiguous_or_out_of_archive_generator_files_fail_instead_of_losing_spawns() {
        let (_file, afs, mut files) = randomized_archive("stage-invalid.afs");
        let mut duplicate = files[0].clone();
        duplicate.entry = 102;
        files.push(duplicate);
        assert!(list_stages(&afs, &files).err().unwrap().0.contains("ambiguous"));
        files.pop();
        files[0].entry = afs.count();
        assert!(list_stages(&afs, &files).err().unwrap().0.contains("outside NDMW.AFS"));
    }
}

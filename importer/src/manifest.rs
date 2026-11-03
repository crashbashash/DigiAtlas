//! Archive entry names from NDMW.IGB, the game's virtual filesystem. Records of class
//! `igAdxAfsFile` carry a name, the archive (0 = NDMW.AFS, 1 = AREA.AFS) and the entry index.

use std::collections::HashMap;

use crate::error::{Error, Result};
use crate::igb;

const SLOT_NAME: u16 = 2;
const SLOT_ARCHIVE: u16 = 4;
const SLOT_ENTRY: u16 = 5;

/// A virtual file, including the directory that ties stage generators to their local databases.
#[derive(Debug, Clone)]
pub struct ArchiveFile {
    pub name: String,
    pub archive: &'static str,
    pub entry: usize,
    pub directory: Vec<String>,
}

pub fn read_files(manifest: Vec<u8>) -> Result<Vec<ArchiveFile>> {
    let g = igb::Graph::new(manifest)?;
    let mut files = Vec::new();
    for rec in &g.s2 {
        if rec.class != "igAdxAfsFile" {
            continue;
        }
        let archive = match rec.field("slot4").and_then(igb::Value::int) {
            Some(0) => "NDMW.AFS",
            Some(1) => "AREA.AFS",
            _ => continue,
        };
        let Some(entry) = rec.field("slot5").and_then(igb::Value::int).and_then(|v| usize::try_from(v).ok()) else {
            // The virtual filesystem also contains unused files with entry -1.
            continue;
        };
        let directory = match rec.field("slot3").and_then(|v| g.r#ref(v)) {
            Some(list) => g
                .names(list)?
                .into_iter()
                .map(|name| name.ok_or_else(|| Error("archive file has an unnamed directory".into())))
                .collect::<Result<_>>()?,
            None => Vec::new(),
        };
        files.push(ArchiveFile { name: rec.name.clone().unwrap_or_default(), archive, entry, directory });
    }
    Ok(files)
}

/// Use the same English database as the main export, resolved by directory rather than AFS order.
/// USA packs are present on the supported Japanese discs too; the English and Japanese names
/// are fallbacks for manifests without a USA pack.
pub fn stage_database(files: &[ArchiveFile], generator: usize) -> Result<Option<usize>> {
    let mut paths = files.iter().filter(|f| f.archive == "NDMW.AFS" && f.entry == generator).map(|f| &f.directory);
    let Some(path) = paths.next() else { return Ok(None) };
    if paths.any(|other| other != path) {
        return Err(Error(format!("generator pack {generator} has ambiguous database directories")));
    }
    for name in ["usa_pack.igb", "eng_pack.igb", "jpn_pack.igb"] {
        let mut matches = files.iter().filter(|f| f.archive == "AREA.AFS" && &f.directory == path && f.name == name);
        if let Some(file) = matches.next() {
            if matches.any(|other| other.entry != file.entry) {
                return Err(Error(format!("generator pack {generator} has ambiguous local databases")));
            }
            return Ok(Some(file.entry));
        }
    }
    Ok(None)
}

/// File name -> every (archive, entry) carrying it, in manifest order.
pub fn read_names(manifest: &[u8]) -> Result<HashMap<String, Vec<(String, i64)>>> {
    let (dirs, chain) = igb::first_chain(manifest)?;
    let mut out: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for rec in &chain {
        if rec.class != "igAdxAfsFile" {
            continue;
        }
        // Keyed by slot ordinal; a repeated ordinal keeps the last value, as a dict would.
        let mut by_slot = HashMap::new();
        for (i, t) in dirs[rec.class_index].trips.iter().enumerate() {
            if let Some(f) = rec.fields.get(i) {
                by_slot.insert(t.1, &f.value);
            }
        }
        let name = by_slot.get(&SLOT_NAME).and_then(|v| v.str()).unwrap_or("").trim_end_matches('\0').to_string();
        let archive = match by_slot.get(&SLOT_ARCHIVE).and_then(|v| v.int()) {
            Some(0) => "NDMW.AFS",
            Some(1) => "AREA.AFS",
            _ => continue,
        };
        if let (false, Some(entry)) = (name.is_empty(), by_slot.get(&SLOT_ENTRY).and_then(|v| v.int())) {
            out.entry(name).or_default().push((archive.to_string(), entry));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, archive: &'static str, entry: usize, stage: &str) -> ArchiveFile {
        ArchiveFile { name: name.into(), archive, entry, directory: vec![stage.into(), "separate".into()] }
    }

    #[test]
    fn databases_follow_the_generator_directory_and_language() {
        let files = [
            file("usa_pack.igb", "AREA.AFS", 99, "stag0102"),
            file("generatorh.igb", "NDMW.AFS", 615, "stag0101"),
            file("eng_pack.igb", "AREA.AFS", 416, "stag0101"),
            file("usa_pack.igb", "AREA.AFS", 422, "stag0101"),
            file("generatorn.igb", "NDMW.AFS", 616, "stag0101"),
        ];
        assert_eq!(stage_database(&files, 615).unwrap(), Some(422));
        assert_eq!(stage_database(&files, 616).unwrap(), Some(422));
        assert_eq!(stage_database(&files, 999).unwrap(), None);
        assert_eq!(stage_database(&files[..3], 615).unwrap(), Some(416));
    }

    #[test]
    fn conflicting_directories_cannot_silently_choose_another_stages_enemies() {
        let files =
            [file("generatorh.igb", "NDMW.AFS", 615, "stag0101"), file("generatorh.igb", "NDMW.AFS", 615, "stag0102")];
        assert!(stage_database(&files, 615).is_err());
    }
}

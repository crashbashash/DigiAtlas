//! Archive entry names from NDMW.IGB, the game's virtual filesystem. Records of class
//! `igAdxAfsFile` carry a name, the archive (0 = NDMW.AFS, 1 = AREA.AFS) and the entry index.

use std::collections::HashMap;

use crate::error::Result;
use crate::igb;

const SLOT_NAME: u16 = 2;
const SLOT_ARCHIVE: u16 = 4;
const SLOT_ENTRY: u16 = 5;

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

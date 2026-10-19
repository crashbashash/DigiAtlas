//! Loading-screen banners: one 256x256 picture per stage with the area and room name baked in.
//!
//! `ld*.igb` packs in AREA.AFS hold them, one set per language; the USA set is the highest entry
//! of each name. `ldag<id>` belongs to `stag<id>` and `ldg<id>` to `dng<id>`.

use std::collections::HashMap;

use crate::afs::Afs;
use crate::error::Result;
use crate::igb::Graph;
use crate::textures::{self, Texture};

pub fn pack_name(stage_id: &str) -> Option<String> {
    if let Some(rest) = stage_id.strip_prefix("stag") {
        return Some(format!("ldag{}.igb", rest.to_lowercase()));
    }
    stage_id.strip_prefix("dng").map(|rest| format!("ldg{rest}.igb"))
}

/// The area and room text of a banner (x0, y0, x1, y1), without the "Loading" sprite.
const NAME_BAND: (usize, usize, usize, usize) = (0, 188, 168, 256);

/// Fingerprint of a banner's name text, recorded next to each transcribed stage name.
pub fn fingerprint(tex: &Texture) -> String {
    let (x0, y0, x1, y1) = NAME_BAND;
    textures::region_sha1(tex, x0, y0, x1, y1)
}

/// A stage's banner, or None when it has no loading-pack entry or only a small placeholder.
pub fn load(area: &Afs, names: &HashMap<String, Vec<(String, i64)>>, stage_id: &str) -> Result<Option<Texture>> {
    let Some(entries) = pack_name(stage_id).and_then(|n| names.get(&n)) else {
        return Ok(None);
    };
    let Some(entry) = entries.iter().filter(|(a, _)| a == "AREA.AFS").map(|(_, e)| *e).max() else {
        return Ok(None);
    };
    let graph = Graph::new(area.entry(entry as usize)?)?;
    let Some(image) = (0..graph.s2.len()).find(|&i| graph.class(i) == "igImage") else { return Ok(None) };
    // System-scene placeholders can be unpaletted GameCube textures. They are
    // not loading banners; inspect their dimensions before attempting CI8 decode.
    let dimensions = graph.vals(image);
    if dimensions.first().and_then(|v| v.int()) != Some(256) || dimensions.get(1).and_then(|v| v.int()) != Some(256) {
        return Ok(None);
    }
    Ok(Some(textures::decode(&graph, image, textures::clut_of(&graph, image)?)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_loading_pack_of_a_stage() {
        assert_eq!(pack_name("stag0102").as_deref(), Some("ldag0102.igb"));
        assert_eq!(pack_name("stagGF01").as_deref(), Some("ldaggf01.igb"));
        assert_eq!(pack_name("dng101b1").as_deref(), Some("ldg101b1.igb"));
        assert_eq!(pack_name("loading"), None);
    }
}

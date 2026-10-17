//! Top-down stage maps built from each stage's own terrain geometry.
//! Port of tools/ps2_export/maps.py; must produce the same images and bounds.

use crate::afs::Afs;
use crate::error::Result;
use crate::render::Raster;

pub struct StageMap {
    pub pack: usize,
    pub scene: String,
    /// min x, max x, min z, max z (world).
    pub bounds: [f64; 4],
    pub raster: Raster,
    /// Share of spawn points that land on drawn geometry.
    pub coverage: f64,
}

impl StageMap {
    pub fn png(&self) -> Result<Vec<u8>> {
        crate::png::encode_rgba(self.raster.width, self.raster.height, &self.raster.rgba)
    }
}

/// Render the map for one stage, or None when no terrain scene covers its spawn points. A stage
/// without spawn points gets its largest terrain scene, widened to hold the `extra` (x, z) points.
pub fn build(_ndmw: &Afs, _packs: &[usize], _spawns: &[[f64; 3]], _extra: &[(f64, f64)]) -> Result<Option<StageMap>> {
    todo!("port maps.build")
}

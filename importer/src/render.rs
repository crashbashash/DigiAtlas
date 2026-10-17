//! Top-down rasteriser for stage geometry. Port of tools/ps2_export/render.py; must produce the
//! same pixels.

pub struct Raster {
    pub width: usize,
    pub height: usize,
    pub pixels_per_unit: f64,
    pub rgba: Vec<u8>,
    pub min_x: f64,
    pub min_z: f64,
}

impl Raster {
    /// Share of the image that has geometry.
    pub fn fill(&self) -> f64 {
        todo!("port render.Raster.fill")
    }
}

//! Scene graphs and geometry from a stage pack. Port of tools/ps2_export/scene.py.

use crate::error::Result;
use crate::igb::Graph;

pub type Vec3 = [f64; 3];
pub type Triangle = [Vec3; 3];

pub struct Scene {
    /// igSceneInfo record.
    pub index: usize,
    pub name: String,
    pub triangles: Vec<Triangle>,
    /// The same triangles grouped by the geometry instance they came from.
    pub parts: Vec<Vec<Triangle>>,
}

/// Every scene in the pack with its geometry in scene space (transforms applied).
pub fn scenes(_graph: &Graph) -> Result<Vec<Scene>> {
    todo!("port scene.scenes")
}

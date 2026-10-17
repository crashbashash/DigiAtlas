//! Top-down stage maps built from each stage's own terrain geometry.
//!
//! A stage pack holds several scenes (terrain, props, interface, characters). The terrain scene is
//! the large one that actually covers the places generators spawn things, so it is chosen by how
//! many spawn points fall inside its footprint. The map is cropped to the spawn area plus a margin.

use std::collections::{HashMap, HashSet};

use crate::afs::Afs;
use crate::error::Result;
use crate::igb::Graph;
use crate::pyfmt;
use crate::render::{self, Raster};
use crate::scene::{self, Scene, Triangle};

const MIN_TRIANGLES: usize = 200;
/// Interface, effects and model scenes.
const SKIP_PREFIXES: [&str; 9] = ["i_", "x_", "g_", "e_", "f_", "m_", "n_", "q_", "s_"];
const MARGIN: f64 = 150.0;
/// World units kept around the playable area when the picture is cropped to it.
const TRIM_MARGIN: f64 = 20.0;
const MIN_COLLISION_TRIANGLES: usize = 150;
/// The collision mesh has under 1/8 of the visible terrain's triangles.
const COLLISION_RATIO: usize = 8;
/// World units the walkable area is widened by, so cliff edges are not cut.
const WALKABLE_GROW: f64 = 6.0;
/// Share of points that must lie on collision floor for it to be used.
const MIN_WALKABLE_SHARE: f64 = 0.97;
/// Flat two-triangle meshes at one height that make up a ground plane.
const MIN_GROUND_TILES: usize = 4;
/// Meshes narrower than this (trees, pillars, ornaments) are props, not terrain.
const MIN_PART_SPAN: f64 = 60.0;

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

/// Python's `min()` over floats: the first smallest value.
fn py_min(values: impl IntoIterator<Item = f64>) -> f64 {
    let mut it = values.into_iter();
    let first = it.next().expect("min() of an empty sequence");
    it.fold(first, |m, v| if v < m { v } else { m })
}

/// Python's `max()` over floats: the first largest value.
fn py_max(values: impl IntoIterator<Item = f64>) -> f64 {
    let mut it = values.into_iter();
    let first = it.next().expect("max() of an empty sequence");
    it.fold(first, |m, v| if v > m { v } else { m })
}

fn sorted(mut values: Vec<f64>) -> Vec<f64> {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values
}

fn corners<'a>(tris: impl IntoIterator<Item = &'a Triangle>) -> impl Iterator<Item = &'a [f64; 3]> {
    tris.into_iter().flatten()
}

/// (min x, max x, min z, max z) of the triangles.
fn bbox<'a>(tris: impl IntoIterator<Item = &'a Triangle> + Clone) -> [f64; 4] {
    [
        py_min(corners(tris.clone()).map(|p| p[0])),
        py_max(corners(tris.clone()).map(|p| p[0])),
        py_min(corners(tris.clone()).map(|p| p[2])),
        py_max(corners(tris).map(|p| p[2])),
    ]
}

fn inside(b: &[f64; 4], x: f64, z: f64) -> bool {
    b[0] <= x && x <= b[1] && b[2] <= z && z <= b[3]
}

/// Share of the points inside the box.
fn hit_share(b: &[f64; 4], points: &[(f64, f64)]) -> f64 {
    points.iter().filter(|&&(x, z)| inside(b, x, z)).count() as f64 / points.len() as f64
}

fn span(part: &[Triangle]) -> f64 {
    let [x0, x1, z0, z1] = bbox(part);
    py_max([x1 - x0, z1 - z0])
}

/// A float as a hash key, with -0.0 and 0.0 the same key as in a Python dict.
fn key_bits(x: f64) -> u64 {
    (x + 0.0).to_bits()
}

/// (height, size) of a part that is one flat quad (at most two triangles), else None.
fn flat_tile_key(part: &[Triangle]) -> Option<(u64, u64)> {
    if part.len() > 2 {
        return None;
    }
    let ys: Vec<f64> = corners(part).map(|p| p[1]).collect();
    if py_max(ys.iter().copied()) - py_min(ys.iter().copied()) < 0.5 {
        Some((key_bits(pyfmt::round(ys[0], 1)), key_bits(pyfmt::round(span(part), 1))))
    } else {
        None
    }
}

/// Indexes of the flat quads that tile a ground or void plane under the stage.
///
/// Such a plane is a grid of equal two-triangle tiles at one height with gaps between them. It is
/// not somewhere to walk, and the gaps show as holes in the map. A lone flat quad (an arena floor)
/// stays.
pub fn ground_tiles(parts: &[Vec<Triangle>]) -> HashSet<usize> {
    let mut by_height: HashMap<(u64, u64), Vec<usize>> = HashMap::new();
    for (i, part) in parts.iter().enumerate() {
        if let Some(key) = flat_tile_key(part) {
            by_height.entry(key).or_default().push(i);
        }
    }
    by_height.into_values().filter(|ids| ids.len() >= MIN_GROUND_TILES).flatten().collect()
}

/// The scene's meshes without its props and ground-plane tiles.
pub fn terrain_parts(s: &Scene, min_span: f64) -> Vec<&[Triangle]> {
    let tiles = ground_tiles(&s.parts);
    s.parts
        .iter()
        .enumerate()
        .filter(|(i, p)| !tiles.contains(i) && span(p) >= min_span)
        .map(|(_, p)| p.as_slice())
        .collect()
}

fn skipped(name: &str) -> bool {
    SKIP_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// (share of points inside the scene's footprint rounded to 2 places, triangle count): compared
/// as a Python tuple.
fn coverage_key(s: &Scene, points: &[(f64, f64)]) -> (f64, usize) {
    let hit = if points.is_empty() { 0.0 } else { hit_share(&bbox(&s.triangles), points) };
    (pyfmt::round(hit, 2), s.triangles.len())
}

fn key_greater(a: (f64, usize), b: (f64, usize)) -> bool {
    a.0 > b.0 || (a.0 == b.0 && a.1 > b.1)
}

/// The terrain scene: most spawn points inside its footprint, then most triangles.
pub fn choose_scene(scenes: &[Scene], points: &[(f64, f64)]) -> Option<usize> {
    let mut best: Option<(usize, (f64, usize))> = None;
    for (i, s) in scenes.iter().enumerate() {
        if s.triangles.len() < MIN_TRIANGLES || skipped(&s.name) {
            continue;
        }
        let key = coverage_key(s, points);
        if best.is_none_or(|(_, b)| key_greater(key, b)) {
            best = Some((i, key));
        }
    }
    best.map(|(i, _)| i)
}

/// The world rectangle the raster covers.
fn bounds(r: &Raster) -> [f64; 4] {
    [r.min_x, r.min_x + r.width as f64 / r.pixels_per_unit, r.min_z, r.min_z + r.height as f64 / r.pixels_per_unit]
}

/// The stage's collision mesh: an unnamed scene in the same pack, much smaller than the visible
/// terrain.
///
/// It holds only the floors a character can stand on (and the walls around them), so it says which
/// parts of the terrain are playable. Most stages carry one; some (arenas) do not.
pub fn collision_scene(scenes: &[Scene], terrain: usize) -> Option<&Scene> {
    let limit = scenes[terrain].triangles.len();
    let mut best: Option<&Scene> = None;
    for (i, s) in scenes.iter().enumerate() {
        let scaled = s.triangles.len() * COLLISION_RATIO;
        if i == terrain || !s.name.is_empty() || !(MIN_COLLISION_TRIANGLES <= scaled && scaled <= limit) {
            continue;
        }
        if best.is_none_or(|b| s.triangles.len() > b.triangles.len()) {
            best = Some(s);
        }
    }
    best
}

/// Clear the parts of the map that are not floor in the collision mesh; false when it does not
/// fit.
///
/// The mesh is used only when it lies under nearly every point of interest, so a stage whose
/// collision data is partial keeps its full picture rather than losing places people stand.
pub fn walkable_only(raster: &mut Raster, collision: Option<&Scene>, points: &[(f64, f64)]) -> bool {
    let Some(collision) = collision else { return false };
    if points.is_empty() {
        return false;
    }
    let keep = render::floor_mask(&collision.triangles, raster, WALKABLE_GROW);
    let on_floor = points.iter().filter(|&&(x, z)| raster.kept(&keep, x, z)).count();
    if (on_floor as f64) < MIN_WALKABLE_SHARE * points.len() as f64 {
        return false;
    }
    raster.clip(&keep);
    raster.trim(TRIM_MARGIN);
    true
}

/// The scenes of an object pack, or None for packs that are not one (textures, scripts).
fn pack_scenes(ndmw: &Afs, pack: usize) -> Result<Option<Vec<Scene>>> {
    match Graph::new(ndmw.entry(pack)?) {
        Ok(graph) => Ok(Some(scene::scenes(&graph)?)),
        Err(_) => Ok(None),
    }
}

/// Render the map for one stage, or None when no terrain scene covers its spawn points. A stage
/// without spawn points gets its largest terrain scene, widened to hold the `extra` (x, z) points.
pub fn build(ndmw: &Afs, packs: &[usize], spawns: &[[f64; 3]], extra: &[(f64, f64)]) -> Result<Option<StageMap>> {
    if spawns.is_empty() {
        return build_empty(ndmw, packs, extra);
    }
    let points: Vec<(f64, f64)> = spawns.iter().map(|p| (p[0], p[2])).collect();
    let ys = sorted(spawns.iter().map(|p| p[1]).collect());
    // (key, pack, scenes, terrain scene index)
    type Choice = ((f64, usize), usize, Vec<Scene>, usize);
    let mut best: Option<Choice> = None;
    for &pack in packs {
        let Some(scenes) = pack_scenes(ndmw, pack)? else { continue };
        let Some(s) = choose_scene(&scenes, &points) else { continue };
        let key = coverage_key(&scenes[s], &points);
        if best.as_ref().is_none_or(|b| key_greater(key, b.0)) {
            best = Some((key, pack, scenes, s));
        }
    }
    let Some((key, pack, scenes, s)) = best else { return Ok(None) };
    if key.0 < 0.5 {
        return Ok(None);
    }
    let terrain = &scenes[s];
    let xs = points.iter().map(|p| p.0);
    let zs = points.iter().map(|p| p.1);
    let pad = py_max([
        MARGIN,
        0.25 * py_max([py_max(xs.clone()) - py_min(xs.clone()), py_max(zs.clone()) - py_min(zs.clone())]),
    ]);
    let roi = [py_min(xs.clone()) - pad, py_max(xs) + pad, py_min(zs.clone()) - pad, py_max(zs) + pad];
    let parts = terrain_parts(terrain, MIN_PART_SPAN);
    let mut raster = render::render(parts.iter().copied().flatten(), roi, Some(ys[ys.len() / 2]));
    let coverage = points.iter().filter(|&&(x, z)| raster.covered(x, z)).count() as f64 / points.len() as f64;
    walkable_only(&mut raster, collision_scene(&scenes, s), &points);
    Ok(Some(StageMap { pack, scene: terrain.name.clone(), bounds: bounds(&raster), raster, coverage }))
}

/// Map of the biggest terrain scene in a stage that has nothing spawning in it.
fn build_empty(ndmw: &Afs, packs: &[usize], extra: &[(f64, f64)]) -> Result<Option<StageMap>> {
    let mut best: Option<(usize, usize, Vec<Scene>, usize)> = None;
    for &pack in packs {
        let Some(scenes) = pack_scenes(ndmw, pack)? else { continue };
        let mut pick: Option<usize> = None;
        for (i, s) in scenes.iter().enumerate() {
            if s.triangles.len() < MIN_TRIANGLES || skipped(&s.name) {
                continue;
            }
            let leader = pick.map_or(best.as_ref().map(|b| b.0), |p| Some(scenes[p].triangles.len()));
            if leader.is_none_or(|n| s.triangles.len() > n) {
                pick = Some(i);
            }
        }
        if let Some(i) = pick {
            best = Some((scenes[i].triangles.len(), pack, scenes, i));
        }
    }
    let Some((_, pack, scenes, s)) = best else { return Ok(None) };
    let terrain = &scenes[s];
    let parts = terrain_parts(terrain, MIN_PART_SPAN);
    if parts.iter().all(|p| p.is_empty()) {
        return Ok(None);
    }
    // A backdrop plane spanning the whole scene would make the crop far bigger than the rooms in
    // it, so the crop first leaves out the biggest meshes. They come back when someone stands on
    // one of them.
    let overall = py_max(parts.iter().map(|p| span(p)));
    let mut inner: Vec<&[Triangle]> = parts.iter().copied().filter(|p| span(p) < 0.85 * overall).collect();
    if inner.is_empty() {
        inner = parts.clone();
    }
    let mut raster = None;
    for chosen in [&inner, &parts] {
        let tris = chosen.iter().copied().flatten();
        let [mut x0, mut x1, mut z0, mut z1] = bbox(tris.clone());
        let ys = sorted(corners(tris.clone()).map(|p| p[1]).collect());
        x0 = py_min(std::iter::once(x0).chain(extra.iter().map(|e| e.0)));
        x1 = py_max(std::iter::once(x1).chain(extra.iter().map(|e| e.0)));
        z0 = py_min(std::iter::once(z0).chain(extra.iter().map(|e| e.1)));
        z1 = py_max(std::iter::once(z1).chain(extra.iter().map(|e| e.1)));
        let m = MARGIN / 3.0;
        let r = render::render(tris, [x0 - m, x1 + m, z0 - m, z1 + m], Some(ys[ys.len() / 2]));
        let done = extra.iter().all(|&(x, z)| r.covered(x, z));
        raster = Some(r);
        if done {
            break;
        }
    }
    let mut raster = raster.expect("at least one crop is rendered");
    walkable_only(&mut raster, collision_scene(&scenes, s), extra);
    if raster.fill() < 0.02 {
        return Ok(None);
    }
    Ok(Some(StageMap { pack, scene: terrain.name.clone(), bounds: bounds(&raster), raster, coverage: 1.0 }))
}

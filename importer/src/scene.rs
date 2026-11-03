//! Scene graphs and geometry from a stage pack.
//!
//! A pack holds several scenes (terrain, props, characters), each an `igSceneInfo` pointing at a
//! root node. Nodes form a tree through `igNodeList` child lists; an `igTransform` carries a 4x4
//! row-major matrix (row vectors, translation in the last row). Geometry hangs off `igGeometry`
//! nodes as `igGeometryAttr1_5` attributes: a vertex array whose position stream is
//! `12 * numVerts` bytes, drawn as triangle lists (type 3) or strips (type 4, with a
//! primitive-length array).
//! Indexed meshes (used extensively by GameCube) first map primitive corners through an
//! `igIndexArray`; its element count can exceed the number of unique vertices.
//!
//! Field positions are indices into a record's decoded fields (see `igb`).

use std::collections::HashMap;

use crate::error::Result;
use crate::igb::{Graph, Value};

/// Child igNodeList on igGroup, igTransform, igAttrSet, igSwitch, igGeometry.
const NODE_CHILDREN: usize = 3;
const TRANSFORM_MATRIX: usize = 4;
/// igAttrList on an igGeometry.
const GEOMETRY_ATTRS: usize = 4;
/// igSceneInfo._sceneGraph (an igNode reference).
const SCENE_ROOT: usize = 2;
const ATTR_VERTEX_ARRAY: usize = 1;
const ATTR_INDEX_ARRAY: usize = 2;
const ATTR_PRIM_TYPE: usize = 3;
const ATTR_NUM_PRIMS: usize = 4;
const ATTR_STRIP_LENGTHS: usize = 10;
const LIST_PRIM_TYPE: i64 = 3;
const STRIP_PRIM_TYPE: i64 = 4;

pub type Vec3 = [f64; 3];
pub type Triangle = [Vec3; 3];
pub type Matrix = [f64; 16];

pub const IDENTITY: Matrix = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];

pub struct Scene {
    /// igSceneInfo record.
    pub index: usize,
    pub name: String,
    pub triangles: Vec<Triangle>,
    /// The same triangles grouped by the geometry instance they came from (one mesh in the scene),
    /// so callers can tell a terrain slab from a tree or a pillar.
    pub parts: Vec<Vec<Triangle>>,
}

/// Python's built-in `sum()` over floats (3.12 and later): the first term is added to the integer
/// start, the rest are summed with Neumaier compensation, which is added back at the end.
fn py_sum(terms: [f64; 4]) -> f64 {
    let mut f = 0.0 + terms[0];
    let mut c = 0.0;
    for &x in &terms[1..] {
        let t = f + x;
        if f.abs() >= x.abs() {
            c += (f - t) + x;
        } else {
            c += (x - t) + f;
        }
        f = t;
    }
    if c != 0.0 && c.is_finite() {
        f += c;
    }
    f
}

/// Row-vector composition: apply `a` first, then `b`.
pub fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    let mut out = [0.0; 16];
    for r in 0..4 {
        for c in 0..4 {
            out[4 * r + c] = py_sum([0, 1, 2, 3].map(|k| a[4 * r + k] * b[4 * k + c]));
        }
    }
    out
}

pub fn transform_point(m: &Matrix, p: &Vec3) -> Vec3 {
    let [x, y, z] = *p;
    [
        x * m[0] + y * m[4] + z * m[8] + m[12],
        x * m[1] + y * m[5] + z * m[9] + m[13],
        x * m[2] + y * m[6] + z * m[10] + m[14],
    ]
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn f32_at(b: &[u8], at: usize) -> Option<f64> {
    b.get(at..at + 4).map(|s| f32::from_le_bytes(s.try_into().unwrap()) as f64)
}

fn field(vals: &[&Value], i: usize) -> Option<i64> {
    vals.get(i).and_then(|v| v.int())
}

fn index_order(bytes: &[u8], count: usize, vertex_count: usize) -> Option<Vec<usize>> {
    if count == 0 {
        return Some(Vec::new());
    }
    if !bytes.len().is_multiple_of(count) {
        return None;
    }
    let width = bytes.len() / count;
    if !matches!(width, 2 | 4) {
        return None;
    }
    bytes
        .chunks_exact(width)
        .map(|b| {
            let i = if width == 2 {
                u16::from_le_bytes(b.try_into().unwrap()) as usize
            } else {
                u32::from_le_bytes(b.try_into().unwrap()) as usize
            };
            (i < vertex_count).then_some(i)
        })
        .collect()
}

fn triangle_indices(ptype: i64, nprims: usize, order: &[usize], lengths: &[usize]) -> Vec<[usize; 3]> {
    let mut triangles = Vec::new();
    if ptype == LIST_PRIM_TYPE && nprims <= order.len() / 3 {
        triangles.extend(order.as_chunks::<3>().0.iter().take(nprims).copied());
    } else if ptype == STRIP_PRIM_TYPE && lengths.iter().try_fold(0usize, |n, l| n.checked_add(*l)) == Some(order.len())
    {
        let mut off = 0;
        for &length in lengths {
            for j in 0..length.saturating_sub(2) {
                let t = [order[off + j], order[off + j + 1], order[off + j + 2]];
                triangles.push(if j % 2 == 0 { t } else { [t[1], t[0], t[2]] });
            }
            off += length;
        }
    }
    triangles
}

/// Reads and caches meshes (local-space triangles) from one pack's graph.
struct Geometry<'g> {
    g: &'g Graph,
    cache: HashMap<usize, Vec<Triangle>>,
}

impl<'g> Geometry<'g> {
    /// The vertex positions of a geometry attribute: the stream of its vertex array that holds
    /// exactly three floats per vertex.
    fn positions(&self, attr: usize) -> Option<Vec<Vec3>> {
        let g = self.g;
        let va = g.r#ref(g.vals(attr).get(ATTR_VERTEX_ARRAY)?)?;
        if g.class(va) != "igVertexArray1_1" {
            return None;
        }
        let vals = g.vals(va);
        let stream_list = usize::try_from(field(&vals, 0)?).ok()?;
        let count = field(&vals, 1)?;
        let start = g.block_start(stream_list)?;
        let n = g.block_size(stream_list)? / 4;
        for j in 0..n {
            let sid = u32_at(&g.b, start + 4 * j)? as usize;
            if g.has_block(sid) && g.block_size(sid).map(|s| s as i64) == Some(12 * count) {
                let base = g.block_start(sid)?;
                return (0..count as usize)
                    .map(|j| {
                        Some([
                            f32_at(&g.b, base + 12 * j)?,
                            f32_at(&g.b, base + 12 * j + 4)?,
                            f32_at(&g.b, base + 12 * j + 8)?,
                        ])
                    })
                    .collect();
            }
        }
        None
    }

    /// Vertex index triples of a geometry attribute: a triangle list, or strips with every other
    /// triangle's first two corners swapped to keep the winding.
    fn indices(&self, attr: usize, vertex_count: usize) -> Vec<[usize; 3]> {
        let g = self.g;
        let v = g.vals(attr);
        let (ptype, nprims) = (field(&v, ATTR_PRIM_TYPE), field(&v, ATTR_NUM_PRIMS).unwrap_or(0));
        let order = match v.get(ATTR_INDEX_ARRAY).and_then(|r| g.r#ref(r)) {
            Some(array) => {
                if g.class(array) != "igIndexArray" {
                    return Vec::new();
                }
                let vals = g.vals(array);
                let (Some(block), Some(count)) = (field(&vals, 0), field(&vals, 1)) else { return Vec::new() };
                let Some(block) = usize::try_from(block).ok() else { return Vec::new() };
                let Some(size) = g.block_size(block) else { return Vec::new() };
                let Some(order) =
                    g.block(block, size).ok().and_then(|b| index_order(b, count.max(0) as usize, vertex_count))
                else {
                    return Vec::new();
                };
                order
            }
            None => (0..vertex_count).collect(),
        };
        let mut lengths = Vec::new();
        if ptype == Some(STRIP_PRIM_TYPE) {
            let Some(pl) = v.get(ATTR_STRIP_LENGTHS).and_then(|r| g.r#ref(r)) else { return Vec::new() };
            if g.class(pl) != "igPrimLengthArray1_1" {
                return Vec::new();
            }
            let pv = g.vals(pl);
            let (Some(block), Some(count)) = (field(&pv, 0), field(&pv, 1)) else { return Vec::new() };
            let Some(start) = usize::try_from(block).ok().and_then(|b| g.block_start(b)) else { return Vec::new() };
            let decoded: Option<Vec<usize>> =
                (0..count.max(0) as usize).map(|j| u32_at(&g.b, start + 4 * j).map(|l| l as usize)).collect();
            let Some(decoded) = decoded else { return Vec::new() };
            lengths = decoded;
        }
        triangle_indices(ptype.unwrap_or(-1), nprims.max(0) as usize, &order, &lengths)
    }

    fn mesh(&mut self, attr: usize) -> &[Triangle] {
        if !self.cache.contains_key(&attr) {
            let tris = match self.positions(attr) {
                Some(pos) => {
                    self.indices(attr, pos.len()).into_iter().map(|[a, b, c]| [pos[a], pos[b], pos[c]]).collect()
                }
                None => Vec::new(),
            };
            self.cache.insert(attr, tris);
        }
        &self.cache[&attr]
    }
}

/// Every scene in the pack with its geometry in scene space (transforms applied).
pub fn scenes(graph: &Graph) -> Result<Vec<Scene>> {
    let mut geometry = Geometry { g: graph, cache: HashMap::new() };
    let mut out = Vec::new();
    for (k, rec) in graph.s2.iter().enumerate() {
        if rec.class != "igSceneInfo" {
            continue;
        }
        let mut scene =
            Scene { index: k, name: rec.name.clone().unwrap_or_default(), triangles: Vec::new(), parts: Vec::new() };
        if let Some(root) = graph.vals(k).get(SCENE_ROOT).and_then(|v| graph.r#ref(v)) {
            walk(graph, &mut geometry, root, &IDENTITY, &mut scene);
        }
        out.push(scene);
    }
    Ok(out)
}

/// Depth-first walk that accumulates transforms. Shared subtrees are instanced once per
/// reference; only a node listing itself as its own child is skipped.
fn walk(graph: &Graph, geometry: &mut Geometry, node: usize, matrix: &Matrix, scene: &mut Scene) {
    let class = graph.class(node);
    let vals = graph.vals(node);
    let mut local = *matrix;
    if class == "igTransform" {
        if let Some(m) = vals.get(TRANSFORM_MATRIX).and_then(|v| v.floats()) {
            local = multiply(m.try_into().expect("igMatrix44f has 16 floats"), matrix);
        }
    }
    if class == "igGeometry" {
        let attrs = vals.get(GEOMETRY_ATTRS).and_then(|v| graph.r#ref(v));
        if let Some(attrs) = attrs.filter(|&a| graph.class(a) == "igAttrList") {
            for a in graph.list_refs(attrs).unwrap_or_default().into_iter().flatten() {
                if graph.class(a) != "igGeometryAttr1_5" {
                    continue;
                }
                let part: Vec<Triangle> =
                    geometry.mesh(a).iter().map(|t| t.each_ref().map(|p| transform_point(&local, p))).collect();
                if !part.is_empty() {
                    scene.triangles.extend_from_slice(&part);
                    scene.parts.push(part);
                }
            }
        }
    }
    let children = vals.get(NODE_CHILDREN).and_then(|v| graph.r#ref(v));
    if let Some(children) = children.filter(|&c| graph.class(c) == "igNodeList") {
        for c in graph.list_refs(children).unwrap_or_default().into_iter().flatten() {
            if c != node {
                walk(graph, geometry, c, &local, scene);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexed_strips_reuse_vertices_and_reset_winding_for_each_strip() {
        let bytes: Vec<_> = [3u16, 2, 1, 0, 1, 2, 4].into_iter().flat_map(u16::to_le_bytes).collect();
        let order = index_order(&bytes, 7, 5).unwrap();
        assert_eq!(triangle_indices(STRIP_PRIM_TYPE, 2, &order, &[4, 3]), [[3, 2, 1], [1, 2, 0], [1, 2, 4]]);
        assert!(triangle_indices(STRIP_PRIM_TYPE, 2, &order, &[4, 4]).is_empty());
    }

    #[test]
    fn indexed_lists_follow_the_index_buffer_and_reject_invalid_vertices() {
        let bytes: Vec<_> = [2u32, 0, 1, 1, 0, 3].into_iter().flat_map(u32::to_le_bytes).collect();
        let order = index_order(&bytes, 6, 4).unwrap();
        assert_eq!(triangle_indices(LIST_PRIM_TYPE, 2, &order, &[]), [[2, 0, 1], [1, 0, 3]]);
        assert!(index_order(&bytes, 6, 3).is_none());
        assert!(index_order(&bytes[..23], 6, 4).is_none());
        assert_eq!(triangle_indices(LIST_PRIM_TYPE, 1, &[0, 1, 2], &[]), [[0, 1, 2]]);
    }

    #[test]
    fn sums_floats_like_python() {
        // Python 3.12+: sum([0.1, 0.2, 0.3, 0.0]) == 0.6 (a naive sum gives 0.6000000000000001).
        assert_eq!(py_sum([0.1, 0.2, 0.3, 0.0]), 0.6);
        assert_eq!(py_sum([-0.0, -0.0, -0.0, -0.0]), 0.0);
    }

    #[test]
    fn composes_row_vector_transforms() {
        let mut t = IDENTITY;
        t[12] = 5.0; // translate x by 5
        let mut s = IDENTITY;
        s[0] = 2.0; // scale x by 2
        assert_eq!(transform_point(&multiply(&t, &s), &[1.0, 0.0, 0.0]), [12.0, 0.0, 0.0]);
        assert_eq!(transform_point(&multiply(&s, &t), &[1.0, 0.0, 0.0]), [7.0, 0.0, 0.0]);
    }
}

//! Top-down rasteriser for stage geometry.
//!
//! Floors (triangles facing up) are filled with a colour ramp, drawn lowest first so higher
//! surfaces cover lower ones. The ramp peaks at the height where things spawn so walkable floors
//! stand out. Steep triangles (walls) are drawn as thin edge lines on top. The background stays
//! transparent so the app can place the map on its own theme. Image x is world x and image y is
//! world z (z grows downward).
//!
//! Python's `int()` truncates toward zero, which `as i64` matches; the order of every float
//! operation follows the original so the pixels come out the same.

use std::cmp::Ordering;

use crate::pyfmt;
use crate::scene::Triangle;

/// |normal.y| below this counts as a wall.
const WALL_NORMAL_Y: f64 = 0.35;
const LOW: [u8; 3] = [46, 82, 118];
const HIGH: [u8; 3] = [196, 218, 232];
const WALL: [u8; 4] = [16, 28, 50, 255];
/// A floor triangle covering this share of the crop is a backdrop plane.
const BACKDROP_AREA: f64 = 0.6;
const MAX_SIDE: f64 = 2000.0;
const MAX_PPU: f64 = 4.0;
const FLOOR_LOW: [u8; 3] = [166, 192, 211];
const FLOOR_HIGH: [u8; 3] = [196, 218, 232];

pub struct Raster {
    pub width: usize,
    pub height: usize,
    pub pixels_per_unit: f64,
    pub rgba: Vec<u8>,
    pub min_x: f64,
    pub min_z: f64,
}

impl Raster {
    /// Share of the image that has geometry. Near 1.0 means a flat floor with no outline.
    pub fn fill(&self) -> f64 {
        let empty = self.rgba.as_chunks::<4>().0.iter().filter(|p| p[3] == 0).count();
        1.0 - empty as f64 / (self.width * self.height) as f64
    }

    /// The pixel holding world point (x, z), if it lies inside the image.
    fn pixel(&self, x: f64, z: f64) -> Option<usize> {
        let px = ((x - self.min_x) * self.pixels_per_unit) as i64;
        let py = ((z - self.min_z) * self.pixels_per_unit) as i64;
        let inside = (0..self.width as i64).contains(&px) && (0..self.height as i64).contains(&py);
        inside.then(|| py as usize * self.width + px as usize)
    }

    /// Whether world point (x, z) lands on a drawn pixel.
    pub fn covered(&self, x: f64, z: f64) -> bool {
        self.pixel(x, z).is_some_and(|i| self.rgba[i * 4 + 3] > 0)
    }

    /// Whether world point (x, z) lands on a pixel set in `keep` (one byte per pixel).
    pub fn kept(&self, keep: &[u8], x: f64, z: f64) -> bool {
        self.pixel(x, z).is_some_and(|i| keep[i] > 0)
    }

    /// Make every pixel transparent where `keep` (one byte per pixel) is zero.
    pub fn clip(&mut self, keep: &[u8]) {
        for (px, &k) in self.rgba.as_chunks_mut::<4>().0.iter_mut().zip(keep) {
            if k == 0 {
                px.fill(0);
            }
        }
    }

    /// Crop to the drawn pixels plus a margin, moving the origin to match.
    pub fn trim(&mut self, pad_units: f64) {
        let (w, h) = (self.width, self.height);
        let mut rows = vec![false; h];
        let mut cols = vec![false; w];
        for (i, px) in self.rgba.as_chunks::<4>().0.iter().enumerate() {
            if px[3] != 0 {
                rows[i / w] = true;
                cols[i % w] = true;
            }
        }
        let (Some(top), Some(bottom)) = (rows.iter().position(|&r| r), rows.iter().rposition(|&r| r)) else { return };
        let left = cols.iter().position(|&c| c).unwrap() as i64;
        let right = cols.iter().rposition(|&c| c).unwrap() as i64;
        let pad = pyfmt::round_int(pad_units * self.pixels_per_unit);
        let (x0, x1) = ((left - pad).max(0) as usize, (right + pad).min(w as i64 - 1) as usize);
        let (y0, y1) = ((top as i64 - pad).max(0) as usize, (bottom as i64 + pad).min(h as i64 - 1) as usize);
        let mut out = Vec::with_capacity((x1 - x0 + 1) * (y1 - y0 + 1) * 4);
        for y in y0..=y1 {
            out.extend_from_slice(&self.rgba[(y * w + x0) * 4..(y * w + x1 + 1) * 4]);
        }
        self.rgba = out;
        self.width = x1 - x0 + 1;
        self.height = y1 - y0 + 1;
        self.min_x += x0 as f64 / self.pixels_per_unit;
        self.min_z += y0 as f64 / self.pixels_per_unit;
    }
}

/// Python's `max(a, b)`: the first argument unless the second is strictly greater.
fn py_max(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}

/// Python's `min(a, b)`: the first argument unless the second is strictly smaller.
fn py_min(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}

/// Order for a stable sort by a float key, treating incomparable values as equal.
fn by_key(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

pub fn normal_y(t: &Triangle) -> f64 {
    let [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = *t;
    let (ux, uy, uz, vx, vy, vz) = (bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az);
    let (nx, ny, nz) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    let length = (nx * nx + ny * ny + nz * nz).powf(0.5);
    if length > 1e-9 {
        ny / length
    } else {
        0.0
    }
}

fn area_xz(t: &Triangle) -> f64 {
    let [[ax, _, az], [bx, _, bz], [cx, _, cz]] = *t;
    ((bx - ax) * (cz - az) - (cx - ax) * (bz - az)).abs() / 2.0
}

/// A triangle's corners in image coordinates.
fn project(t: &Triangle, min_x: f64, min_z: f64, ppu: f64) -> [(f64, f64); 3] {
    t.map(|p| ((p[0] - min_x) * ppu, (p[2] - min_z) * ppu))
}

/// Draw the triangles inside `roi` (min x, max x, min z, max z), at most 2000 pixels on the long
/// side and 4 pixels per world unit. Floors are brightest at `focus_y` (where things stand),
/// fading with height difference; without a focus they are shaded by absolute height.
pub fn render<'a>(triangles: impl IntoIterator<Item = &'a Triangle>, roi: [f64; 4], focus_y: Option<f64>) -> Raster {
    let [min_x, max_x, min_z, max_z] = roi;
    let span = py_max(max_x - min_x, max_z - min_z);
    let ppu = py_min(MAX_PPU, MAX_SIDE / span);
    let width = ((max_x - min_x) * ppu) as i64 as usize + 1;
    let height = ((max_z - min_z) * ppu) as i64 as usize + 1;
    let mut rgba = vec![0u8; width * height * 4];

    let roi_area = (max_x - min_x) * (max_z - min_z);
    let mut floors: Vec<(f64, &Triangle)> = Vec::new();
    let mut walls: Vec<&Triangle> = Vec::new();
    for t in triangles {
        let xs = t.map(|p| p[0]);
        let zs = t.map(|p| p[2]);
        let (lo_x, hi_x) = (py_min(py_min(xs[0], xs[1]), xs[2]), py_max(py_max(xs[0], xs[1]), xs[2]));
        let (lo_z, hi_z) = (py_min(py_min(zs[0], zs[1]), zs[2]), py_max(py_max(zs[0], zs[1]), zs[2]));
        if hi_x < min_x || lo_x > max_x || hi_z < min_z || lo_z > max_z {
            continue;
        }
        if normal_y(t).abs() < WALL_NORMAL_Y {
            walls.push(t);
        } else if area_xz(t) < BACKDROP_AREA * roi_area {
            floors.push(((t[0][1] + t[1][1] + t[2][1]) / 3.0, t));
        }
        // else: a ground or sky plane that extends well past the crop; it only hides the structure
    }
    floors.sort_by(|a, b| by_key(a.0, b.0));
    // The floors are now in height order, so they double as the sorted heights.
    let (lo, hi) = if floors.is_empty() {
        (0.0, 0.0)
    } else {
        let n = floors.len() as f64;
        (floors[(n * 0.02) as usize].0, floors[(n * 0.98) as usize].0)
    };

    let spread = py_max(80.0, (hi - lo) * 0.5);
    for &(h, t) in &floors {
        let f = match focus_y {
            Some(focus) => py_max(0.0, 1.0 - (h - focus).abs() / spread).powf(1.6),
            None if hi > lo => py_min(1.0, py_max(0.0, (h - lo) / (hi - lo))),
            None => 0.5,
        };
        let mut color = [255u8; 4];
        for i in 0..3 {
            color[i] = (LOW[i] as f64 + (HIGH[i] as f64 - LOW[i] as f64) * f) as i64 as u8;
        }
        fill(&mut rgba, width, height, project(t, min_x, min_z, ppu), &color);
    }
    for t in walls {
        let q = project(t, min_x, min_z, ppu);
        for (a, b) in [(0, 1), (1, 2), (2, 0)] {
            line(&mut rgba, width, height, q[a], q[b]);
        }
    }
    Raster { width, height, pixels_per_unit: ppu, rgba, min_x, min_z }
}

/// Fill a triangle by scanlines through pixel centres: a pixel is drawn when its centre row lies
/// within the triangle's vertical extent and its column between the two edges (both rounded to
/// the nearest pixel boundary). `color` is one pixel's bytes.
fn fill(img: &mut [u8], w: usize, h: usize, mut pts: [(f64, f64); 3], color: &[u8]) {
    pts.sort_by(|a, b| by_key(a.1, b.1));
    let [(x0, y0), (x1, y1), (x2, y2)] = pts;
    let bpp = color.len();
    let top = ((y0 + 0.5) as i64).max(0);
    let bottom = ((y2 - 0.5) as i64).min(h as i64 - 1);
    for y in top..=bottom {
        let yc = y as f64 + 0.5;
        if yc < y0 || yc > y2 {
            continue;
        }
        let xa = if y2 > y0 { x0 + (x2 - x0) * (yc - y0) / (y2 - y0) } else { x0 };
        let xb = if yc < y1 {
            if y1 > y0 {
                x0 + (x1 - x0) * (yc - y0) / (y1 - y0)
            } else {
                x1
            }
        } else if y2 > y1 {
            x1 + (x2 - x1) * (yc - y1) / (y2 - y1)
        } else {
            x1
        };
        let (left, right) = if xa <= xb { (xa, xb) } else { (xb, xa) };
        let left = ((left + 0.5) as i64).max(0);
        let right = ((right - 0.5) as i64).min(w as i64 - 1);
        if right >= left {
            let o = (y as usize * w + left as usize) * bpp;
            for px in img[o..o + (right - left + 1) as usize * bpp].chunks_exact_mut(bpp) {
                px.copy_from_slice(color);
            }
        }
    }
}

/// The pixel positions of a line from `a` to `b`: evenly spaced samples, one more than the longer
/// side's length, truncated to whole pixels (not clipped to the image).
fn line_points(a: (f64, f64), b: (f64, f64)) -> impl Iterator<Item = (i64, i64)> {
    let steps = py_max((b.0 - a.0).abs(), (b.1 - a.1).abs()) as i64 + 1;
    (0..=steps).map(move |i| {
        let x = (a.0 + (b.0 - a.0) * i as f64 / steps as f64) as i64;
        let y = (a.1 + (b.1 - a.1) * i as f64 / steps as f64) as i64;
        (x, y)
    })
}

/// Draw a one-pixel wall line.
fn line(img: &mut [u8], w: usize, h: usize, a: (f64, f64), b: (f64, f64)) {
    for (x, y) in line_points(a, b) {
        if (0..w as i64).contains(&x) && (0..h as i64).contains(&y) {
            let o = (y as usize * w + x as usize) * 4;
            img[o..o + 4].copy_from_slice(&WALL);
        }
    }
}

/// One byte per pixel of `like`: 1 where a floor triangle lies, widened by `grow` world units.
pub fn floor_mask(triangles: &[Triangle], like: &Raster, grow: f64) -> Vec<u8> {
    let (w, h, ppu) = (like.width, like.height, like.pixels_per_unit);
    let mut mask = vec![0u8; w * h];
    let r = pyfmt::round_int(grow * ppu).max(1);
    // Half-widths of a filled disc of radius r, row by row.
    let stamp: Vec<(i64, i64)> = (-r..=r).map(|dy| (dy, ((r * r - dy * dy) as f64).powf(0.5) as i64)).collect();
    for t in triangles {
        if normal_y(t).abs() < WALL_NORMAL_Y {
            continue;
        }
        let q = project(t, like.min_x, like.min_z, ppu);
        fill(&mut mask, w, h, q, &[1]);
        for (a, b) in [(0, 1), (1, 2), (2, 0)] {
            for (x, y) in line_points(q[a], q[b]) {
                for &(dy, half) in &stamp {
                    let yy = y + dy;
                    if (0..h as i64).contains(&yy) {
                        let (lo, hi) = ((x - half).max(0), (x + half).min(w as i64 - 1));
                        if hi >= lo {
                            let row = yy as usize * w;
                            mask[row + lo as usize..=row + hi as usize].fill(1);
                        }
                    }
                }
            }
        }
    }
    mask
}

/// A navigation map made only from collision floors. Higher surfaces are brighter;
/// ramps interpolate their true height continuously, without triangle or wall outlines.
/// A one-pixel edge stamp closes raster seams without changing the floor footprint.
pub fn floor_silhouette(triangles: &[Triangle], roi: [f64; 4]) -> Raster {
    let [min_x, max_x, min_z, max_z] = roi;
    let ppu = py_min(MAX_PPU, MAX_SIDE / py_max(max_x - min_x, max_z - min_z));
    let width = ((max_x - min_x) * ppu) as usize + 1;
    let height = ((max_z - min_z) * ppu) as usize + 1;
    let mut raster = Raster { width, height, pixels_per_unit: ppu, min_x, min_z, rgba: vec![0; width * height * 4] };
    let mut heights = vec![f64::NEG_INFINITY; width * height];
    let mut low = f64::INFINITY;
    let mut high = f64::NEG_INFINITY;
    for triangle in triangles {
        if normal_y(triangle).abs() < WALL_NORMAL_Y {
            continue;
        }
        for p in triangle {
            low = low.min(p[1]);
            high = high.max(p[1]);
        }
        let q = project(triangle, min_x, min_z, ppu);
        let [(x0, z0), (x1, z1), (x2, z2)] = q;
        let determinant = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
        if determinant.abs() < 1e-9 {
            continue;
        }
        let dy1 = triangle[1][1] - triangle[0][1];
        let dy2 = triangle[2][1] - triangle[0][1];
        let gx = (dy1 * (z2 - z0) - dy2 * (z1 - z0)) / determinant;
        let gz = ((x1 - x0) * dy2 - (x2 - x0) * dy1) / determinant;
        let mut paint = |x: i64, z: i64| {
            if x < 0 || z < 0 || x >= width as i64 || z >= height as i64 {
                return;
            }
            let y = triangle[0][1] + gx * (x as f64 + 0.5 - x0) + gz * (z as f64 + 0.5 - z0);
            let index = z as usize * width + x as usize;
            heights[index] = heights[index].max(y);
        };
        let left = x0.min(x1).min(x2).floor().max(0.0) as i64;
        let right = x0.max(x1).max(x2).ceil().min(width as f64 - 1.0) as i64;
        let top = z0.min(z1).min(z2).floor().max(0.0) as i64;
        let bottom = z0.max(z1).max(z2).ceil().min(height as f64 - 1.0) as i64;
        for z in top..=bottom {
            for x in left..=right {
                let px = x as f64 + 0.5;
                let pz = z as f64 + 0.5;
                let a = ((x1 - px) * (z2 - pz) - (x2 - px) * (z1 - pz)) / determinant;
                let b = ((x2 - px) * (z0 - pz) - (x0 - px) * (z2 - pz)) / determinant;
                if a >= -1e-9 && b >= -1e-9 && a + b <= 1.0 + 1e-9 {
                    paint(x, z);
                }
            }
        }
        // Match floor_mask's one-pixel seam closure, including inverted triangle winding.
        for (a, b) in [(0, 1), (1, 2), (2, 0)] {
            for (x, z) in line_points(q[a], q[b]) {
                for (dx, dz) in [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)] {
                    paint(x + dx, z + dz);
                }
            }
        }
    }
    for (pixel, y) in raster.rgba.as_chunks_mut::<4>().0.iter_mut().zip(heights) {
        if !y.is_finite() {
            continue;
        }
        let amount = if high > low { ((y - low) / (high - low)).clamp(0.0, 1.0) } else { 1.0 };
        for channel in 0..3 {
            pixel[channel] =
                (FLOOR_LOW[channel] as f64 + (FLOOR_HIGH[channel] - FLOOR_LOW[channel]) as f64 * amount).round() as u8;
        }
        pixel[3] = 255;
    }
    raster
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collision_ramps_shade_continuously_and_keep_the_upper_surface() {
        let triangles = [
            [[10.0, 0.0, 10.0], [90.0, 80.0, 10.0], [10.0, 0.0, 90.0]],
            [[90.0, 80.0, 10.0], [90.0, 80.0, 90.0], [10.0, 0.0, 90.0]],
            // A lower floor overlapping the ramp must never draw over it.
            [[10.0, -20.0, 10.0], [90.0, -20.0, 10.0], [10.0, -20.0, 90.0]],
        ];
        let raster = floor_silhouette(&triangles, [0.0, 100.0, 0.0, 100.0]);
        let at = |x: f64, z: f64| {
            let index = raster.pixel(x, z).unwrap();
            raster.rgba[index * 4]
        };
        assert!(at(20.0, 20.0) < at(50.0, 20.0));
        assert!(at(50.0, 20.0) < at(80.0, 20.0));
        assert_eq!(at(50.0, 20.0), at(50.0, 80.0));
        let mut reversed = triangles;
        reversed.reverse();
        assert_eq!(raster.rgba, floor_silhouette(&reversed, [0.0, 100.0, 0.0, 100.0]).rgba);
        let mask = floor_mask(&triangles, &raster, 0.0);
        assert!(raster.rgba.as_chunks::<4>().0.iter().zip(mask).all(|(p, m)| (p[3] > 0) == (m > 0)));
    }

    #[test]
    fn collision_silhouette_fills_floors_without_wall_or_triangle_outlines() {
        let a = [[10.0, 0.0, 10.0], [30.0, 0.0, 10.0], [10.0, 0.0, 30.0]];
        let b = [[30.0, 0.0, 10.0], [30.0, 0.0, 30.0], [10.0, 0.0, 30.0]];
        let wall = [[50.0, 0.0, 50.0], [80.0, 0.0, 50.0], [50.0, 100.0, 50.0]];
        let raster = floor_silhouette(&[a, b, wall], [0.0, 100.0, 0.0, 100.0]);
        assert!(raster.covered(20.0, 20.0));
        assert!(raster.covered(29.0, 29.0));
        assert!(!raster.covered(65.0, 50.0));
        assert!(raster
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| *p == [0; 4] || *p == [FLOOR_HIGH[0], FLOOR_HIGH[1], FLOOR_HIGH[2], 255]));
    }

    /// The set pixels of a one-byte-per-pixel image, as text rows.
    fn rows(img: &[u8], w: usize) -> Vec<String> {
        img.chunks(w).map(|r| r.iter().map(|&b| if b > 0 { '#' } else { '.' }).collect()).collect()
    }

    #[test]
    fn fills_pixels_whose_centres_lie_inside() {
        let mut img = vec![0u8; 6 * 5];
        fill(&mut img, 6, 5, [(0.0, 0.0), (4.0, 0.0), (0.0, 4.0)], &[1]);
        assert_eq!(rows(&img, 6), ["####..", "###...", "##....", "#.....", "......"]);
    }

    #[test]
    fn fill_ignores_corner_order_and_clips_to_the_image() {
        let mut a = vec![0u8; 4 * 4];
        let mut b = vec![0u8; 4 * 4];
        fill(&mut a, 4, 4, [(-2.0, -1.0), (6.0, 1.0), (0.5, 6.0)], &[1]);
        fill(&mut b, 4, 4, [(0.5, 6.0), (-2.0, -1.0), (6.0, 1.0)], &[1]);
        assert_eq!(a, b);
        assert_eq!(rows(&a, 4), ["####", "####", "####", "###."]);
    }

    #[test]
    fn degenerate_triangles_draw_nothing() {
        let mut img = vec![0u8; 4 * 4];
        fill(&mut img, 4, 4, [(0.0, 1.0), (3.0, 1.0), (2.0, 1.0)], &[1]);
        fill(&mut img, 4, 4, [(0.2, 0.2), (0.4, 0.3), (0.3, 0.4)], &[1]);
        assert!(img.iter().all(|&b| b == 0));
    }

    #[test]
    fn lines_sample_both_ends_and_truncate() {
        let pts: Vec<_> = line_points((0.0, 0.0), (3.0, 1.5)).collect();
        assert_eq!(pts, [(0, 0), (0, 0), (1, 0), (2, 1), (3, 1)]);
        let mut img = vec![0u8; 3 * 2 * 4];
        line(&mut img, 3, 2, (-1.0, 0.5), (5.0, 0.5));
        assert_eq!(&img[..12], [WALL, WALL, WALL].concat());
        assert!(img[12..].iter().all(|&b| b == 0));
    }

    fn raster(width: usize, height: usize, alpha: &[u8]) -> Raster {
        let rgba = alpha.iter().flat_map(|&a| [a, a, a, a]).collect();
        Raster { width, height, pixels_per_unit: 2.0, rgba, min_x: -1.0, min_z: 10.0 }
    }

    #[test]
    fn trim_crops_to_drawn_pixels_plus_margin() {
        #[rustfmt::skip]
        let mut r = raster(6, 5, &[
            0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0,
            0, 0, 0, 9, 0, 0,
            0, 0, 9, 0, 0, 0,
            0, 0, 0, 0, 0, 0,
        ]);
        r.trim(0.5); // one pixel
        assert_eq!((r.width, r.height), (4, 4));
        assert_eq!((r.min_x, r.min_z), (-0.5, 10.5));
        let alpha: Vec<u8> = r.rgba.chunks(4).map(|p| p[3]).collect();
        assert_eq!(rows(&alpha, 4), ["....", "..#.", ".#..", "...."]);
        assert_eq!(r.fill(), 2.0 / 16.0);
    }

    #[test]
    fn trim_leaves_an_empty_raster_alone() {
        let mut r = raster(3, 2, &[0; 6]);
        r.trim(5.0);
        assert_eq!((r.width, r.height, r.min_x), (3, 2, -1.0));
    }

    #[test]
    fn clip_clears_pixels_outside_the_mask() {
        let mut r = raster(3, 1, &[7, 7, 7]);
        r.clip(&[1, 0, 1]);
        assert_eq!(r.rgba, [7, 7, 7, 7, 0, 0, 0, 0, 7, 7, 7, 7]);
        assert!(r.kept(&[1, 0, 1], -1.0, 10.0));
        assert!(!r.kept(&[1, 0, 1], -0.5, 10.0));
        // int() truncates toward zero, so a point just left of the image maps to column 0.
        assert!(r.covered(-1.2, 10.0));
        assert!(!r.covered(-1.6, 10.0));
    }

    #[test]
    fn floor_mask_widens_floors_and_skips_walls() {
        let like = Raster { width: 8, height: 8, pixels_per_unit: 1.0, rgba: vec![0; 256], min_x: 0.0, min_z: 0.0 };
        let floor = [[3.0, 0.0, 3.0], [5.0, 0.0, 3.0], [3.0, 0.0, 5.0]];
        let wall = [[0.0, 0.0, 0.0], [7.0, 0.0, 0.0], [0.0, 5.0, 0.0]];
        let mask = floor_mask(&[floor, wall], &like, 1.0);
        #[rustfmt::skip]
        assert_eq!(rows(&mask, 8), [
            "........", "........", "...###..", "..#####.", "..####..", "..###...", "...#....", "........",
        ]);
    }
}

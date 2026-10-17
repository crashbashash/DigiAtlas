//! Decode 8-bit indexed textures (igImage + igClut).
//!
//! The pixel block is `width * height` palette indices, bottom row first. The 256-colour palette
//! is 1024 bytes of RGBA (alpha 0-128, 128 opaque) in the PS2's CSM1 order, which swaps bits 3
//! and 4 of the index.

use crate::error::{Error, Result};
use crate::fail;
use crate::igb::Graph;

const IMAGE_W: usize = 0;
const IMAGE_H: usize = 1;
const IMAGE_PIXELS: usize = 11;
const IMAGE_CLUT: usize = 15;
const CLUT_COLORS: usize = 1;
const CLUT_DATA: usize = 3;
const PALETTE_BYTES: usize = 1024;

pub struct Texture {
    pub name: String,
    pub width: usize,
    pub height: usize,
    /// Top row first.
    pub rgba: Vec<u8>,
}

fn csm1(index: usize) -> usize {
    (index & !0x18) | ((index & 0x08) << 1) | ((index & 0x10) >> 1)
}

fn int(g: &Graph, k: usize, i: usize) -> Result<i64> {
    g.vals(k).get(i).and_then(|v| v.int()).ok_or_else(|| Error(format!("record {k} field {i} is not a number")))
}

pub fn decode(g: &Graph, image: usize, clut: usize) -> Result<Texture> {
    let (w, h) = (int(g, image, IMAGE_W)? as usize, int(g, image, IMAGE_H)? as usize);
    if int(g, clut, CLUT_COLORS)? != 256 {
        fail!("unsupported palette of {} colours", int(g, clut, CLUT_COLORS)?);
    }
    let pixels = g.block(int(g, image, IMAGE_PIXELS)? as usize, w * h)?;
    let palette = g.block(int(g, clut, CLUT_DATA)? as usize, PALETTE_BYTES)?;
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let src = (h - 1 - y) * w;
        for x in 0..w {
            let e = 4 * csm1(pixels[src + x] as usize);
            let o = (y * w + x) * 4;
            out[o..o + 3].copy_from_slice(&palette[e..e + 3]);
            out[o + 3] = (palette[e + 3] as u16 * 2).min(255) as u8;
        }
    }
    Ok(Texture { name: g.s2[image].name.clone().unwrap_or_default(), width: w, height: h, rgba: out })
}

/// Record index of the palette an image points at.
pub fn clut_of(g: &Graph, image: usize) -> Result<usize> {
    match g.vals(image).get(IMAGE_CLUT).and_then(|v| g.r#ref(v)) {
        Some(k) if g.class(k) == "igClut" => Ok(k),
        _ => fail!("image record {image} has no resolvable palette"),
    }
}

/// Every igImage in the pack, each decoded with the palette it references.
pub fn decode_all(g: &Graph) -> Result<Vec<Texture>> {
    (0..g.s2.len()).filter(|&k| g.class(k) == "igImage").map(|k| decode(g, k, clut_of(g, k)?)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swaps_palette_index_bits_three_and_four() {
        assert_eq!(csm1(0x08), 0x10);
        assert_eq!(csm1(0x10), 0x08);
        assert_eq!(csm1(0x20), 0x20);
    }

    #[test]
    fn writes_a_png_header() {
        let data = crate::png::encode_rgba(1, 1, &[1, 2, 3, 4]).unwrap();
        assert_eq!(&data[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&data[16..24], &[0, 0, 0, 1, 0, 0, 0, 1]);
        assert!(crate::png::encode_rgba(2, 2, &[0; 4]).is_err());
    }
}

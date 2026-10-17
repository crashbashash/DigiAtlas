//! Minimal PNG writer (RGBA, 8-bit).

use std::io::Write;

use flate2::write::ZlibEncoder;
use flate2::Compression;

use crate::error::Result;
use crate::fail;

fn chunk(out: &mut Vec<u8>, tag: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(body);
    let mut crc = crc32fast::Hasher::new();
    crc.update(tag);
    crc.update(body);
    out.extend_from_slice(&crc.finalize().to_be_bytes());
}

pub fn encode_rgba(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>> {
    if rgba.len() != width * height * 4 {
        fail!("pixel buffer does not match {width} x {height}");
    }
    let mut raw = Vec::with_capacity(height * (width * 4 + 1));
    for y in 0..height {
        raw.push(0);
        raw.extend_from_slice(&rgba[y * width * 4..(y + 1) * width * 4]);
    }
    let mut z = ZlibEncoder::new(Vec::new(), Compression::new(6));
    z.write_all(&raw)?;
    let idat = z.finish()?;
    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&(width as u32).to_be_bytes());
    header.extend_from_slice(&(height as u32).to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    chunk(&mut out, b"IHDR", &header);
    chunk(&mut out, b"IDAT", &idat);
    chunk(&mut out, b"IEND", &[]);
    Ok(out)
}

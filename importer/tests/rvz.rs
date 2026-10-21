//! Synthetic RVZ images: no game bytes, including the final short-sector case
//! produced by extended mod images. Exercise the same reader the desktop uses.
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use importer::iso::Source;

const SECTOR: usize = 0x8000;
static SERIAL: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn be32(b: &mut [u8], at: usize, value: usize) {
    b[at..at + 4].copy_from_slice(&(value as u32).to_be_bytes());
}
fn be64(b: &mut [u8], at: usize, value: usize) {
    b[at..at + 8].copy_from_slice(&(value as u64).to_be_bytes());
}
fn hash(b: &[u8]) -> [u8; 20] {
    sha1_smol::Sha1::from(b).digest().bytes()
}
fn encode(b: &[u8], compressed: bool) -> Vec<u8> {
    if compressed {
        zstd::stream::encode_all(b, 1).unwrap()
    } else {
        b.to_vec()
    }
}
fn image(tail: usize, compressed: bool, short_data: bool, interior_end: bool) -> (Fixture, Vec<u8>) {
    let logical_size = 2 * SECTOR + tail;
    let raw: Vec<u8> = (0..logical_size).map(|n| (n.wrapping_mul(73) ^ (n >> 8)) as u8).collect();
    let count = logical_size.div_ceil(SECTOR);
    let mut table = vec![0; 24];
    be64(&mut table, 0, 0x80);
    be64(&mut table, 8, logical_size - 0x80 - usize::from(interior_end));
    be32(&mut table, 20, count);
    let table = encode(&table, compressed);
    let raw_offset = 0x48 + 0xdc;
    let groups_offset = (raw_offset + table.len() + 3) & !3;
    // Compressed group metadata needs the payload offsets first. Reserve enough
    // room for its worst-case zstd encoding and then fill it into that space.
    let payload_offset = (groups_offset + count * 12 + 128 + 3) & !3;
    let mut out = vec![0; payload_offset];
    out[raw_offset..raw_offset + table.len()].copy_from_slice(&table);
    let mut groups = vec![0; count * 12];
    for (i, data) in raw.chunks(SECTOR).enumerate() {
        let data = if short_data && i + 1 == count { &data[..data.len() - 1] } else { data };
        let data = encode(data, compressed);
        be32(&mut groups, i * 12, out.len() / 4);
        be32(&mut groups, i * 12 + 4, data.len() | if compressed { 1 << 31 } else { 0 });
        out.extend_from_slice(&data);
        out.resize((out.len() + 3) & !3, 0);
    }
    let groups = encode(&groups, compressed);
    assert!(groups_offset + groups.len() <= payload_offset);
    out[groups_offset..groups_offset + groups.len()].copy_from_slice(&groups);
    let mut disc = vec![0; 0xdc];
    be32(&mut disc, 0, 1); // GameCube
    be32(&mut disc, 4, if compressed { 5 } else { 0 });
    be32(&mut disc, 12, SECTOR);
    disc[16..16 + 0x80].copy_from_slice(&raw[..0x80]);
    be32(&mut disc, 148, 0x30); // partition descriptor size, zero partitions
    disc[160..180].copy_from_slice(&hash(&[]));
    be32(&mut disc, 180, 1);
    be64(&mut disc, 184, raw_offset);
    be32(&mut disc, 192, table.len());
    be32(&mut disc, 196, count);
    be64(&mut disc, 200, groups_offset);
    be32(&mut disc, 208, groups.len());
    out[0x48..0x48 + disc.len()].copy_from_slice(&disc);
    out[..4].copy_from_slice(b"RVZ\x01");
    be32(&mut out, 4, 0x01000000);
    be32(&mut out, 8, 0x00030000);
    be32(&mut out, 12, disc.len());
    out[16..36].copy_from_slice(&hash(&disc));
    be64(&mut out, 36, logical_size);
    let file_size = out.len();
    be64(&mut out, 44, file_size);
    let checksum = hash(&out[..52]);
    out[52..72].copy_from_slice(&checksum);
    let path = std::env::temp_dir().join(format!(
        "digiatlas-rvz-{}-{}.rvz",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&path, out).unwrap();
    (Fixture(path), raw)
}

#[test]
fn rvz_reads_compressed_and_plain_partial_final_sectors_without_changing_logical_size() {
    for compressed in [false, true] {
        for tail in [0x800, 0x1800, SECTOR - 1, SECTOR] {
            let (file, expected) = image(tail, compressed, false, false);
            let source = Source::open(&file.0).unwrap();
            assert_eq!(source.size(), expected.len() as u64);
            assert_eq!(source.read_all().unwrap(), expected);
            // Seek backwards after a complete read, cross the boundary, and
            // address a footer within the partial final processing sector.
            assert_eq!(source.read((2 * SECTOR - 17) as u64, 33).unwrap(), expected[2 * SECTOR - 17..2 * SECTOR + 16]);
            assert_eq!(
                source.slice(expected.len() as u64 - 512, 512).read_all().unwrap(),
                expected[expected.len() - 512..]
            );
            assert_eq!(source.read(0, 128).unwrap(), expected[..128]);
            assert!(source.read(expected.len() as u64, 1).is_err());
        }
    }
}

#[test]
fn rvz_rejects_an_unaligned_interior_end_instead_of_treating_it_as_eof_padding() {
    for compressed in [false, true] {
        let (file, _) = image(0x1800, compressed, false, true);
        let error = match Source::open(&file.0) {
            Ok(_) => panic!("interior range accepted"),
            Err(e) => e,
        };
        assert!(error.to_string().contains("not aligned"), "{error}");
    }
}

#[test]
fn rvz_short_decoded_final_data_is_an_error_not_fabricated_disc_bytes() {
    for compressed in [false, true] {
        let (file, expected) = image(0x1800, compressed, true, false);
        let source = Source::open(&file.0).unwrap();
        assert_eq!(source.read(0, 128).unwrap(), expected[..128]);
        let error = source.read(expected.len() as u64 - 32, 32).unwrap_err();
        assert!(error.to_string().contains("truncated"), "{error}");
    }
}

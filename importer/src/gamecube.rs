//! Read the GameCube FST and boot DOL without extracting the entire disc.
use std::collections::HashMap;

use crate::{
    fail,
    iso::{IsoFile, Source},
    Error, Result,
};

pub fn is_gamecube(disc: &Source) -> Result<bool> {
    Ok(disc.size() >= 0x430 && disc.read(0x1c, 4)? == [0xc2, 0x33, 0x9f, 0x3d])
}

fn word(bytes: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or_else(|| Error("the GameCube filesystem is truncated".into()))?
            .try_into()
            .unwrap(),
    ))
}

pub fn list_files(disc: &Source) -> Result<HashMap<String, IsoFile>> {
    if !is_gamecube(disc)? {
        fail!("not a GameCube disc");
    }
    let header = disc.read(0, 0x430)?;
    let fst_offset = word(&header, 0x424)? as u64;
    let fst_size = word(&header, 0x428)? as u64;
    if fst_size > 32 << 20 {
        fail!("invalid GameCube filesystem size");
    }
    let fst = disc.read(fst_offset, fst_size)?;
    let count = word(&fst, 8)? as usize;
    let names = count
        .checked_mul(12)
        .filter(|n| *n <= fst.len())
        .ok_or_else(|| Error("invalid GameCube filesystem count".into()))?;
    if count == 0 || fst.first() != Some(&1) {
        fail!("invalid GameCube root directory");
    }
    let mut directories = vec![(count, String::new())];
    let mut files = HashMap::new();
    for index in 1..count {
        while directories.last().is_some_and(|(end, _)| index >= *end) {
            directories.pop();
        }
        let parent = &directories.last().ok_or_else(|| Error("invalid GameCube directory range".into()))?.1;
        let at = index * 12;
        let tag = word(&fst, at)?;
        let name_at = names
            .checked_add((tag & 0xffffff) as usize)
            .filter(|n| *n < fst.len())
            .ok_or_else(|| Error("invalid GameCube filename offset".into()))?;
        let name_bytes = &fst[name_at..];
        let end =
            name_bytes.iter().position(|b| *b == 0).ok_or_else(|| Error("unterminated GameCube filename".into()))?;
        let name = std::str::from_utf8(&name_bytes[..end]).map_err(|_| Error("invalid GameCube filename".into()))?;
        if name.is_empty() || name.contains('/') || name == ".." {
            fail!("invalid GameCube filename");
        }
        let path = format!("{parent}/{name}");
        if tag >> 24 == 1 {
            let end = word(&fst, at + 8)? as usize;
            if end <= index || end > directories.last().unwrap().0 {
                fail!("invalid GameCube subdirectory");
            }
            directories.push((end, path));
        } else if tag >> 24 == 0 {
            let offset = word(&fst, at + 4)? as u64;
            let size = word(&fst, at + 8)? as u64;
            if offset.checked_add(size).is_none_or(|end| end > disc.size()) {
                fail!("GameCube file lies outside the disc");
            }
            files.insert(path.to_uppercase(), IsoFile { path, offset, size });
        } else {
            fail!("invalid GameCube filesystem entry type");
        }
    }
    // The DOL is referenced by boot.bin rather than an FST entry.
    let offset = word(&header, 0x420)? as u64;
    let dol = disc.read(offset, 0x100)?;
    let mut size = 0x100u64;
    for index in 0..18 {
        let start = word(&dol, index * 4)? as u64;
        let length = word(&dol, 0x90 + index * 4)? as u64;
        size = size.max(start + length);
    }
    if offset.checked_add(size).is_none_or(|end| end > disc.size()) {
        fail!("GameCube executable lies outside the disc");
    }
    files.insert("/MAIN.DOL".into(), IsoFile { path: "/main.dol".into(), offset, size });
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::iso::tests::TempFile;

    fn fixture() -> Vec<u8> {
        let mut image = vec![0u8; 0x2000];
        image[..6].copy_from_slice(b"GDJEB2");
        image[0x1c..0x20].copy_from_slice(&[0xc2, 0x33, 0x9f, 0x3d]);
        let put = |b: &mut [u8], at: usize, n: u32| b[at..at + 4].copy_from_slice(&n.to_be_bytes());
        put(&mut image, 0x420, 0x600);
        put(&mut image, 0x424, 0x800);
        put(&mut image, 0x428, 48 + 26);
        let fst = &mut image[0x800..];
        put(fst, 0, 0x01000000);
        put(fst, 8, 4);
        put(fst, 12, 0x01000001);
        put(fst, 20, 3);
        put(fst, 24, 8);
        put(fst, 28, 0x1000);
        put(fst, 32, 3);
        put(fst, 36, 17);
        put(fst, 40, 0x1100);
        put(fst, 44, 4);
        fst[48..48 + 26].copy_from_slice(b"\0folder\0area.afs\0ndmw.igb\0");
        image
    }

    #[test]
    fn follows_fst_directories_and_exposes_the_boot_dol() {
        let file = TempFile::new("gc-fst.gcm", &fixture());
        let disc = Source::open(&file.0).unwrap();
        let files = list_files(&disc).unwrap();
        assert_eq!(files["/FOLDER/AREA.AFS"].offset, 0x1000);
        assert_eq!(files["/NDMW.IGB"].size, 4);
        assert_eq!(files["/MAIN.DOL"].offset, 0x600);
        assert_eq!(files["/MAIN.DOL"].size, 0x100);
    }

    #[test]
    fn rejects_invalid_name_offsets_and_out_of_bounds_file_ranges() {
        for (name, offset, value) in [("name", 0x800 + 24, 0x00ffffffu32), ("size", 0x800 + 44, u32::MAX)] {
            let mut image = fixture();
            image[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
            let file = TempFile::new(&format!("gc-bad-{name}.gcm"), &image);
            assert!(list_files(&Source::open(&file.0).unwrap()).is_err());
        }
    }
}

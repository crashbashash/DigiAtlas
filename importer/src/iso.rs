//! Minimal ISO9660 reader: locate files on the disc and read them as random-access sources.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use crate::error::{Error, Result};
use crate::fail;

pub const SECTOR: u64 = 2048;

trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

#[derive(Debug, Clone, PartialEq)]
pub struct IsoFile {
    pub path: String,
    pub offset: u64,
    pub size: u64,
}

/// A byte range of a file (a disc image, or one file on it) read on demand.
#[derive(Clone)]
pub struct Source {
    file: Rc<RefCell<Box<dyn ReadSeek>>>,
    path: PathBuf,
    offset: u64,
    size: u64,
}

impl Source {
    pub fn open(path: &Path) -> Result<Source> {
        let mut file = File::open(path).map_err(|e| Error(format!("{}: {e}", path.display())))?;
        let mut magic = [0u8; 4];
        let _ = file.read(&mut magic)?;
        file.rewind()?;
        let (reader, size): (Box<dyn ReadSeek>, u64) =
            if matches!(&magic, b"RVZ\x01" | b"WIA\x01" | b"CISO" | b"\x01\xc0\x0b\xb1") {
                let disc =
                    nod::Disc::new(path).map_err(|e| Error(format!("could not read compressed GameCube disc: {e}")))?;
                let size = disc.disc_size();
                (Box::new(disc), size)
            } else {
                let size = file.metadata()?.len();
                (Box::new(file), size)
            };
        Ok(Source { file: Rc::new(RefCell::new(reader)), path: path.to_owned(), offset: 0, size })
    }

    /// A sub-range of this source.
    pub fn slice(&self, offset: u64, size: u64) -> Source {
        Source { file: self.file.clone(), path: self.path.clone(), offset: self.offset + offset, size }
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn read(&self, pos: u64, length: u64) -> Result<Vec<u8>> {
        if pos.checked_add(length).is_none_or(|end| end > self.size) {
            fail!("read {pos}+{length} outside {} (size {})", self.path.display(), self.size);
        }
        let mut file = self.file.borrow_mut();
        file.seek(SeekFrom::Start(self.offset + pos))?;
        let mut out = vec![0u8; length as usize];
        file.read_exact(&mut out)?;
        Ok(out)
    }

    pub fn read_all(&self) -> Result<Vec<u8>> {
        self.read(0, self.size)
    }
}

fn u32le(b: &[u8], at: usize) -> u64 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as u64
}

fn walk(src: &Source, extent: u64, size: u64, prefix: &str, out: &mut HashMap<String, IsoFile>) -> Result<()> {
    let data = src.read(extent * SECTOR, size.min(src.size().saturating_sub(extent * SECTOR)))?;
    let mut pos = 0usize;
    while pos < data.len() {
        let n = data[pos] as usize;
        if n == 0 {
            // records never straddle sectors
            pos = (pos / SECTOR as usize + 1) * SECTOR as usize;
            continue;
        }
        if pos + n > data.len() || n < 34 {
            break;
        }
        let rec = &data[pos..pos + n];
        pos += n;
        let (loc, sz, flags) = (u32le(rec, 2), u32le(rec, 10), rec[25]);
        let name_len = rec[32] as usize;
        let name = &rec[33..(33 + name_len).min(rec.len())];
        if name == b"\x00" || name == b"\x01" {
            continue;
        }
        let name: String = name.iter().map(|&c| c as char).collect::<String>();
        let name = name.split(';').next().unwrap_or("").to_string();
        let path = format!("{prefix}/{name}");
        if flags & 2 != 0 {
            walk(src, loc, sz, &path, out)?;
        } else {
            out.insert(path.to_uppercase(), IsoFile { path, offset: loc * SECTOR, size: sz });
        }
    }
    Ok(())
}

/// Map upper-cased `/NAME` paths to their disc location.
pub fn list_files(disc: &Source) -> Result<HashMap<String, IsoFile>> {
    let pvd = disc.read(16 * SECTOR, SECTOR)?;
    if &pvd[1..6] != b"CD001" {
        fail!("this is not a disc image (no ISO9660 volume descriptor)");
    }
    let root = &pvd[156..190];
    let mut out = HashMap::new();
    walk(disc, u32le(root, 2), u32le(root, 10), "", &mut out)?;
    Ok(out)
}

/// One file on the disc as a source.
pub fn open_disc_file(disc: &Source, files: &HashMap<String, IsoFile>, name: &str) -> Result<Source> {
    match files.get(&format!("/{}", name.to_uppercase())) {
        Some(f) => Ok(disc.slice(f.offset, f.size)),
        None => fail!("{name} is not on this disc"),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A minimal ISO9660 image: one root directory holding `files`.
    pub fn build_iso(files: &[(&str, &[u8])]) -> Vec<u8> {
        fn dir_record(name: &[u8], extent: u32, size: u32, flags: u8) -> Vec<u8> {
            let mut len = 33 + name.len();
            len += len % 2; // records are even length
            let mut rec = vec![0u8; len];
            rec[0] = len as u8;
            rec[2..6].copy_from_slice(&extent.to_le_bytes());
            rec[10..14].copy_from_slice(&size.to_le_bytes());
            rec[25] = flags;
            rec[32] = name.len() as u8;
            rec[33..33 + name.len()].copy_from_slice(name);
            rec
        }
        let (root_extent, mut extent) = (18u32, 19u32);
        let mut entries = Vec::new();
        let mut blobs = Vec::new();
        for (name, data) in files {
            entries.extend(dir_record(format!("{name};1").as_bytes(), extent, data.len() as u32, 0));
            blobs.push((extent, *data));
            extent += (data.len() as u32).div_ceil(SECTOR as u32);
        }
        let mut root = dir_record(b"\0", root_extent, SECTOR as u32, 2);
        root.extend(dir_record(b"\x01", root_extent, SECTOR as u32, 2));
        root.extend(entries);
        let mut image = vec![0u8; extent as usize * SECTOR as usize];
        let pvd = &mut image[16 * SECTOR as usize..17 * SECTOR as usize];
        pvd[0] = 1;
        pvd[1..6].copy_from_slice(b"CD001");
        pvd[156..190].copy_from_slice(&dir_record(b"\0", root_extent, SECTOR as u32, 2)[..34]);
        let at = root_extent as usize * SECTOR as usize;
        image[at..at + root.len()].copy_from_slice(&root);
        for (ext, data) in blobs {
            let at = ext as usize * SECTOR as usize;
            image[at..at + data.len()].copy_from_slice(data);
        }
        image
    }

    pub fn build_afs(entries: &[&[u8]]) -> Vec<u8> {
        let table_end = 8 + 8 * entries.len();
        let offset = (table_end + 0x7FF) & !0x7FF;
        let mut head = b"AFS\0".to_vec();
        head.extend((entries.len() as u32).to_le_bytes());
        let mut body = Vec::new();
        for data in entries {
            head.extend(((offset + body.len()) as u32).to_le_bytes());
            head.extend((data.len() as u32).to_le_bytes());
            body.extend_from_slice(data);
            body.resize((body.len() + 0x7FF) & !0x7FF, 0);
        }
        head.resize(offset, 0);
        head.extend(body);
        head
    }

    /// A file in the temp directory that is removed when dropped.
    pub struct TempFile(pub PathBuf);
    impl TempFile {
        pub fn new(name: &str, data: &[u8]) -> TempFile {
            let path = std::env::temp_dir().join(format!("digiatlas-test-{}-{name}", std::process::id()));
            std::fs::write(&path, data).unwrap();
            TempFile(path)
        }
    }
    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn finds_files_and_reads_afs_entries() {
        let afs = build_afs(&[b"first", b"second entry"]);
        let image = build_iso(&[("SYSTEM.CNF", b"BOOT2 = cdrom0:\\SLUS_208.36;1\n"), ("AREA.AFS", &afs)]);
        let file = TempFile::new("disc.iso", &image);
        let disc = Source::open(&file.0).unwrap();
        let files = list_files(&disc).unwrap();
        let mut names: Vec<&String> = files.keys().collect();
        names.sort();
        assert_eq!(names, ["/AREA.AFS", "/SYSTEM.CNF"]);
        let archive = crate::afs::Afs::open(open_disc_file(&disc, &files, "area.afs").unwrap()).unwrap();
        assert_eq!(archive.count(), 2);
        assert_eq!(archive.entry(0).unwrap(), b"first");
        assert_eq!(archive.entry(1).unwrap(), b"second entry");
    }

    #[test]
    fn rejects_a_file_that_is_not_a_disc_image() {
        let file = TempFile::new("x.iso", &vec![0u8; 20 * SECTOR as usize]);
        assert!(list_files(&Source::open(&file.0).unwrap()).is_err());
    }
}

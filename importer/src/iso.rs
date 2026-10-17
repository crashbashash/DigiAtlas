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

#[derive(Debug, Clone, PartialEq)]
pub struct IsoFile {
    pub path: String,
    pub offset: u64,
    pub size: u64,
}

/// A byte range of a file (a disc image, or one file on it) read on demand.
#[derive(Clone)]
pub struct Source {
    file: Rc<RefCell<File>>,
    path: PathBuf,
    offset: u64,
    size: u64,
}

impl Source {
    pub fn open(path: &Path) -> Result<Source> {
        let file = File::open(path).map_err(|e| Error(format!("{}: {e}", path.display())))?;
        let size = file.metadata()?.len();
        Ok(Source { file: Rc::new(RefCell::new(file)), path: path.to_owned(), offset: 0, size })
    }

    /// A sub-range of this source.
    pub fn slice(&self, offset: u64, size: u64) -> Source {
        Source { file: self.file.clone(), path: self.path.clone(), offset: self.offset + offset, size }
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn read(&self, pos: u64, length: u64) -> Result<Vec<u8>> {
        if pos + length > self.size {
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

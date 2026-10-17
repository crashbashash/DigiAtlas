//! CRI AFS archive reader (entries addressed by index).

use crate::error::Result;
use crate::fail;
use crate::iso::Source;

pub struct Afs {
    source: Source,
    pub entries: Vec<(u64, u64)>,
}

impl Afs {
    pub fn open(source: Source) -> Result<Afs> {
        let head = source.read(0, 8)?;
        if &head[..3] != b"AFS" {
            fail!("not an AFS archive");
        }
        let count = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
        let table = source.read(8, count as u64 * 8)?;
        let entries = (0..count)
            .map(|i| {
                let at = 8 * i;
                (
                    u32::from_le_bytes(table[at..at + 4].try_into().unwrap()) as u64,
                    u32::from_le_bytes(table[at + 4..at + 8].try_into().unwrap()) as u64,
                )
            })
            .collect();
        Ok(Afs { source, entries })
    }

    pub fn count(&self) -> usize {
        self.entries.len()
    }

    pub fn entry(&self, index: usize) -> Result<Vec<u8>> {
        let (offset, size) = self.entries[index];
        self.source.read(offset, size)
    }
}

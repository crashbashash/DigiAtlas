//! Enemy stat table: the `enemy` database (649 rows) of the game's data pack.

use crate::database::{Cell, Row};
use crate::error::{Error, Result};

/// (row, hp) pairs from the unmodified USA disc; used to detect modified or foreign discs.
const ANCHORS: [(usize, i64); 4] = [(1, 58), (5, 649), (60, 3194), (370, 100)];

pub const RESISTS: [(&str, &str); 6] = [
    ("RES_FIRE", "fire"),
    ("RES_ICE", "ice"),
    ("RES_THUNDER", "thunder"),
    ("RES_DARK", "dark"),
    ("RES_STUN", "stun"),
    ("RES_POISON", "poison"),
];

pub struct EnemyRow {
    pub row: usize,
    pub hp: i64,
    pub strength: i64,
    pub defense: i64,
    pub wisdom: i64,
    pub spirit: i64,
    pub speed: i64,
    pub exp: i64,
    pub resist: Vec<(&'static str, i64)>,
    pub crit_rate: i64,
    pub paralysis_rate: i64,
    pub rarity: i64,
}

impl EnemyRow {
    pub fn is_empty(&self) -> bool {
        self.hp == 0
    }
}

fn int(r: &Row, col: &str) -> Result<i64> {
    r.get(col).and_then(Cell::int).ok_or_else(|| Error(format!("enemy column {col} missing")))
}

pub fn from_database(rows: &[Row]) -> Result<Vec<EnemyRow>> {
    rows.iter()
        .enumerate()
        .map(|(i, r)| {
            Ok(EnemyRow {
                row: i,
                hp: int(r, "HPMAX")?,
                strength: int(r, "TSUYOSA")?,
                defense: int(r, "MAMORI")?,
                wisdom: int(r, "KASHIKOSA")?,
                spirit: int(r, "SEISHIN")?,
                speed: int(r, "SUBAYASA")?,
                exp: int(r, "EXP")?,
                resist: RESISTS.iter().map(|(col, name)| Ok((*name, int(r, col)?))).collect::<Result<_>>()?,
                crit_rate: int(r, "CHIMEIRITSU")?,
                paralysis_rate: int(r, "MAHIRITSU")?,
                rarity: int(r, "RARITY")?,
            })
        })
        .collect()
}

pub fn anchors_match(rows: &[EnemyRow]) -> bool {
    ANCHORS.iter().all(|&(r, hp)| r < rows.len() && rows[r].hp == hp)
}

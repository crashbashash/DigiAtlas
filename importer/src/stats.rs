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

#[cfg(test)]
mod tests {
    use super::*;

    fn row(hp: i64) -> Row {
        let mut r: Row = [
            ("TSUYOSA", 1),
            ("MAMORI", 2),
            ("KASHIKOSA", 3),
            ("SEISHIN", 4),
            ("SUBAYASA", 5),
            ("EXP", 6),
            ("RES_FIRE", 7),
            ("RES_ICE", 8),
            ("RES_THUNDER", 9),
            ("RES_DARK", 10),
            ("RES_STUN", 11),
            ("RES_POISON", 12),
            ("CHIMEIRITSU", 13),
            ("MAHIRITSU", 14),
            ("RARITY", 0),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), Cell::Int(v)))
        .collect();
        r.insert("HPMAX".into(), Cell::Int(hp));
        r
    }

    #[test]
    fn reads_rows_from_the_database() {
        let rows = from_database(&[row(0), row(58)]).unwrap();
        let r = &rows[1];
        assert_eq!((r.row, r.hp, r.strength, r.defense, r.exp), (1, 58, 1, 2, 6));
        assert_eq!(r.resist, vec![("fire", 7), ("ice", 8), ("thunder", 9), ("dark", 10), ("stun", 11), ("poison", 12)]);
        assert_eq!((r.crit_rate, r.paralysis_rate), (13, 14));
        assert!(rows[0].is_empty());
    }

    #[test]
    fn checks_the_anchor_rows() {
        let mut rows: Vec<Row> = (0..400).map(|_| row(0)).collect();
        for (r, hp) in ANCHORS {
            rows[r] = row(hp);
        }
        assert!(anchors_match(&from_database(&rows).unwrap()));
        assert!(!anchors_match(&from_database(&rows[..10]).unwrap()));
        rows[1] = row(59);
        assert!(!anchors_match(&from_database(&rows).unwrap()));
    }
}

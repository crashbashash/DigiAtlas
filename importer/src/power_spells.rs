//! Player-cast Power Up/Down base durations from the retail pcTech table.
use serde_json::{json, Value};

use crate::database::{Cell, Tables};
use crate::{Error, Result};

pub fn extract(tables: &Tables) -> Result<Value> {
    let rows = tables.get("pcTech").ok_or_else(|| Error("database 'pcTech' missing".into()))?;
    let mut spells = Vec::new();
    for (kind, base) in [("up", 80), ("down", 85)] {
        for (tier, grade) in ["Petty", "Mega", "Giga", "Terra", "Infinity"].iter().enumerate() {
            let row = base + tier;
            let frames = rows
                .get(row)
                .and_then(|r| r.get("TIME"))
                .and_then(Cell::int)
                .filter(|v| *v > 0)
                .ok_or_else(|| Error(format!("pcTech row {row}: missing or invalid TIME")))?;
            spells.push(json!({"kind": kind, "grade": grade, "row": row, "baseFrames": frames}));
        }
    }
    Ok(Value::Array(spells))
}

pub fn save_stats(tables: &Tables) -> Result<Value> {
    let rows = tables.get("shinka").ok_or_else(|| Error("database 'shinka' missing".into()))?;
    let mut forms = Vec::new();
    for (species, row) in rows.iter().take(16).enumerate() {
        let number = |key: &str| {
            row.get(key).and_then(Cell::int).ok_or_else(|| Error(format!("shinka row {species}: missing {key}")))
        };
        let name = row.get("NAME").and_then(Cell::str).unwrap_or("");
        let model = row.get("MODEL_NAME").and_then(Cell::str).unwrap_or("");
        forms.push(json!({"species": species, "name": name, "model": model,
            "wisdomInitial": number("INT_INI")?, "wisdomGrowth": number("INT_GROW")?,
            "strengthInitial": number("STR_INI")?, "strengthGrowth": number("STR_GROW")?,
            "speedInitial": number("DEX_INI")?, "speedGrowth": number("DEX_GROW")?}));
    }
    if forms.len() != 16 {
        return Err(Error("shinka: expected sixteen species".into()));
    }
    let wisdom_boards: Vec<usize> = tables
        .get("armor2")
        .into_iter()
        .flatten()
        .enumerate()
        .filter(|(_, r)| r.get("SHUSEINOURYOKU").and_then(Cell::str) == Some("KASHIKOSA"))
        .map(|(id, _)| id)
        .collect();
    let strength_boards: Vec<usize> = tables
        .get("armor2")
        .into_iter()
        .flatten()
        .enumerate()
        .filter(|(_, r)| r.get("SHUSEINOURYOKU").and_then(Cell::str) == Some("TSUYOSA"))
        .map(|(id, _)| id)
        .collect();
    let speed_boards: Vec<usize> = tables
        .get("armor2")
        .into_iter()
        .flatten()
        .enumerate()
        .filter(|(_, r)| r.get("SHUSEINOURYOKU").and_then(Cell::str) == Some("SUBAYASA"))
        .map(|(id, _)| id)
        .collect();
    Ok(
        json!({"forms": forms, "wisdomBoards": wisdom_boards, "strengthBoards": strength_boards, "speedBoards": speed_boards}),
    )
}

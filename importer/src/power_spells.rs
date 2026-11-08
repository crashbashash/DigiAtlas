//! Power Up/Down durations and per-form character growth from the loaded disc.
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
            "hpInitial": number("MHP_INI")?, "hpGrowth": number("MHP_GROW")?,
            "mpInitial": number("MMP_INI")?, "mpGrowth": number("MMP_GROW")?,
            "defenseInitial": number("AC_INI")?, "defenseGrowth": number("AC_GROW")?,
            "spiritInitial": number("MND_INI")?, "spiritGrowth": number("MND_GROW")?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Row;

    fn tables() -> Tables {
        let rows = (0..16)
            .map(|species| {
                let mut row = Row::new();
                for (index, prefix) in ["MHP", "MMP", "STR", "AC", "INT", "MND", "DEX"].iter().enumerate() {
                    row.insert(format!("{prefix}_INI"), Cell::Int(species * 100 + index as i64));
                    row.insert(format!("{prefix}_GROW"), Cell::Int(10 + index as i64));
                }
                row
            })
            .collect();
        Tables::from([("shinka".into(), rows)])
    }

    #[test]
    fn exports_all_seven_growth_parameters_for_each_form() {
        let data = save_stats(&tables()).unwrap();
        for species in 0..16 {
            for (index, stat) in ["hp", "mp", "strength", "defense", "wisdom", "spirit", "speed"].iter().enumerate() {
                assert_eq!(data["forms"][species][format!("{stat}Initial")], species * 100 + index);
                assert_eq!(data["forms"][species][format!("{stat}Growth")], 10 + index);
            }
        }
    }

    #[test]
    fn rejects_incomplete_growth_data() {
        let mut data = tables();
        data.get_mut("shinka").unwrap()[3].remove("MHP_GROW");
        assert!(save_stats(&data).unwrap_err().to_string().contains("shinka row 3: missing MHP_GROW"));
        data.get_mut("shinka").unwrap().truncate(15);
        // Restore the field so the row-count check is reached.
        data.get_mut("shinka").unwrap()[3].insert("MHP_GROW".into(), Cell::Int(10));
        assert!(save_stats(&data).unwrap_err().to_string().contains("expected sixteen species"));
    }
}

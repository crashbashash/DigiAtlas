//! The reviewed MP Tech families, read from the loaded disc's pcTech database.
use serde_json::{json, Value};

use crate::database::{Cell, Tables};
use crate::{Error, Result};

pub const FAMILIES: [(&str, usize, i64, &str); 20] = [
    ("fire", 0, 6, "fire"),
    ("ice", 5, 6, "ice"),
    ("bolt", 10, 6, "thunder"),
    ("dark", 15, 6, "dark"),
    ("venom", 20, 6, "poison"),
    ("impact", 25, 6, "none"),
    ("cutter", 30, 6, "none"),
    ("bomb", 35, 6, "fire"),
    ("heal-light", 40, 7, "none"),
    ("heal-aura", 45, 7, "none"),
    ("raise", 50, 7, "none"),
    ("cure-light", 55, 7, "none"),
    ("cure-aura", 60, 7, "none"),
    ("speed", 65, 8, "none"),
    ("freeze", 70, 8, "none"),
    ("resist", 75, 8, "none"),
    ("power-up", 80, 8, "none"),
    ("power-down", 85, 8, "none"),
    ("sleep", 90, 8, "none"),
    ("bind", 95, 8, "none"),
];

/// The EXP recovery array identifies the adjacent Raise HP array in each executable.
/// PS2 aligns these arrays to 16 bytes; the GameCube DOL packs them at 4-byte alignment.
fn raise_parameters(executable: &[u8], gamecube: bool) -> Result<Vec<(i32, i32)>> {
    let pattern: Vec<u8> = [59_i32, 68, 77, 86, 95]
        .into_iter()
        .flat_map(|n| if gamecube { n.to_be_bytes() } else { n.to_le_bytes() })
        .collect();
    let matches: Vec<_> = executable
        .windows(pattern.len())
        .enumerate()
        .filter(|(i, b)| i % 4 == 0 && *b == pattern)
        .map(|(i, _)| i)
        .collect();
    if matches.len() != 1 {
        return Err(Error("could not identify the executable's Raise recovery tables".into()));
    }
    let start = matches[0];
    let hp_start = start + if gamecube { 20 } else { 32 };
    let read = |at: usize| -> Result<i32> {
        let bytes: [u8; 4] = executable
            .get(at..at + 4)
            .ok_or_else(|| Error("truncated Raise recovery table".into()))?
            .try_into()
            .unwrap();
        Ok(if gamecube { i32::from_be_bytes(bytes) } else { i32::from_le_bytes(bytes) })
    };
    (0..5)
        .map(|tier| {
            let hp = read(hp_start + tier * 4)?;
            if !(1..=99999).contains(&hp) {
                return Err(Error("invalid Raise HP amount".into()));
            }
            Ok((read(start + tier * 4)?, hp))
        })
        .collect()
}

pub fn extract(tables: &Tables, executable: &[u8], gamecube: bool) -> Result<Value> {
    let rows = tables.get("pcTech").ok_or_else(|| Error("database 'pcTech' missing".into()))?;
    let revive = raise_parameters(executable, gamecube)?;
    let mut techs = Vec::new();
    for (kind, base, skill, element) in FAMILIES {
        for (tier, grade) in ["Petty", "Mega", "Giga", "Terra", "Infinity"].iter().enumerate() {
            let row = base + tier;
            let record = rows.get(row).ok_or_else(|| Error(format!("pcTech row {row} missing")))?;
            let number = |key: &str| {
                record.get(key).and_then(Cell::int).ok_or_else(|| Error(format!("pcTech row {row}: invalid {key}")))
            };
            if number("SKILL")? != skill || record.get("ZOKUSEI").and_then(Cell::str) != Some(element) {
                return Err(Error(format!("pcTech row {row}: unexpected skill or element")));
            }
            let mut tech = json!({
                "kind": kind, "grade": grade, "row": row,
                "skill": match skill {6=>"blast",7=>"heal",_=>"force"}, "element": element,
                "mpCost": number("MP")?, "power": (-number("HP")?).max(0), "healBase": number("HP")?.max(0),
                "baseFrames": number("TIME")?, "criticalRate": number("CHIMEIRITSU")?,
                "boosts": {"maxHp": number("MAXHP")?, "strength": number("TSUYOSA")?, "defense": number("MAMORI")?,
                    "speed":number("SUBAYASA")?,"hitRate":number("MHIRITSU")?,"evasion":number("KAIHIRITSU")?,
                    "fire":number("FIRE")?,"ice":number("ICE")?,"thunder":number("THUNDER")?,"dark":number("DARK")?}
            });
            if kind == "raise" {
                tech["revive"] = json!({"experiencePercent":revive[tier].0,"hp":revive[tier].1});
            }
            techs.push(tech);
        }
    }
    Ok(Value::Array(techs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Row;

    #[test]
    fn exports_each_grade_from_its_actual_row_and_rejects_missing_fields() {
        let mut rows = vec![Row::new(); 100];
        for (_, base, skill, element) in FAMILIES {
            for (row, record) in rows.iter_mut().enumerate().skip(base).take(5) {
                for key in [
                    "MP",
                    "TIME",
                    "CHIMEIRITSU",
                    "MAXHP",
                    "TSUYOSA",
                    "MAMORI",
                    "SUBAYASA",
                    "MHIRITSU",
                    "KAIHIRITSU",
                    "FIRE",
                    "ICE",
                    "THUNDER",
                    "DARK",
                ] {
                    record.insert(key.into(), Cell::Int(row as i64));
                }
                record.insert("HP".into(), Cell::Int(-(row as i64)));
                record.insert("SKILL".into(), Cell::Int(skill));
                record.insert("ZOKUSEI".into(), Cell::Str(Some(element.into())));
            }
        }
        let mut tables = Tables::from([("pcTech".into(), rows)]);
        for gamecube in [false, true] {
            let mut executable = vec![0u8; 128];
            for (i, n) in [59_i32, 68, 77, 86, 95].into_iter().enumerate() {
                executable[i * 4..i * 4 + 4].copy_from_slice(&if gamecube { n.to_be_bytes() } else { n.to_le_bytes() });
            }
            let hp_offset = if gamecube { 20 } else { 32 };
            for (i, n) in [100_i32, 400, 1600, 3200, 6400].into_iter().enumerate() {
                executable[hp_offset + i * 4..hp_offset + i * 4 + 4].copy_from_slice(&if gamecube {
                    n.to_be_bytes()
                } else {
                    n.to_le_bytes()
                });
            }
            let output = extract(&tables, &executable, gamecube).unwrap();
            assert_eq!(output.as_array().unwrap().len(), 100);
            assert_eq!(output[80]["row"], 80);
            assert_eq!(output[99]["grade"], "Infinity");
            assert_eq!(output[20]["power"], 20);
            assert_eq!(output[0]["element"], "fire");
            assert_eq!(output[50]["revive"]["experiencePercent"], 59);
            assert_eq!(output[54]["revive"]["hp"], 6400);
        }
        tables.get_mut("pcTech").unwrap()[20].remove("TIME");
        assert!(extract(&tables, &[], false).is_err());
    }
}

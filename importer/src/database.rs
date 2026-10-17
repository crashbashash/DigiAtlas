//! Game databases (items, enemies) from AREA.AFS entry 9, the English copy of the database pack.
//!
//! Each `beDBManagerInfo` names a database and points at its `beDataBase`, which holds up to six
//! (names, values) column pairs: a list of column names and one flat list of values with a run of
//! `len(names)` values per row. Text is CP932 (Shift-JIS).

use std::collections::HashMap;

use crate::error::{Error, Result};
use crate::fail;
use crate::igb::{Graph, ListValue};

pub const DATABASE_ENTRY: usize = 9;
const TYPED_COLUMNS: [(usize, usize); 5] = [(0, 1), (2, 3), (4, 5), (6, 7), (8, 9)];
const STRING_NAMES: usize = 10;
const STRING_VALUES: usize = 11;

pub const ITEM_DATABASES: [&str; 7] = ["weapon", "armor1", "armor2", "abChip", "conItem", "insItem", "impItem"];
const SKILL_TYPES: [&str; 6] = ["Blunt", "Slash", "Stab", "Bash", "Shot", "Crush"];

/// Engine column -> exported stat key, in export order. Only columns whose meaning is confirmed
/// are exported; zero values are left out.
const STAT_KEYS: [(&str, &str); 31] = [
    ("TSUYOSA", "strength"), ("MAMORI", "defense"), ("KASHIKOSA", "wisdom"), ("SEISHIN", "spirit"),
    ("SUBAYASA", "speed"), ("MAXHP", "maxHp"), ("MAXMP", "maxMp"),
    ("RES_FIRE", "resistFire"), ("RES_ICE", "resistIce"), ("RES_THUNDER", "resistThunder"),
    ("RES_DARK", "resistDark"), ("RES_STUN", "resistStun"), ("RES_POISON", "resistPoison"),
    ("CHIMEIRITSU", "critRate"), ("MAHIRITSU", "paralysisRate"), ("MEICHURITSU", "hitRate"),
    ("BOUGYORITSU", "defenseRate"), ("MAHITEIKOU", "paralysisResist"), ("DOKUTEIKOU", "poisonResist"),
    ("BITRITSU", "bitRate"), ("EXPRITSU", "expRate"), ("LUCKRITSU", "luckRate"),
    ("HPDRAIN", "hpDrain"), ("MPDRAIN", "mpDrain"), ("CHOHATURITSU", "provokeRate"),
    ("LVPOINT", "equipLevel"), ("SKILLPOINT", "requiredSkill"),
    ("HANBAI", "buyPrice"), ("KAITORI", "sellPrice"),
    ("HP", "restoreHp"), ("MP", "restoreMp"),
];

/// One database cell.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Int(i64),
    Float(f64),
    Str(Option<String>),
}

impl Cell {
    pub fn int(&self) -> Option<i64> {
        match self {
            Cell::Int(v) => Some(*v),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            Cell::Str(Some(s)) => Some(s),
            _ => None,
        }
    }
    fn truthy(&self) -> bool {
        match self {
            Cell::Int(v) => *v != 0,
            Cell::Float(v) => *v != 0.0,
            Cell::Str(s) => s.as_deref().is_some_and(|s| !s.is_empty()),
        }
    }
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Cell::Int(v) => (*v).into(),
            Cell::Float(v) => serde_json::Number::from_f64(*v).map(Into::into).unwrap_or(serde_json::Value::Null),
            Cell::Str(s) => s.clone().map(Into::into).unwrap_or(serde_json::Value::Null),
        }
    }
}

pub type Row = HashMap<String, Cell>;
pub type Tables = HashMap<String, Vec<Row>>;

/// CP932 as Python decodes it: the WHATWG Shift-JIS table plus four single bytes that Python maps
/// to private-use characters.
pub fn decode_cp932(raw: &[u8]) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        let lead = (0x81..=0x9F).contains(&b) || (0xE0..=0xFC).contains(&b);
        if lead && i + 1 < raw.len() {
            let (s, _, bad) = encoding_rs::SHIFT_JIS.decode(&raw[i..i + 2]);
            if !bad && s.chars().count() == 1 {
                out.push_str(&s);
                i += 2;
                continue;
            }
            out.push('\u{FFFD}');
            i += 1;
            continue;
        }
        match b {
            0xA0 => out.push('\u{F8F0}'),
            0xFD => out.push('\u{F8F1}'),
            0xFE => out.push('\u{F8F2}'),
            0xFF => out.push('\u{F8F3}'),
            _ => out.push_str(&encoding_rs::SHIFT_JIS.decode(&raw[i..i + 1]).0),
        }
        i += 1;
    }
    out
}

/// Python's `str.strip()`: Unicode whitespace plus the ASCII separators 0x1C-0x1F.
pub fn py_strip(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
}

fn decode_text(raw: &str) -> String {
    let bytes: Vec<u8> = raw.chars().map(|c| c as u32 as u8).collect();
    let text = decode_cp932(&bytes).replace("\r\n", "\n").replace('\r', "\n");
    // CP932 0x81F7 renders as a pilcrow, but the pickup is the X-Data item.
    py_strip(&text).replace("¶ ", "X-").replace('¶', "X-")
}

fn names_of(g: &Graph, value: Option<&crate::igb::Value>) -> Result<Vec<Option<String>>> {
    let k = value.and_then(|v| g.r#ref(v)).ok_or_else(|| Error("database column does not resolve".into()))?;
    g.names(k)
}

/// Database name -> one map per row, keyed by the engine's column names.
pub fn read_tables(entry: Vec<u8>) -> Result<Tables> {
    let g = Graph::new(entry)?;
    let mut out = Tables::new();
    for k in 0..g.s2.len() {
        if g.class(k) != "beDBManagerInfo" {
            continue;
        }
        let v = g.vals(k);
        let Some(db) = v.get(4).and_then(|x| g.r#ref(x)) else { continue };
        if g.class(db) != "beDataBase" {
            continue;
        }
        let cols = g.vals(db);
        let mut series: Vec<(Vec<Option<String>>, Vec<Cell>)> = Vec::new();
        for (names_at, values_at) in TYPED_COLUMNS {
            let names = names_of(&g, cols.get(names_at).copied())?;
            if !names.is_empty() {
                let vk = cols.get(values_at).and_then(|x| g.r#ref(x)).ok_or_else(|| Error("database values do not resolve".into()))?;
                let vals = g
                    .list_values(vk)?
                    .into_iter()
                    .map(|x| match x {
                        ListValue::Int(i) => Cell::Int(i),
                        ListValue::Float(f) => Cell::Float(f),
                        ListValue::Vec3(_) => Cell::Str(None),
                    })
                    .collect();
                series.push((names, vals));
            }
        }
        let names = names_of(&g, cols.get(STRING_NAMES).copied())?;
        if !names.is_empty() {
            let vals = names_of(&g, cols.get(STRING_VALUES).copied())?
                .into_iter()
                .map(|s| Cell::Str(s.map(|s| decode_text(&s))))
                .collect();
            series.push((names, vals));
        }
        let row_count = series.iter().map(|(n, vals)| vals.len() / n.len()).max().unwrap_or(0);
        let mut rows: Vec<Row> = vec![Row::new(); row_count];
        let db_name = v.first().and_then(|x| x.str()).unwrap_or("").to_string();
        for (names, vals) in &series {
            let stride = names.len();
            if vals.len() != stride * row_count {
                fail!("{db_name}: {} values for {stride} columns x {row_count} rows", vals.len());
            }
            for (r, row) in rows.iter_mut().enumerate() {
                for (c, name) in names.iter().enumerate() {
                    if let Some(name) = name {
                        row.insert(name.clone(), vals[r * stride + c].clone());
                    }
                }
            }
        }
        out.insert(db_name, rows);
    }
    Ok(out)
}

/// Stat-table row -> internal model name, for rows that exist.
pub fn enemy_models(tables: &Tables) -> Result<std::collections::BTreeMap<usize, String>> {
    let rows = tables.get("enemy").ok_or_else(|| Error("database 'enemy' missing".into()))?;
    Ok(rows
        .iter()
        .enumerate()
        .filter_map(|(i, r)| r.get("MODEL").and_then(Cell::str).filter(|s| !s.is_empty()).map(|s| (i, s.to_string())))
        .collect())
}

pub struct Item {
    pub category: &'static str,
    pub id: usize,
    pub name: String,
    pub description: Option<String>,
    /// (key, value) in export order.
    pub stats: Vec<(&'static str, Cell)>,
    pub skill_type: Option<&'static str>,
    pub unidentified: bool,
}

pub fn parse_items(tables: &Tables) -> Result<Vec<Item>> {
    let mut items = Vec::new();
    for category in ITEM_DATABASES {
        let Some(rows) = tables.get(category) else { fail!("database {category:?} missing") };
        let glyph = match category {
            "weapon" => Some("∈"),
            "armor1" => Some("∋"),
            "armor2" => Some("∨"),
            "abChip" => Some("∧"),
            _ => None,
        };
        for (i, row) in rows.iter().enumerate() {
            let mut name = row.get("NAME").and_then(Cell::str).unwrap_or("").to_string();
            if let Some(g) = glyph {
                if let Some(rest) = name.strip_prefix(g) {
                    name = rest.to_string();
                }
            }
            let mut stats: Vec<(&'static str, Cell)> = STAT_KEYS
                .iter()
                .filter_map(|(col, key)| row.get(*col).filter(|c| c.truthy()).map(|c| (*key, c.clone())))
                .collect();
            let skill = if category == "weapon" {
                row.get("SKILL").and_then(Cell::int).filter(|s| (0..SKILL_TYPES.len() as i64).contains(s)).map(|s| SKILL_TYPES[s as usize])
            } else {
                None
            };
            let name = py_strip(&name).to_string();
            let mut text = row.get("TXT").and_then(Cell::str).filter(|s| !s.is_empty()).map(str::to_string);
            let kind = match category {
                "weapon" => Some("Weapon"),
                "armor1" => Some("Core"),
                "armor2" => Some("Board"),
                _ => None,
            };
            let unidentified = !name.is_empty() && name.chars().all(|c| c == '?') && kind.is_some();
            let mut display = name;
            if let (true, Some(kind)) = (unidentified, kind) {
                display = format!("Unidentified {kind}");
                text = Some(format!(
                    "Take this to a Digimon in the central area to identify it as a random {}.",
                    kind.to_lowercase()
                ));
                // The game stores 999 as a placeholder equip level.
                stats.retain(|(k, _)| *k != "equipLevel");
            }
            items.push(Item { category, id: i, name: display, description: text, stats, skill_type: skill, unidentified });
        }
    }
    Ok(items)
}

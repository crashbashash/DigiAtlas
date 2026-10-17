//! What the Central appraiser turns an unidentified weapon, core or board into.
//!
//! The service charges 300 BIT and picks a level tier from the player's level. The result tables
//! `coweapon`, `coarmor1` and `coarmor2` live in the Central hub's database pack. Row `tier * 100`
//! holds the number of results in its `ID` column; the rows after it hold a result's item `ID` and
//! its `RATE` out of 10000.

use serde_json::{json, Map, Value};

use crate::afs::Afs;
use crate::database::{self, Cell, Row, Tables};
use crate::error::Result;

const COST: i64 = 300;
/// A tier applies while the level is below its bound; the last tier has no bound.
const LEVEL_BOUNDS: [i64; 5] = [41, 101, 201, 301, 401];
const TABLES: [(&str, &str); 3] = [("weapon", "coweapon"), ("armor1", "coarmor1"), ("armor2", "coarmor2")];

/// (tier, lowest level, highest level or None) for tiers 1 to 6.
fn tier_levels() -> Vec<(i64, i64, Option<i64>)> {
    let lows: Vec<i64> = std::iter::once(0).chain(LEVEL_BOUNDS).collect();
    (0..lows.len())
        .map(|n| (n as i64 + 1, lows[n], LEVEL_BOUNDS.get(n).map(|b| b - 1)))
        .collect()
}

fn results(rows: &[Row], tier: i64) -> Vec<(Cell, Cell)> {
    let base = (tier * 100) as usize;
    if base >= rows.len() {
        return Vec::new();
    }
    let count = rows[base].get("ID").and_then(Cell::int).unwrap_or(0).max(0) as usize;
    rows.iter()
        .skip(base + 1)
        .take(count)
        .map(|r| (r.get("ID").cloned().unwrap_or(Cell::Str(None)), r.get("RATE").cloned().unwrap_or(Cell::Str(None))))
        .collect()
}

/// The result tables from whichever of `packs` carries them.
pub fn find_tables(ndmw: &Afs, packs: &[usize]) -> Result<Option<Tables>> {
    for &pack in packs {
        let data = ndmw.entry(pack)?;
        if !data.windows(8).any(|w| w == b"coweapon") {
            continue;
        }
        let tables = database::read_tables(data)?;
        if TABLES.iter().all(|(_, name)| tables.contains_key(*name)) {
            return Ok(Some(tables));
        }
    }
    Ok(None)
}

/// The appraiser's rules as JSON.
pub fn build(tables: &Tables) -> Value {
    let tiers: Vec<Value> = tier_levels()
        .into_iter()
        .map(|(tier, low, high)| {
            let mut by_category = Map::new();
            for (category, name) in TABLES {
                let list: Vec<Value> = results(&tables[name], tier)
                    .into_iter()
                    .map(|(id, rate)| json!({"category": category, "id": id.to_json(), "rate": rate.to_json()}))
                    .collect();
                by_category.insert(category.into(), Value::Array(list));
            }
            json!({"tier": tier, "minLevel": low, "maxLevel": high, "results": by_category})
        })
        .collect();
    json!({"cost": COST, "tiers": tiers})
}

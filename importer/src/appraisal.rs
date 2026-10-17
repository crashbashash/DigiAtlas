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

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, rate: i64) -> Row {
        [("ID", Cell::Int(id)), ("RATE", Cell::Int(rate)), ("RANK", Cell::Int(0))].into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    #[test]
    fn tiers_follow_the_level_bounds() {
        assert_eq!(
            tier_levels(),
            [(1, 0, Some(40)), (2, 41, Some(100)), (3, 101, Some(200)), (4, 201, Some(300)), (5, 301, Some(400)), (6, 401, None)]
        );
    }

    #[test]
    fn a_tier_row_counts_its_results() {
        let mut rows: Vec<Row> = (0..100).map(|_| row(0, 0)).collect();
        rows.extend([row(2, 0), row(7, 6000), row(9, 4000), row(5, 1)]); // the last is past the count
        let ids: Vec<(Option<i64>, Option<i64>)> = results(&rows, 1).iter().map(|(i, r)| (i.int(), r.int())).collect();
        assert_eq!(ids, [(Some(7), Some(6000)), (Some(9), Some(4000))]);
        assert!(results(&rows, 2).is_empty());
    }

    #[test]
    fn lists_every_kind_per_tier() {
        let mut one: Vec<Row> = (0..100).map(|_| row(0, 0)).collect();
        one.extend([row(1, 0), row(3, 10000)]);
        let tables: Tables = ["coweapon", "coarmor1", "coarmor2"].iter().map(|n| (n.to_string(), one.clone())).collect();
        let out = build(&tables);
        assert_eq!(out["cost"], 300);
        assert_eq!(out["tiers"][0]["results"]["armor1"], serde_json::json!([{"category": "armor1", "id": 3, "rate": 10000}]));
        assert_eq!(out["tiers"][5]["results"]["weapon"], serde_json::json!([]));
    }
}

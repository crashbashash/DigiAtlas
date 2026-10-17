//! Decode a stage generator pack into spawn generators and their drop pools.
//!
//! ```text
//! beGeneraterData              spawn row: name, stat row, position/rotation lists, modes
//!   -> beGeneraterPlayerDataList -> beGeneraterPlayerData (count, max count, item lists)
//!        -> beGeneraterItemDataList -> beGeneraterItemData (pool name, n/h/v + zone + family)
//!             -> beGeneraterItemDataOneList -> beGeneraterItemDataOne (category, id, rank, rate)
//! ```
//!
//! `rate` is out of 10000 (the engine rolls `RNG() % 10000`).

use crate::error::Result;
use crate::igb::{Graph, ListValue, Value};
use crate::pyfmt;

const GENE_NAME: usize = 0;
const GENE_POS: usize = 1;
const GENE_GLOBAL: usize = 2;
const GENE_POS_LIST: usize = 3;
const GENE_ROT_LIST: usize = 4;
const GENE_ROW: usize = 5;
const GENE_START_MODE: usize = 7;
const GENE_START_DATA: usize = 8;
const GENE_FILL_MODE: usize = 9;
const GENE_LUA: usize = 11;
const GENE_PLAYER_LIST: usize = 12;
const PLAYER_COUNT: usize = 0;
const PLAYER_MAX: usize = 1;
const PLAYER_ITEMS: usize = 2;
const PLAYER_LAST_ITEMS: usize = 3;
const ITEM_NAME: usize = 0;
const ITEM_ONES: usize = 1;

#[derive(Debug, Clone)]
pub struct DropEntry {
    pub category: String,
    pub id: i64,
    pub rank: i64,
    pub rate: i64,
}

#[derive(Debug, Clone)]
pub struct DropPool {
    pub name: String,
    pub entries: Vec<DropEntry>,
}

impl DropPool {
    /// `nZ1...`, `hZ1...`, `vZ1...`: the difficulty a pool belongs to, from its name.
    pub fn difficulty(&self) -> Option<&'static str> {
        let mut chars = self.name.chars();
        let first = chars.next()?;
        if !chars.next()?.is_uppercase() {
            return None;
        }
        match first {
            'n' => Some("normal"),
            'h' => Some("hard"),
            'v' => Some("veryhard"),
            _ => None,
        }
    }
}

/// What a spawner does for a given number of players (entry 0 is one player).
#[derive(Debug, Clone)]
pub struct PlayerSlot {
    pub count: Value,
    pub max_count: Value,
    pub pools: Vec<DropPool>,
    pub last_pools: Vec<DropPool>,
}

#[derive(Debug, Clone)]
pub struct Generator {
    pub name: String,
    pub row: Value,
    pub position: [f64; 3],
    pub positions: Vec<[f64; 3]>,
    pub rotations: Vec<f64>,
    pub is_global: bool,
    pub start_mode: Value,
    /// radar: squared trigger radius; direct/timer: unused or a frame count.
    pub start_data: Value,
    pub fill_mode: Value,
    pub lua: Value,
    pub gene_count: Option<Value>,
    pub gene_max_count: Option<Value>,
    pub pools: Vec<DropPool>,
    pub last_pools: Vec<DropPool>,
    pub slots: Vec<PlayerSlot>,
}

impl Generator {
    /// Where and how close you must get for a radar spawner to start: (anchor, radius).
    pub fn trigger(&self) -> Option<([f64; 3], f64)> {
        let data = self.start_data.float()?;
        if self.start_mode.str() != Some("radar") || data <= 0.0 {
            return None;
        }
        Some((self.position, pyfmt::round(data.powf(0.5), 2)))
    }

    /// World positions where this generator places things: world coordinates for a global
    /// generator, otherwise offsets from its anchor.
    pub fn spawns(&self) -> Vec<[f64; 3]> {
        if self.is_global {
            if self.positions.is_empty() {
                return vec![self.position];
            }
            return self.positions.clone();
        }
        let [x, y, z] = self.position;
        let offsets = if self.positions.is_empty() { vec![[0.0, 0.0, 0.0]] } else { self.positions.clone() };
        offsets.iter().map(|[dx, dy, dz]| [x + dx, y + dy, z + dz]).collect()
    }
}

/// Cheap test: does this AFS entry carry a `beGeneraterData` class?
pub fn has_generators(data: &[u8]) -> bool {
    let head = &data[..data.len().min(0x4000)];
    head.windows(16).any(|w| w == b"beGeneraterData\x00")
}

pub struct Pack {
    g: Graph,
}

impl Pack {
    pub fn new(data: Vec<u8>) -> Result<Pack> {
        Ok(Pack { g: Graph::new(data)? })
    }

    fn vec3s(&self, r: &Value) -> Result<Vec<[f64; 3]>> {
        match self.g.r#ref(r) {
            Some(k) if self.g.class(k) == "igVec3fList" => Ok(self
                .g
                .list_values(k)?
                .into_iter()
                .filter_map(|v| match v {
                    ListValue::Vec3(p) => Some(p.map(|x| pyfmt::round(x, 4))),
                    _ => None,
                })
                .collect()),
            _ => Ok(Vec::new()),
        }
    }

    fn floats(&self, r: &Value) -> Result<Vec<f64>> {
        match self.g.r#ref(r) {
            Some(k) if self.g.class(k) == "igFloatList" => Ok(self
                .g
                .list_values(k)?
                .into_iter()
                .filter_map(|v| match v {
                    ListValue::Float(x) => Some(pyfmt::round(x, 5)),
                    _ => None,
                })
                .collect()),
            _ => Ok(Vec::new()),
        }
    }

    fn pools(&self, list_ref: &Value) -> Result<Vec<DropPool>> {
        let Some(lk) = self.g.r#ref(list_ref) else { return Ok(Vec::new()) };
        let mut out = Vec::new();
        for ik in self.g.list_refs(lk)?.into_iter().flatten() {
            if self.g.class(ik) != "beGeneraterItemData" {
                continue;
            }
            let iv = self.g.vals(ik);
            let mut pool = DropPool { name: iv[ITEM_NAME].str().unwrap_or("").to_string(), entries: Vec::new() };
            if let Some(ok) = self.g.r#ref(iv[ITEM_ONES]) {
                for nk in self.g.list_refs(ok)?.into_iter().flatten() {
                    if self.g.class(nk) != "beGeneraterItemDataOne" {
                        continue;
                    }
                    let ov = self.g.vals(nk);
                    pool.entries.push(DropEntry {
                        category: ov[0].str().unwrap_or("").to_string(),
                        id: ov[1].int().unwrap_or(0),
                        rank: ov[2].int().unwrap_or(0),
                        rate: ov[3].int().unwrap_or(0),
                    });
                }
            }
            out.push(pool);
        }
        Ok(out)
    }

    pub fn generators(&self) -> Result<Vec<Generator>> {
        let mut out = Vec::new();
        for k in 0..self.g.s2.len() {
            if self.g.class(k) != "beGeneraterData" {
                continue;
            }
            let v = self.g.vals(k);
            let mut slots = Vec::new();
            if let Some(pk) = self.g.r#ref(v[GENE_PLAYER_LIST]) {
                if self.g.class(pk) == "beGeneraterPlayerDataList" {
                    // The list order is the player count (1..4); entries may repeat.
                    for dk in self.g.list_refs(pk)?.into_iter().flatten() {
                        if self.g.class(dk) != "beGeneraterPlayerData" {
                            continue;
                        }
                        let pv = self.g.vals(dk);
                        slots.push(PlayerSlot {
                            count: pv[PLAYER_COUNT].clone(),
                            max_count: pv[PLAYER_MAX].clone(),
                            pools: self.pools(pv[PLAYER_ITEMS])?,
                            last_pools: self.pools(pv[PLAYER_LAST_ITEMS])?,
                        });
                    }
                }
            }
            let first = slots.first();
            let position =
                v[GENE_POS].floats().map(|p| [p[0], p[1], p[2]].map(|x| pyfmt::round(x, 4))).unwrap_or([0.0; 3]);
            out.push(Generator {
                name: v[GENE_NAME].str().unwrap_or("").to_string(),
                row: v[GENE_ROW].clone(),
                position,
                positions: self.vec3s(v[GENE_POS_LIST])?,
                rotations: self.floats(v[GENE_ROT_LIST])?,
                is_global: v[GENE_GLOBAL].truthy(),
                start_mode: v[GENE_START_MODE].clone(),
                start_data: v[GENE_START_DATA].clone(),
                fill_mode: v[GENE_FILL_MODE].clone(),
                lua: v[GENE_LUA].clone(),
                gene_count: first.map(|s| s.count.clone()),
                gene_max_count: first.map(|s| s.max_count.clone()),
                pools: slots.iter().find(|s| !s.pools.is_empty()).map(|s| s.pools.clone()).unwrap_or_default(),
                last_pools: slots
                    .iter()
                    .find(|s| !s.last_pools.is_empty())
                    .map(|s| s.last_pools.clone())
                    .unwrap_or_default(),
                slots,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn generator(
        position: [f64; 3],
        positions: Vec<[f64; 3]>,
        is_global: bool,
        start_mode: &str,
        start_data: f64,
    ) -> Generator {
        Generator {
            name: "GENE-00".into(),
            row: Value::Int(1),
            position,
            positions,
            rotations: Vec::new(),
            is_global,
            start_mode: Value::Str(start_mode.into()),
            start_data: Value::Float(start_data),
            fill_mode: Value::Str(String::new()),
            lua: Value::Str(String::new()),
            gene_count: Some(Value::Int(1)),
            gene_max_count: Some(Value::Int(1)),
            pools: Vec::new(),
            last_pools: Vec::new(),
            slots: Vec::new(),
        }
    }

    #[test]
    fn a_global_generator_lists_world_positions() {
        let g = generator([5.0, 10.0, 15.0], vec![[5.0, 10.0, 15.0], [30.0, 10.0, 0.0]], true, "", 0.0);
        assert_eq!(g.spawns(), [[5.0, 10.0, 15.0], [30.0, 10.0, 0.0]]);
        assert_eq!(generator([1.0, 2.0, 3.0], vec![], true, "", 0.0).spawns(), [[1.0, 2.0, 3.0]]);
    }

    #[test]
    fn a_room_generator_adds_offsets_to_its_anchor() {
        let g = generator([-180.0, 40.0, 60.0], vec![[-20.0, 0.0, -55.0], [20.0, 0.0, -55.0]], false, "", 0.0);
        assert_eq!(g.spawns(), [[-200.0, 40.0, 5.0], [-160.0, 40.0, 5.0]]);
        assert_eq!(generator([7.0, 0.0, 9.0], vec![], false, "", 0.0).spawns(), [[7.0, 0.0, 9.0]]);
    }

    #[test]
    fn a_radar_spawner_triggers_within_the_square_root_of_its_data() {
        let g = generator([455.0, 50.0, 15.0], vec![[455.0, 50.0, 15.0]], true, "radar", 4225.0);
        assert_eq!(g.trigger(), Some(([455.0, 50.0, 15.0], 65.0)));
        assert_eq!(generator([0.0; 3], vec![], true, "direct", 150.0).trigger(), None);
        assert_eq!(generator([0.0; 3], vec![], true, "radar", 0.0).trigger(), None);
    }

    #[test]
    fn a_pool_name_gives_its_difficulty() {
        let pool = |n: &str| DropPool { name: n.into(), entries: Vec::new() };
        assert_eq!(pool("hZ1gobr3").difficulty(), Some("hard"));
        assert_eq!(pool("vZ2a").difficulty(), Some("veryhard"));
        assert_eq!(pool("comonNOTG01").difficulty(), None);
        assert_eq!(pool("n").difficulty(), None);
    }
}

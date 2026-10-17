//! Curated name tables, built into the importer: display names for enemy models, stage names
//! transcribed from the loading banners, and story-flag meanings.

use std::sync::OnceLock;

use serde_json::Value;

const ENEMIES: &str = include_str!("../names/enemies.json");
const STAGES: &str = include_str!("../names/stages.json");
const FLAGS: &str = include_str!("../names/flags.json");

fn parse(cell: &'static OnceLock<Value>, text: &str) -> &'static Value {
    cell.get_or_init(|| serde_json::from_str(text).expect("built-in name table is valid JSON"))
}

/// Enemy model -> {name, source, form?, kind?, role?, partOf?}.
pub fn enemies() -> &'static Value {
    static CELL: OnceLock<Value> = OnceLock::new();
    parse(&CELL, ENEMIES)
}

/// Stage id -> {area, room, source, band?}.
pub fn stages() -> &'static Value {
    static CELL: OnceLock<Value> = OnceLock::new();
    parse(&CELL, STAGES)
}

/// Flag number -> {meaning, ...}.
pub fn flags() -> &'static Value {
    static CELL: OnceLock<Value> = OnceLock::new();
    parse(&CELL, FLAGS)
}

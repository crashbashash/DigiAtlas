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

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(table: &'static Value) -> impl Iterator<Item = (&'static String, &'static Value)> {
        table.as_object().unwrap().iter().filter(|(k, _)| !k.starts_with('_'))
    }

    #[test]
    fn every_enemy_name_entry_is_well_formed() {
        let all: Vec<&str> = entries(enemies()).map(|(_, e)| e["name"].as_str().unwrap()).collect();
        for (model, e) in entries(enemies()) {
            assert!("efg".contains(&model[..1]), "{model}");
            assert!(!e["name"].as_str().unwrap().is_empty(), "{model}");
            assert!(["disc", "wiki", "player", "decomp"].contains(&e["source"].as_str().unwrap()), "{model}");
            let keys = ["name", "source", "form", "kind", "role", "partOf"];
            assert!(e.as_object().unwrap().keys().all(|k| keys.contains(&k.as_str())), "{model}");
            if let Some(kind) = e.get("kind") {
                assert!(["enemy", "boss", "object"].contains(&kind.as_str().unwrap()), "{model}");
            }
            // A part names its boss, and that boss is in the table.
            assert_eq!(e.get("role").is_some(), e.get("partOf").is_some(), "{model}");
            if let Some(role) = e.get("role") {
                assert_eq!(role, "part", "{model}");
                assert!(all.contains(&e["partOf"].as_str().unwrap()), "{model}");
            }
        }
    }

    #[test]
    fn models_sharing_a_name_are_told_apart_by_form() {
        let mut by_name: std::collections::HashMap<&str, Vec<Option<&str>>> = Default::default();
        for (_, e) in entries(enemies()).filter(|(_, e)| e.get("role").is_none()) {
            by_name.entry(e["name"].as_str().unwrap()).or_default().push(e.get("form").and_then(Value::as_str));
        }
        for (name, forms) in by_name {
            if forms.iter().any(Option::is_some) {
                assert!(forms.iter().all(Option::is_some), "{name}");
                let mut unique = forms.clone();
                unique.sort();
                unique.dedup();
                assert_eq!(unique.len(), forms.len(), "{name}");
            }
        }
    }

    #[test]
    fn the_stage_name_table_is_well_formed() {
        for (stage, e) in entries(stages()) {
            let source = e.get("source").and_then(Value::as_str);
            assert!(matches!(source, Some("banner") | Some("decomp") | None), "{stage}");
            if source == Some("banner") {
                let band = e["band"].as_str().unwrap();
                assert!(band.len() == 40 && band.chars().all(|c| c.is_ascii_hexdigit()), "{stage}");
                assert!(e["area"].is_string() && e["room"].is_string(), "{stage}");
            }
        }
    }

    #[test]
    fn flag_meanings_are_numbered() {
        for (flag, e) in entries(flags()) {
            assert!(flag.parse::<i64>().is_ok(), "{flag}");
            assert!(e["meaning"].is_string(), "{flag}");
        }
    }
}

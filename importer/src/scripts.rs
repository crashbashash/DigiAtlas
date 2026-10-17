//! What the game's scripts do to each spawner, read from the decompiled stage scripts.
//! Port of tools/ps2_export/scripts.py; must produce the same conditions text.

use std::collections::HashMap;

/// One spawner command in a script, with the conditions above it.
#[derive(Debug, Clone, PartialEq)]
pub struct Ref {
    pub verb: String,
    /// The spawner's name, or None when it is built in code.
    pub target: Option<String>,
    /// For a built name, its constant start (e.g. "GENE-").
    pub prefix: Option<String>,
    /// Plain-language conditions, outermost first.
    pub when: Vec<String>,
    /// The same conditions as decompiled.
    pub raw: Vec<String>,
}

/// Every spawner reference in a stage's scripts, by spawner name and by built-name prefix.
#[derive(Debug, Default)]
pub struct StageScripts {}

impl StageScripts {
    /// How scripts relate to a spawner: ("referenced" | "dynamic" | "unknown" | "none", refs).
    pub fn status(&self, _name: &str) -> (&'static str, Vec<Ref>) {
        todo!("port scripts.StageScripts.status")
    }
}

/// Meanings of the story and quest flags (names/flags.json).
pub fn load_flag_names() -> HashMap<i64, String> {
    todo!("port scripts.load_flag_names")
}

/// Every spawner reference in a stage's packs.
pub fn analyse(_packs: &[Vec<u8>], _digimon: &HashMap<String, String>, _meanings: &HashMap<i64, String>) -> StageScripts {
    todo!("port scripts.analyse")
}

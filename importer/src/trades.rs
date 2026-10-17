//! Item trades offered by the Digimon in a shop room (Trader Hall).
//! Port of tools/ps2_export/trades.py; must produce the same traders and offers.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct Offer {
    /// (item database, id) handed over.
    pub give: (String, i64),
    /// (item database, id) received.
    pub get: (String, i64),
}

/// A trader standing in a room, with the table it uses on each difficulty.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub name: String,
    pub instance: i64,
    pub position: [f64; 3],
    /// Degrees of rotation about the vertical axis.
    pub facing: f64,
    /// (difficulty, offers) in normal/hard/veryhard order, only those that exist.
    pub tables: Vec<(&'static str, Vec<Offer>)>,
}

/// The traders standing in a stage, sorted by name then instance.
pub fn extract(_packs: &[Vec<u8>], _digimon: &HashMap<String, String>) -> Vec<Placed> {
    todo!("port trades.extract")
}

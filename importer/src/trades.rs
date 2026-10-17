//! Item trades offered by the Digimon in a shop room (Trader Hall).
//! Port of tools/ps2_export/trades.py; must produce the same traders and offers.
//!
//! Each trader's dialogue script is a chain of "if you hold item X, offer item Y" branches. A branch
//! sets `g_SItemDB/g_SItemID` (what you hand over) and `g_TItemDB/g_TItemID` (what you get). The first
//! branch of every table takes an Offering (important item 11) in place of a piece of equipment.

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use regex::Regex;

use crate::igb::Graph;
use crate::luadec;

fn offer_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"g_SItemDB = "(\w+)"\s+g_SItemID = (\d+)\s+g_TItemDB = "(\w+)"\s+g_TItemID = (\d+)"#).unwrap())
}

fn speaker_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"funcOpenMessage\("talk", "n_(\w+)""#).unwrap())
}

/// The stage script puts each Digimon in the room: model, which of that model it is, position, then
/// rotation.
fn place_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"be:sd\("MODELCTRL", "n_(\w+)", (\d+), "GENERATE", "V<(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)>/V<-?[\d.]+,(-?[\d.]+),-?[\d.]+>"\)"#,
        )
        .unwrap()
    })
}

/// Trader models that are not playable Digimon (those are named from the game's evolution table).
const EXTRA_NAMES: [(&str, &str); 1] = [("prmame", "Mamemon")];

/// A trader's table is a script per difficulty (n, h, v) and per instance:
/// `n_<model>_<instance><letter>.lua`, or `n_<model>_<instance>.lua` when every difficulty shares one.
const DIFFICULTY_LETTERS: [(&str, &str); 3] = [("normal", "n"), ("hard", "h"), ("veryhard", "v")];

#[derive(Debug, Clone, PartialEq)]
pub struct Offer {
    /// (item database, id) handed over.
    pub give: (String, i64),
    /// (item database, id) received.
    pub get: (String, i64),
}

/// The trade table of one script.
#[derive(Debug, Clone, PartialEq)]
pub struct Trader {
    pub name: String,
    pub offers: Vec<Offer>,
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

/// Python's `str.capitalize()`: first character upper case, the rest lower case.
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars.flat_map(char::to_lowercase)).collect(),
        None => String::new(),
    }
}

/// Display names by trader model: playable forms (`p_<model>`) plus the extra names.
fn names(digimon: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out: HashMap<String, String> =
        digimon.iter().filter_map(|(k, v)| Some((k.strip_prefix("p_")?.to_string(), v.clone()))).collect();
    out.extend(EXTRA_NAMES.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    out
}

fn display_name(names: &HashMap<String, String>, model: &str) -> String {
    names.get(model).cloned().unwrap_or_else(|| capitalize(model))
}

/// The trade table in one decompiled script, or None when it is not a trader's.
pub fn parse(source: &str, digimon: &HashMap<String, String>) -> Option<Trader> {
    let speaker = speaker_re().captures(source)?;
    let offers: Vec<Offer> = offer_re()
        .captures_iter(source)
        .filter_map(|m| Some(Offer { give: (m[1].to_string(), m[2].parse().ok()?), get: (m[3].to_string(), m[4].parse().ok()?) }))
        .collect();
    if offers.is_empty() {
        return None;
    }
    Some(Trader { name: display_name(&names(digimon), &speaker[1]), offers })
}

/// (model, instance, position, facing) for every Digimon a stage script puts in the room.
pub fn placements(source: &str) -> Vec<(String, i64, [f64; 3], f64)> {
    place_re()
        .captures_iter(source)
        .filter_map(|m| {
            let f = |i: usize| m[i].parse::<f64>().ok();
            Some((m[1].to_string(), m[2].parse().ok()?, [f(3)?, f(4)?, f(5)?], f(6)?))
        })
        .collect()
}

/// The decompiled Lua scripts of a pack, by file name (`n_agumon_00h.lua`). Empty when the data is
/// not an object pack; scripts the decompiler cannot handle are left out.
pub fn scripts(data: &[u8]) -> HashMap<String, String> {
    let Ok(g) = Graph::new(data.to_vec()) else { return HashMap::new() };
    let mut out = HashMap::new();
    for (k, rec) in g.s2.iter().enumerate() {
        let Some(name) = rec.name.as_deref() else { continue };
        if rec.class != "beLuaData" || !name.ends_with(".lua") {
            continue;
        }
        let Some(obj) = g.vals(k).get(1).and_then(|v| g.r#ref(v)) else { continue };
        let vals = g.vals(obj);
        let (Some(size), Some(memory)) = (vals.first().and_then(|v| v.int()), vals.get(1).and_then(|v| v.int())) else { continue };
        let (Ok(size), Ok(memory)) = (usize::try_from(size), usize::try_from(memory)) else { continue };
        let source = g
            .block(memory, size)
            .and_then(|chunk| luadec::parse_chunk(chunk, 0))
            .and_then(|(main, _size)| luadec::decompile_function_source(&main));
        if let Ok(source) = source {
            out.insert(name.to_string(), source);
        }
    }
    out
}

/// The scripts of one trade pack: its named trader scripts and every Lua chunk, decompiled.
pub struct PackScripts {
    pub files: HashMap<String, String>,
    pub chunks: Vec<String>,
}

/// The traders standing in a stage, sorted by name then instance.
pub fn extract(packs: &[Vec<u8>], digimon: &HashMap<String, String>) -> Vec<Placed> {
    let marker: &[u8] = b"g_TItemID";
    let scripted = packs.iter().filter(|data| data.windows(marker.len()).any(|w| w == marker)).map(|data| PackScripts {
        files: scripts(data),
        chunks: luadec::decompile_chunks(data).into_iter().map(|(_, source)| source).collect(),
    });
    extract_from(scripted, digimon)
}

/// `extract` over already decompiled trade packs, in pack order.
pub fn extract_from(packs: impl IntoIterator<Item = PackScripts>, digimon: &HashMap<String, String>) -> Vec<Placed> {
    let names = names(digimon);
    // (model, instance) -> where the first script to place it puts it; ordered like Python's sorted().
    let mut placed: BTreeMap<(String, i64), ([f64; 3], f64)> = BTreeMap::new();
    let mut files: HashMap<String, String> = HashMap::new();
    for pack in packs {
        files.extend(pack.files);
        for source in &pack.chunks {
            for (model, instance, position, facing) in placements(source) {
                placed.entry((model, instance)).or_insert((position, facing));
            }
        }
    }
    let mut out: Vec<Placed> = Vec::new();
    for ((model, instance), (position, facing)) in placed {
        let mut tables = Vec::new();
        for (difficulty, letter) in DIFFICULTY_LETTERS {
            let candidates = [format!("n_{model}_{instance:02}{letter}.lua"), format!("n_{model}_{instance:02}.lua")];
            if let Some(trader) = candidates.iter().find_map(|file| parse(files.get(file)?, digimon)) {
                tables.push((difficulty, trader.offers));
            }
        }
        if !tables.is_empty() {
            out.push(Placed { name: display_name(&names, &model), instance, position, facing, tables });
        }
    }
    out.sort_by(|a, b| (&a.name, a.instance).cmp(&(&b.name, b.instance)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = r#"g_SItemDB = 0
funcOpenMessage("talk", "n_agumon", "AO")
if be:SYSctlFlagFolder("IS", 11) == 1 then
    g_SItemDB = "impItem"
    g_SItemID = 11
    g_TItemDB = "weapon"
    g_TItemID = 10
elseif be:SYSctlDeviceFolder("IS", 0, "weapon", 85, 0, 0) == 1 then
    g_SItemDB = "weapon"
    g_SItemID = 85
    g_TItemDB = "armor2"
    g_TItemID = 12
else
    funcCloseMessage("talk", "n_agumon", "AO")
end
if g_SItemDB ~= 0 then
    be:DMsetLua("itemchange40.lua")
end
be:DMrun()"#;

    fn item(db: &str, id: i64) -> (String, i64) {
        (db.to_string(), id)
    }

    fn agumon() -> HashMap<String, String> {
        HashMap::from([("p_agumon".to_string(), "Agumon".to_string())])
    }

    #[test]
    fn a_trade_script_lists_what_you_give_and_get() {
        let t = parse(SOURCE, &agumon()).unwrap();
        assert_eq!(t.name, "Agumon");
        assert_eq!(
            t.offers,
            [
                Offer { give: item("impItem", 11), get: item("weapon", 10) },
                Offer { give: item("weapon", 85), get: item("armor2", 12) },
            ]
        );
    }

    #[test]
    fn other_scripts_are_not_traders() {
        let none = HashMap::new();
        assert_eq!(parse("funcOpenMessage(\"talk\", \"n_agumon\", \"AO\")\nbe:DMrun()", &none), None);
        assert_eq!(parse("g_SItemDB = \"weapon\"\ng_SItemID = 1\ng_TItemDB = \"weapon\"\ng_TItemID = 2", &none), None);
    }

    #[test]
    fn traders_without_a_playable_form_are_named() {
        assert_eq!(parse(&SOURCE.replace("n_agumon", "n_prmame"), &HashMap::new()).unwrap().name, "Mamemon");
        // Others fall back to Python's capitalize(), which also lowers the rest.
        assert_eq!(parse(&SOURCE.replace("n_agumon", "n_kaMEmon"), &HashMap::new()).unwrap().name, "Kamemon");
    }

    #[test]
    fn placements_give_model_instance_position_and_facing() {
        let src = concat!(
            "be:sd(\"MODELCTRL\", \"n_agumon\", 0, \"GENERATE\", \"V<-80,10,20>/V<0,90,0>\")\n",
            "be:sd(\"MODELCTRL\", \"n_girumon\", 1, \"GENERATE\", \"V<-240.5,10,-180>/V<0,-45,0>\")\n",
            "be:sd(\"MODELCTRL\", \"g_dreturngate\", 0, \"GENERATE\", \"V<0,10,-210>/V<0,0,0>\")",
        );
        assert_eq!(
            placements(src),
            [("agumon".to_string(), 0, [-80.0, 10.0, 20.0], 90.0), ("girumon".to_string(), 1, [-240.5, 10.0, -180.0], -45.0)]
        );
    }

    #[test]
    fn traders_get_their_tables_per_difficulty_and_are_sorted_by_name() {
        let pack = PackScripts {
            files: HashMap::from([
                ("n_agumon_01h.lua".to_string(), SOURCE.to_string()),
                ("n_prmame_00.lua".to_string(), SOURCE.replace("n_agumon", "n_prmame")),
            ]),
            chunks: vec![concat!(
                "be:sd(\"MODELCTRL\", \"n_prmame\", 0, \"GENERATE\", \"V<1,2,3>/V<0,45,0>\")\n",
                "be:sd(\"MODELCTRL\", \"n_agumon\", 1, \"GENERATE\", \"V<-80,10,20>/V<0,90,0>\")\n",
                "be:sd(\"MODELCTRL\", \"n_agumon\", 1, \"GENERATE\", \"V<0,0,0>/V<0,0,0>\")\n",
                "be:sd(\"MODELCTRL\", \"n_gabumon\", 0, \"GENERATE\", \"V<0,0,0>/V<0,0,0>\")",
            )
            .to_string()],
        };
        let out = extract_from([pack], &agumon());
        let summary: Vec<_> =
            out.iter().map(|t| (t.name.as_str(), t.instance, t.position, t.tables.iter().map(|(d, _)| *d).collect::<Vec<_>>())).collect();
        assert_eq!(
            summary,
            [("Agumon", 1, [-80.0, 10.0, 20.0], vec!["hard"]), ("Mamemon", 0, [1.0, 2.0, 3.0], vec!["normal", "hard", "veryhard"])]
        );
    }
}

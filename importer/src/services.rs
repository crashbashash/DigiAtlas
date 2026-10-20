//! Home Server services identified by following an NPC's dialogue to its service script.
use crate::trades;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::OnceLock;

fn calls() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"be:DMsetLua\("([^"]+\.lua)"\)"#).unwrap())
}

fn service(file: &str) -> Option<(&'static str, &'static str)> {
    Some(match file {
        "saveshop.lua" => ("Save Keeper", "Save your game."),
        "digilabshop.lua" => ("Digivolution", "Change to an unlocked Digimon form."),
        "xdatashop.lua" => ("Data Keeper", "Store and manage X-Data."),
        "bankshop.lua" => ("Bank", "Store and withdraw items."),
        "connoisseur.lua" => ("Appraiser", "Identify unidentified weapons, cores and boards."),
        "cardshop.lua" => ("Card Keeper", "Manage your collected cards."),
        "callshop.lua" => ("Multiplayer Reception", "Add players to your party."),
        "diskshop.lua" => ("Disk Shop", "Buy consumable disks."),
        "weaponshop.lua" => ("Weapon Shop", "Buy weapons."),
        "armorshop.lua" => ("Core & Board Shop", "Buy cores and sub boards."),
        "chipshop.lua" => ("Ability Chip Shop", "Buy ability chips."),
        "junkshop.lua" => ("Junk Shop", "Visit MetalEtemon's shop."),
        _ => return None,
    })
}

fn follow(
    file: &str,
    files: &HashMap<String, String>,
    seen: &mut HashSet<String>,
    out: &mut BTreeMap<&'static str, &'static str>,
) {
    if !seen.insert(file.into()) {
        return;
    }
    if let Some((label, description)) = service(file) {
        out.insert(label, description);
        return;
    }
    // These are the game's stable service entry scripts. A regional scene-reference failure
    // may hide the short wrapper; require its service implementation to remain readable.
    if !files.contains_key(file) {
        let target = match file {
            "bML01001.lua" => "cardshop.lua",
            "bML01002.lua" => "saveshop.lua",
            "bML01003.lua" => "xdatashop.lua",
            "bML01004.lua" => "digilabshop.lua",
            "bML01005.lua" => "bankshop.lua",
            "bML01006.lua" => "connoisseur.lua",
            "bML01007.lua" => "callshop.lua",
            "bML01008.lua" => "diskshop.lua",
            "bML01009.lua" => "weaponshop.lua",
            "bML01010.lua" => "armorshop.lua",
            "bML01011.lua" => "chipshop.lua",
            "bML01012.lua" => "junkshop.lua",
            _ => return,
        };
        if files.contains_key(target) {
            follow(target, files, seen, out);
        }
        return;
    }
    if let Some(source) = files.get(file) {
        for call in calls().captures_iter(source) {
            follow(&call[1], files, seen, out);
        }
    }
}

/// Only actual placements with a recognized service are exported; ambient dialogue is omitted.
pub fn extract(packs: &[Vec<u8>]) -> Vec<Value> {
    let mut files = HashMap::new();
    for data in packs {
        files.extend(named_scripts(data));
    }
    from_scripts(&files)
}

/// Some regional packs have scene references the graph reader cannot resolve. Lua records
/// can still be paired when the named record and bytecode have a unique matching size.
fn named_scripts(data: &[u8]) -> HashMap<String, String> {
    let named = trades::scripts(data);
    if !named.is_empty() {
        return named;
    }
    let Ok(dirs) = crate::igb::parse_directory(data) else {
        return named;
    };
    let mut records: Vec<_> = crate::igb::find_chains(data, &dirs, 0x800).into_iter().flatten().collect();
    records.sort_by_key(|r| r.off);
    let mut scripts = Vec::new();
    for pair in records.windows(2) {
        if pair[0].class != "beLuaData" || pair[1].class != "beLuaDataObject" || pair[0].end != pair[1].off {
            continue;
        }
        let Some(name) = pair[0].name.as_ref().filter(|n| n.ends_with(".lua")) else {
            continue;
        };
        let values: Vec<_> = pair[1].fields.iter().filter_map(|f| f.value.int()).collect();
        if values.len() == 2 {
            scripts.push((values[1], values[0], name.clone()));
        }
    }
    let chunks: Vec<_> = data
        .windows(4)
        .enumerate()
        .filter(|(_, w)| *w == b"\x1bLua")
        .filter_map(|(off, _)| crate::luadec::parse_chunk(data, off).ok())
        .collect();
    let mut out = HashMap::new();
    for (_, size, name) in &scripts {
        if scripts.iter().filter(|s| s.1 == *size).count() != 1 {
            continue;
        }
        let matching: Vec<_> = chunks.iter().filter(|c| c.1 as i64 == *size).collect();
        if matching.len() != 1 {
            continue;
        }
        if let Ok(source) = crate::luadec::decompile_function_source(&matching[0].0) {
            out.insert(name.clone(), source);
        }
    }
    out
}

fn from_scripts(files: &HashMap<String, String>) -> Vec<Value> {
    let mut placed = BTreeMap::new();
    // Placement comes from the entry script, rather than an arbitrary repeated cutscene.
    if let Some(start) = files.get("start.lua") {
        for (model, instance, position, facing) in trades::placements(start) {
            placed.entry((model, instance)).or_insert((position, facing));
        }
    }
    let mut out = Vec::new();
    for ((model, instance), (p, facing)) in placed {
        let mut roles = BTreeMap::new();
        follow(&format!("n_{model}_{instance:02}.lua"), files, &mut HashSet::new(), &mut roles);
        for (label, description) in roles {
            out.push(json!({"id":format!("{model}-{instance}-{label}"), "name": if model == "metete" {"MetalEtemon"} else {"Digi-Elf"}, "label":label, "description":description, "position":{"x":p[0],"y":p[1],"z":p[2]}, "facing":facing}));
        }
    }
    out.sort_by(|a, b| a["label"].as_str().cmp(&b["label"].as_str()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn follows_dialogue_deduplicates_placements_and_ignores_ambient_npcs_and_cycles() {
        let place = r#"be:sd("MODELCTRL", "n_digilfm", 0, "GENERATE", "V<10,20,30>/V<0,90,0>")"#;
        let files = HashMap::from([
            (
                "start.lua".into(),
                format!(
                    "{place}\n{place}\nbe:sd(\"MODELCTRL\", \"n_digilfm\", 1, \"GENERATE\", \"V<1,2,3>/V<0,0,0>\")"
                ),
            ),
            ("n_digilfm_00.lua".into(), "be:DMsetLua(\"dialogue.lua\")".into()),
            ("dialogue.lua".into(), "be:DMsetLua(\"n_digilfm_00.lua\")\nbe:DMsetLua(\"saveshop.lua\")".into()),
            ("n_digilfm_01.lua".into(), "be:DMsetLua(\"unknown.lua\")".into()),
        ]);
        let out = from_scripts(&files);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["label"], "Save Keeper");
        assert_eq!(out[0]["position"], json!({"x":10.0,"y":20.0,"z":30.0}));
        assert_eq!(out[0]["facing"], 90.0);
    }
}

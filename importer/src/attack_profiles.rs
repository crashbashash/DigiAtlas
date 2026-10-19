//! Normal melee hit counts from weapon sequence labels and all playable character packs.
//! Count damage-bearing actions before Atck01, not overlapping hitbox shapes.
use crate::{
    afs::Afs,
    database::{Cell, Tables},
    igb::{Graph, Record, Value},
    Result,
};
use std::collections::HashMap;

type ArchiveNames = HashMap<String, Vec<(String, i64)>>;
fn name(record: &Record) -> &str {
    record.name.as_deref().unwrap_or("").trim_end_matches('\0')
}
fn list(graph: &Graph, record: &Record, slot: &str) -> Result<Vec<usize>> {
    match record.field(slot).and_then(|v| graph.r#ref(v)) {
        Some(index) => Ok(graph
            .list_refs(index)
            .map_err(|e| {
                crate::Error(format!("{} {} {slot} -> {}: {e}", record.class, name(record), graph.class(index)))
            })?
            .into_iter()
            .flatten()
            .collect()),
        None => Ok(Vec::new()),
    }
}
fn pack(archive: &Afs, names: &ArchiveNames, model: &str) -> Result<Option<Graph>> {
    let entry = names
        .get(&format!("{model}.igb"))
        .and_then(|entries| entries.iter().find(|(archive, index)| archive == "NDMW.AFS" && *index >= 0));
    entry.map(|(_, index)| Graph::new(archive.entry(*index as usize)?)).transpose()
}
#[derive(Default)]
struct PhaseCount {
    hits: u32,
    pending: bool,
    ended: bool,
    ordinary: bool,
}

/// Only complete, ordinary damage branches are admitted; projectiles remain unknown.
fn phase_counts<'a>(commands: impl IntoIterator<Item = &'a Record>) -> HashMap<String, u32> {
    let mut labels = HashMap::<String, PhaseCount>::new();
    let mut current: Option<String> = None;
    for command in commands {
        let text = name(command);
        if command.class == "beModelCtrlLABEL" {
            current = Some(text.into());
            labels.insert(text.into(), PhaseCount { ordinary: true, ..Default::default() });
            continue;
        }
        let Some(state) = current.as_ref().and_then(|label| labels.get_mut(label)) else { continue };
        if state.ended {
            continue;
        }
        match command.class.as_str() {
            "beModelCtrlWCHECK" if text == "Atck01" => state.ended = true,
            "beModelCtrlHITBOX" => {
                let kind = command.field("slot3").and_then(Value::int).unwrap_or(-1);
                if kind == 10000 {
                    state.pending = true;
                // Kind 60000 is the initial talk/contact probe before TALKWF.
                } else if kind >= 0 && kind != 60000 {
                    state.ordinary = false;
                }
            }
            "beModelCtrlACTION" if state.pending => {
                state.hits += 1;
                state.pending = false;
            }
            _ => {}
        }
    }
    labels
        .into_iter()
        .filter_map(|(label, s)| {
            (s.ended && s.ordinary && !s.pending && s.hits > 0 && s.hits <= 16).then_some((label, s.hits))
        })
        .collect()
}
fn character_profiles(graph: &Graph, model: &str) -> Result<HashMap<String, u32>> {
    let Some(info) = graph.s2.iter().find(|r| r.class == "beModelCtrlInfo" && name(r) == model) else {
        return Ok(HashMap::new());
    };
    for data in list(graph, info, "slot5")? {
        let data = &graph.s2[data];
        if data.class != "beModelCtrlInfoDataSeq" {
            continue;
        }
        for sequence in list(graph, data, "slot4")? {
            let sequence = &graph.s2[sequence];
            if name(sequence) == "SQ_ATCK1" {
                let commands = list(graph, sequence, "slot3")?;
                return Ok(phase_counts(commands.iter().map(|&i| &graph.s2[i])));
            }
        }
    }
    Ok(HashMap::new())
}
fn weapon_label(graph: &Graph, model: &str) -> Result<Option<String>> {
    let Some(info) = graph.s2.iter().find(|r| r.class == "beWeaponInfo" && name(r) == model) else { return Ok(None) };
    for sequence in list(graph, info, "slot9")? {
        let sequence = &graph.s2[sequence];
        if sequence.class == "beWeaponSeqData" && name(sequence) == "SQ_ATCK1" {
            return Ok(sequence.field("slot3").and_then(Value::str).map(|s| s.trim_end_matches('\0').into()));
        }
    }
    Ok(None)
}
pub fn extract(archive: &Afs, names: &ArchiveNames, tables: &Tables) -> Result<HashMap<usize, u32>> {
    let forms = tables.get("shinka").map(Vec::as_slice).unwrap_or_default();
    if forms.len() < 16 {
        return Ok(HashMap::new());
    }
    let mut shared: Option<HashMap<String, u32>> = None;
    for form in forms.iter().take(16) {
        let Some(model) = form.get("MODEL_NAME").and_then(Cell::str) else { return Ok(HashMap::new()) };
        let Some(graph) = pack(archive, names, model)? else { return Ok(HashMap::new()) };
        let profile = character_profiles(&graph, model)?;
        if let Some(shared) = &mut shared {
            shared.retain(|label, count| profile.get(label) == Some(count));
        } else {
            shared = Some(profile);
        }
    }
    let shared = shared.unwrap_or_default();
    let mut models = HashMap::<String, Option<u32>>::new();
    let mut result = HashMap::new();
    for (id, weapon) in tables.get("weapon").map(Vec::as_slice).unwrap_or_default().iter().enumerate() {
        let Some(model) = weapon.get("MODEL").and_then(Cell::str) else { continue };
        let hits = if let Some(hits) = models.get(model) {
            *hits
        } else {
            let hits = match pack(archive, names, model)? {
                Some(graph) => weapon_label(&graph, model)?.and_then(|label| shared.get(&label).copied()),
                None => None,
            };
            models.insert(model.into(), hits);
            hits
        };
        if let Some(hits) = hits {
            result.insert(id, hits);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::igb::Field;
    fn command(class: &str, name: &str, kind: Option<i64>) -> Record {
        Record {
            off: 0,
            class: class.into(),
            class_index: 0,
            size: 0,
            name: Some(name.into()),
            fields: kind.map(|n| vec![Field { name: "slot3".into(), value: Value::Int(n), ty: 0 }]).unwrap_or_default(),
            end: 0,
        }
    }
    #[test]
    fn counts_phases_not_hitbox_shapes_and_stops_before_charge() {
        let commands = vec![
            command("beModelCtrlLABEL", "saber", None),
            command("beModelCtrlHITBOX", "Set", Some(60000)),
            command("beModelCtrlACTION", "TALKWF", None),
            command("beModelCtrlHITBOX", "Set", Some(10000)),
            command("beModelCtrlHITBOX", "Set", Some(10000)),
            command("beModelCtrlACTION", "VATCR1", None),
            command("beModelCtrlWCHECK", "Action", None),
            command("beModelCtrlHITBOX", "Set", Some(10000)),
            command("beModelCtrlACTION", "VATCR2", None),
            command("beModelCtrlWCHECK", "Atck01", None),
            command("beModelCtrlHITBOX", "Set", Some(20000)),
            command("beModelCtrlACTION", "KATCR1", None),
        ];
        assert_eq!(phase_counts(&commands).get("saber"), Some(&2));
    }
    #[test]
    fn incomplete_nonstandard_and_projectile_only_branches_are_not_guessed() {
        let commands = vec![
            command("beModelCtrlLABEL", "gun", None),
            command("beModelCtrlACTION", "VATCG1", None),
            command("beModelCtrlWCHECK", "Atck01", None),
            command("beModelCtrlLABEL", "other", None),
            command("beModelCtrlHITBOX", "Set", Some(20000)),
            command("beModelCtrlACTION", "OTHER", None),
            command("beModelCtrlWCHECK", "Atck01", None),
            command("beModelCtrlLABEL", "unfinished", None),
            command("beModelCtrlHITBOX", "Set", Some(10000)),
            command("beModelCtrlACTION", "VATC", None),
        ];
        assert!(phase_counts(&commands).is_empty());
    }
}

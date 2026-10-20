//! Route endpoints read from the boat's authored translation animation.
use crate::igb::{Graph, ListValue};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn boat_route(packs: &[Vec<u8>]) -> Option<(Vec<Value>, Vec<[f64; 3]>)> {
    for pack in packs {
        let Ok(g) = Graph::new(pack.clone()) else {
            continue;
        };
        let Some(scene) = g.s2.iter().position(|r| r.class == "igSceneInfo" && r.name.as_deref() == Some("r_boatz01"))
        else {
            continue;
        };
        let Some(root) = g.vals(scene).get(2).and_then(|v| g.r#ref(v)) else {
            continue;
        };
        let mut pending = vec![root];
        let mut seen = HashSet::new();
        while let Some(node) = pending.pop() {
            if !seen.insert(node) {
                continue;
            }
            if g.class(node) == "igTransform" && g.s2[node].name.as_deref() == Some("route00") {
                let points = (|| {
                    let sequence = g.vals(node).get(6).and_then(|v| g.r#ref(v))?;
                    if g.class(sequence) != "igTransformSequence1_5" {
                        return None;
                    }
                    let positions = g.vals(sequence).first().and_then(|v| g.r#ref(v))?;
                    if g.class(positions) != "igVec3fList" {
                        return None;
                    }
                    let positions: Vec<_> = g
                        .list_values(positions)
                        .ok()?
                        .into_iter()
                        .filter_map(|v| match v {
                            ListValue::Vec3(p) => Some(p),
                            _ => None,
                        })
                        .collect();
                    if positions.len() < 2 {
                        return None;
                    }
                    Some(positions)
                })();
                if let Some(points) = points {
                    let start = points[0];
                    let end = *points.last().unwrap();
                    let markers = [("boat-start", "Boat start", "The boat ride starts here.", start), ("boat-end", "Boat end", "The boat ride finishes here.", end)]
                        .into_iter().map(|(id,label,description,p)| json!({"id":id,"name":"Boat route","label":label,"description":description,"position":{"x":p[0],"y":p[1],"z":p[2]},"facing":0})).collect();
                    return Some((markers, points));
                }
            }
            if let Some(children) = g.vals(node).get(3).and_then(|v| g.r#ref(v)) {
                if g.class(children) == "igNodeList" {
                    pending.extend(g.list_refs(children).unwrap_or_default().into_iter().flatten());
                }
            }
        }
    }
    None
}

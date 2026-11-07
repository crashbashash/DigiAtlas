//! Authored doors and the script actions that open them. Alternatives remain separate;
//! a switch, an enemy callback and prerequisites within one alternative are all required.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::igb::Graph;
use crate::{scripts, trades};

macro_rules! re {
    ($pattern:literal) => {{
        static RE: OnceLock<Regex> = OnceLock::new();
        fn compile() -> Regex {
            Regex::new($pattern).unwrap()
        }
        RE.get_or_init(compile)
    }};
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Switch {
    pub id: String,
    pub label: String,
    pub position: Position,
    pub facing: f64,
    pub action: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub min_z: f64,
    pub max_z: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerArea {
    pub id: String,
    pub label: String,
    pub position: Position,
    pub bounds: AreaBounds,
    pub all_players: bool,
    pub event: String,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Item {
    pub category: String,
    pub id: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub areas: Vec<TriggerArea>,
    pub difficulties: Vec<String>,
    pub players: Vec<u8>,
    pub switches: Vec<Switch>,
    pub generators: Vec<String>,
    pub enemy_models: Vec<String>,
    pub items: Vec<Item>,
    pub conditions: Vec<String>,
    pub description: Option<String>,
    pub unresolved: bool,
}

impl Default for Activation {
    fn default() -> Self {
        Self {
            areas: vec![],
            difficulties: ["normal", "hard", "veryhard"].map(String::from).to_vec(),
            players: vec![1, 2, 3, 4],
            switches: vec![],
            generators: vec![],
            enemy_models: vec![],
            items: vec![],
            conditions: vec![],
            description: None,
            unresolved: false,
        }
    }
}

impl Activation {
    fn merge(mut self, other: &Self) -> Self {
        for area in &other.areas {
            if !self.areas.contains(area) {
                self.areas.push(area.clone());
            }
        }
        self.areas.sort_by(|a, b| a.id.cmp(&b.id));
        self.difficulties.retain(|d| other.difficulties.contains(d));
        self.players.retain(|p| other.players.contains(p));
        for switch in &other.switches {
            if !self.switches.contains(switch) {
                self.switches.push(switch.clone());
            }
        }
        self.generators.extend(other.generators.iter().cloned());
        self.enemy_models.extend(other.enemy_models.iter().cloned());
        self.items.extend(other.items.iter().cloned());
        self.conditions.extend(other.conditions.iter().cloned());
        self.generators.sort();
        self.generators.dedup();
        self.enemy_models.sort();
        self.enemy_models.dedup();
        self.items.sort();
        self.items.dedup();
        self.conditions.sort();
        self.conditions.dedup();
        self.switches.sort_by(|a, b| a.id.cmp(&b.id));
        self.unresolved |= other.unresolved;
        if self.description.is_none() {
            self.description.clone_from(&other.description);
        }
        self
    }

    fn meaningful(&self) -> bool {
        !self.areas.is_empty()
            || !self.switches.is_empty()
            || !self.generators.is_empty()
            || !self.enemy_models.is_empty()
            || !self.items.is_empty()
            || self.description.is_some()
            || !self.conditions.is_empty()
    }

    fn has_trigger(&self) -> bool {
        !self.areas.is_empty()
            || !self.switches.is_empty()
            || !self.generators.is_empty()
            || !self.enemy_models.is_empty()
            || !self.items.is_empty()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Door {
    pub id: String,
    pub label: String,
    pub model: String,
    pub instance: i64,
    pub position: Position,
    pub facing: f64,
    pub activations: Vec<Activation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlatformMovement {
    pub id: String,
    pub label: String,
    pub destination: Option<Position>,
    pub activations: Vec<Activation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Platform {
    #[serde(flatten)]
    pub placement: Door,
    pub movements: Vec<PlatformMovement>,
}

pub struct Mechanisms {
    pub doors: Vec<Door>,
    pub platforms: Vec<Platform>,
}

#[derive(Clone, Debug)]
struct Statement {
    text: String,
    conditions: Vec<String>,
    instances: HashMap<String, Vec<i64>>,
}

fn statements(source: &str) -> Vec<Statement> {
    let mut loops: Vec<(usize, String, Vec<i64>)> = Vec::new();
    let mut conditioned = scripts::statements(source);
    // Some scripts count joined controller slots instead of calling SYSgetPlayerNinzu.
    // Recognise the complete four-slot counting loop, not arbitrary local increments.
    let counters: Vec<_> = conditioned
        .iter()
        .filter_map(|(text, conditions)| {
            let increment = re!(r"^(local_\d+) = (local_\d+) \+ 1$").captures(text)?;
            if increment[1] != increment[2] {
                return None;
            }
            let joined = conditions
                .iter()
                .find_map(|c| re!(r"^be:SYSisJoinPlayer\((local_\d+)\) == 1$").captures(c).map(|m| m[1].to_string()))?;
            source.contains(&format!("for {joined} = 0, 3 do")).then(|| increment[1].to_string())
        })
        .collect();
    for (_, conditions) in &mut conditioned {
        for condition in conditions {
            *condition = re!(r"\blocal_\d+\b")
                .replace_all(condition, |m: &regex::Captures<'_>| {
                    if counters.iter().any(|c| c == &m[0]) { "be:SYSgetPlayerNinzu()" } else { &m[0] }.to_string()
                })
                .into_owned();
        }
    }
    let mut conditions = conditioned.into_iter();
    let mut next = conditions.next();
    let mut out = Vec::new();
    for line in source.lines() {
        let level = (line.len() - line.trim_start_matches(' ').len()) / 4;
        let text = line.trim();
        loops.retain(|(depth, _, _)| *depth < level);
        if let Some(m) = re!(r"^for (\w+) = (-?\d+), (-?\d+) do$").captures(text) {
            let lo = m[2].parse::<i64>().unwrap();
            let hi = m[3].parse::<i64>().unwrap();
            if hi >= lo && hi - lo < 64 {
                loops.push((level, m[1].into(), (lo..=hi).collect()));
            }
        }
        if next.as_ref().is_some_and(|(statement, _)| statement == text) {
            let (_, raw) = next.take().unwrap();
            out.push(Statement {
                text: text.into(),
                conditions: raw,
                instances: loops.iter().map(|(_, key, ids)| (key.clone(), ids.clone())).collect(),
            });
            next = conditions.next();
        }
    }
    out
}

fn quoted(s: &str) -> Option<&str> {
    s.strip_prefix('"')?.strip_suffix('"')
}

fn command(text: &str) -> Option<Vec<String>> {
    let m = re!(r"^be:(?:sd|DMsetSD)\((.*)\)$").captures(text)?;
    Some(scripts::split_args(&m[1]))
}

fn ids(text: &str, statement: &Statement) -> Vec<i64> {
    text.parse().ok().map(|n| vec![n]).or_else(|| statement.instances.get(text).cloned()).unwrap_or_default()
}

fn placement(args: &[String]) -> Option<(Position, f64)> {
    if args.len() < 5 || quoted(&args[3]) != Some("GENERATE") {
        return None;
    }
    let value = quoted(&args[4])?;
    let m = re!(r"V<(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)>/V<(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)>").captures(value)?;
    Some((Position { x: m[1].parse().ok()?, y: m[2].parse().ok()?, z: m[3].parse().ok()? }, m[5].parse().ok()?))
}

fn is_door(model: &str) -> bool {
    model.starts_with("g_")
        && (model.contains("door") || model.contains("gate") || model.contains("entryway"))
        && !model.contains("returngate")
        && !model.contains("gatesign")
        && !model.contains("traingate")
}

fn is_platform(model: &str) -> bool {
    model.starts_with("g_")
        && (model.contains("lift")
            || model.contains("movepass")
            || model.contains("movecell")
            || model.contains("movescaffold")
            || model == "g_upblockz04")
}

fn control_kind(model: &str) -> &'static str {
    if model.contains("button") {
        "Button"
    } else if model.contains("lever") {
        "Lever"
    } else if model.contains("console") {
        "Control panel"
    } else if model.contains("trapbox") {
        "Trap box"
    } else {
        "Switch"
    }
}

fn opening(verb: &str) -> bool {
    matches!(verb, "SQ_SWON" | "SQ_OPEN" | "SQ_POWERON" | "SQ_SILENTON" | "SQ_DEAD02" | "SQ_ERAS")
        || verb.starts_with("SQ_SWON0")
}

fn product(left: Vec<Activation>, right: &[Activation]) -> Vec<Activation> {
    let mut out = Vec::new();
    for a in &left {
        for b in right {
            let merged = a.clone().merge(b);
            if !merged.difficulties.is_empty() && !merged.players.is_empty() && !out.contains(&merged) {
                out.push(merged);
                if out.len() == 64 {
                    return out;
                }
            }
        }
    }
    out
}

/// Strip only a balanced outer pair, so function arguments retain their parentheses.
fn unparen(mut s: &str) -> &str {
    while s.starts_with('(') && s.ends_with(')') {
        let mut depth = 0;
        let mut outer = true;
        for (i, c) in s.char_indices() {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
            }
            if depth == 0 && i + 1 < s.len() {
                outer = false;
                break;
            }
        }
        if !outer {
            break;
        }
        s = s[1..s.len() - 1].trim();
    }
    s
}

fn split_boolean<'a>(text: &'a str, op: &str) -> Vec<&'a str> {
    let mut depth = 0;
    let mut quote = false;
    let mut start = 0;
    let mut parts = Vec::new();
    for (i, c) in text.char_indices() {
        if c == '"' {
            quote = !quote;
        }
        if quote {
            continue;
        }
        if c == '(' {
            depth += 1;
        } else if c == ')' {
            depth -= 1;
        }
        if depth == 0 && text[i..].starts_with(op) {
            parts.push(text[start..i].trim());
            start = i + op.len();
        }
    }
    parts.push(text[start..].trim());
    parts
}

/// Evaluate only the callback's instance checks. Other runtime conditions stay unknown, so an
/// unknown side of an OR cannot incorrectly exclude a possible control instance.
fn instance_condition(raw: &str, instance: i64) -> Option<bool> {
    let condition = unparen(raw.trim());
    for (operator, decisive) in [(" or ", true), (" and ", false)] {
        let parts = split_boolean(condition, operator);
        if parts.len() > 1 {
            let mut unknown = false;
            for part in parts {
                match instance_condition(part, instance) {
                    Some(value) if value == decisive => return Some(decisive),
                    None => unknown = true,
                    _ => {}
                }
            }
            return (!unknown).then_some(!decisive);
        }
    }
    if let Some(inner) = condition.strip_prefix("not ") {
        return instance_condition(inner, instance).map(|value| !value);
    }
    // Some decompiled callbacks retain spurious getter arguments. They still refer to the
    // current callback instance, including nested MDLgetRamNo calls in Battle Arena.
    let comparison = re!(r"^be:MDLgetRamNo\(.*\)\s*(==|~=|<=|>=|<|>)\s*(-?\d+)$").captures(condition)?;
    let value = comparison[2].parse::<i64>().ok()?;
    Some(match &comparison[1] {
        "==" => instance == value,
        "~=" => instance != value,
        "<=" => instance <= value,
        ">=" => instance >= value,
        "<" => instance < value,
        _ => instance > value,
    })
}

fn instance_allowed(conditions: &[String], instance: i64) -> bool {
    conditions.iter().all(|condition| instance_condition(condition, instance) != Some(false))
}

type ScriptConditions = (String, Vec<String>);

struct Analysis {
    areas: HashMap<String, TriggerArea>,
    files: BTreeMap<String, Vec<Statement>>,
    placements: BTreeMap<(String, i64), (Position, f64)>,
    setters: HashMap<String, Vec<ScriptConditions>>,
    callers: HashMap<String, Vec<ScriptConditions>>,
    callbacks: HashMap<String, Vec<String>>,
    meanings: HashMap<i64, String>,
    powered_controls: BTreeMap<(String, i64), Vec<ScriptConditions>>,
    held_controls: HashSet<String>,
}

impl Analysis {
    fn base(&self, file: &str, conditions: &[String]) -> Vec<Activation> {
        let mut out = Activation::default();
        if let Some(names) = self.callbacks.get(file) {
            out.generators = names.clone();
        } else if let Some((model, broken)) =
            file.strip_prefix("ded_").and_then(|s| s.strip_suffix(".lua")).map(|model| (model, false)).or_else(|| {
                re!(r"^br\d+_(g_\w+)\.lua$").captures(file).map(|m| (&file[m.get(1).unwrap().range()], true))
            })
        {
            if model.starts_with("e_") || model.starts_with("f_") {
                out.enemy_models.push(model.into());
            } else if model.starts_with("g_") {
                let label = if model.contains("dktower") || model.contains("darktower") {
                    "Dark Tower"
                } else if model.contains("ctower") {
                    "Control tower"
                } else {
                    "Destructible object"
                };
                for ((name, id), (position, facing)) in &self.placements {
                    if name == model && instance_allowed(conditions, *id) {
                        out.switches.push(Switch {
                            id: format!("{name}:{id}"),
                            label: if label == "Control tower" {
                                re!(r"ctower(\d+)")
                                    .captures(name)
                                    .and_then(|m| m[1].parse::<u32>().ok())
                                    .map_or_else(|| label.into(), |n| format!("{label} {n}"))
                            } else {
                                label.into()
                            },
                            position: position.clone(),
                            facing: *facing,
                            action: if broken { "break" } else { "destroy" }.into(),
                        });
                    }
                }
            }
        } else if let Some(model) = file.strip_prefix("hit_").and_then(|s| s.strip_suffix(".lua")) {
            let label = control_kind(model);
            for ((name, id), (position, facing)) in &self.placements {
                if name == model && instance_allowed(conditions, *id) {
                    // Some party-size branches use different button models in the same
                    // physical control slot. Their shared action is one requirement.
                    let alias = self
                        .placements
                        .iter()
                        .find(|((other, number), (p, _))| {
                            label != "Switch" && number == id && p == position && control_kind(other) == label
                        })
                        .map(|((other, _), _)| other)
                        .unwrap_or(name);
                    out.switches.push(Switch {
                        id: format!("{alias}:{id}"),
                        label: format!("{label} {}", id + 1),
                        position: position.clone(),
                        facing: *facing,
                        action: if self.held_controls.contains(model) { "hold" } else { "activate" }.into(),
                    });
                }
            }
            if out.switches.is_empty() {
                out.description = Some("Interact with the linked mechanism.".into());
                out.unresolved = true;
            }
        } else if let Some(area) = self.areas.get(file) {
            let mut area = area.clone();
            let check = conditions.iter().rev().find_map(|raw| {
                let raw = unparen(raw.trim());
                let (inner, negated) = raw.strip_prefix("not ").map_or((raw, false), |s| (unparen(s), true));
                if split_boolean(inner, " or ").len() > 1 || negated && split_boolean(inner, " and ").len() > 1 {
                    return None;
                }
                split_boolean(inner, " and ").into_iter().find_map(|part| {
                    let m = re!(r"^be:MATis(All)?Player\(\)\s*(==|~=)\s*([01])$").captures(unparen(part))?;
                    let inside = ((&m[2] == "==") == (&m[3] != "0")) != negated;
                    Some((m.get(1).is_some(), !inside))
                })
            });
            let Some((all_players, leaves)) = check else {
                return vec![Activation { unresolved: true, ..Default::default() }];
            };
            area.all_players = all_players;
            area.event = if leaves { "leave" } else { "enter" }.into();
            area.label = if leaves {
                format!("Reset {}", area.label.to_lowercase())
            } else if area.all_players {
                format!("Party {}", area.label.to_lowercase())
            } else {
                area.label
            };
            out.areas.push(area);
        }
        if out.switches.len() > 1 {
            return out
                .switches
                .iter()
                .map(|switch| Activation { switches: vec![switch.clone()], ..out.clone() })
                .collect();
        }
        vec![out]
    }

    fn resolve(&self, file: &str, conditions: &[String], seen: &HashSet<String>, depth: usize) -> Vec<Activation> {
        if depth > 24 {
            return vec![Activation { unresolved: true, ..Default::default() }];
        }
        let mut out = self.base(file, conditions);
        if let Some(model) = file.strip_prefix("hit_").and_then(|s| s.strip_suffix(".lua")) {
            // A pressure button cannot be held until its power-on script has enabled it.
            // Unused party slots are completed automatically by that same script.
            if self.held_controls.contains(model) {
                out = out
                    .into_iter()
                    .flat_map(|base| {
                        let Some(id) = base.switches.first().and_then(|s| s.id.rsplit(':').next()?.parse::<i64>().ok())
                        else {
                            return vec![base];
                        };
                        let key = format!("power:{model}:{id}");
                        let Some(enablers) =
                            self.powered_controls.get(&(model.into(), id)).filter(|_| !seen.contains(&key))
                        else {
                            return vec![base];
                        };
                        let mut visited = seen.clone();
                        visited.insert(key);
                        let enabled: Vec<_> = enablers
                            .iter()
                            .flat_map(|(file, conditions)| self.resolve(file, conditions, &visited, depth + 1))
                            .collect();
                        product(vec![base], &enabled)
                    })
                    .collect();
            }
        }
        if out.iter().all(|base| !base.meaningful()) {
            if let Some(callers) = self.callers.get(file) {
                let mut paths = Vec::new();
                for (caller, raw) in callers {
                    let key = format!("call:{caller}->{file}");
                    if seen.contains(&key) {
                        continue;
                    }
                    let mut visited = seen.clone();
                    visited.insert(key);
                    paths.extend(self.resolve(caller, raw, &visited, depth + 1));
                }
                if !paths.is_empty() {
                    out = paths;
                }
            }
        }
        for c in conditions {
            out = product(out, &self.condition(c, seen, depth + 1));
        }
        out
    }

    fn condition(&self, raw: &str, seen: &HashSet<String>, depth: usize) -> Vec<Activation> {
        let c = unparen(raw.trim());
        if let Some(inner) = c.strip_prefix("not ") {
            let inner = unparen(inner);
            let any = split_boolean(inner, " or ");
            if any.len() > 1 {
                return any.into_iter().fold(vec![Activation::default()], |out, c| {
                    product(out, &self.condition(&format!("not ({c})"), seen, depth + 1))
                });
            }
            let all = split_boolean(inner, " and ");
            if all.len() > 1 {
                return all
                    .into_iter()
                    .flat_map(|c| self.condition(&format!("not ({c})"), seen, depth + 1))
                    .take(64)
                    .collect();
            }
            if let Some(m) = re!(r"^(.*?)(==|~=|<=|>=|<|>)\s*(\d+)$").captures(inner) {
                let op = match &m[2] {
                    "==" => "~=",
                    "~=" => "==",
                    "<=" => ">",
                    ">=" => "<",
                    "<" => ">=",
                    _ => "<=",
                };
                return self.condition(&format!("{}{} {}", &m[1], op, &m[3]), seen, depth + 1);
            }
        }
        if let Some(m) = re!(r"^be:(SYSgetDifficulty|SYSgetPlayerNinzu)\(\)\s*(==|~=|<=|>=|<|>)\s*(\d+)$").captures(c) {
            let n = m[3].parse::<i64>().unwrap();
            let matches = |value: i64| match &m[2] {
                "==" => value == n,
                "~=" => value != n,
                "<=" => value <= n,
                ">=" => value >= n,
                "<" => value < n,
                _ => value > n,
            };
            let mut out = Activation::default();
            if &m[1] == "SYSgetDifficulty" {
                out.difficulties = ["normal", "hard", "veryhard"]
                    .into_iter()
                    .enumerate()
                    .filter(|(i, _)| matches(*i as i64))
                    .map(|(_, d)| d.into())
                    .collect();
            } else {
                out.players.retain(|p| matches(*p as i64));
            }
            return vec![out];
        }
        let alternatives = split_boolean(c, " or ");
        if alternatives.len() > 1 {
            return alternatives.into_iter().flat_map(|c| self.condition(c, seen, depth + 1)).take(64).collect();
        }
        let all = split_boolean(c, " and ");
        if all.len() > 1 {
            return all
                .into_iter()
                .fold(vec![Activation::default()], |out, c| product(out, &self.condition(c, seen, depth + 1)));
        }
        if let Some(m) = re!(r"^((?:be:FLGisOn\(\d+\)\s*\+\s*)+be:FLGisOn\(\d+\))\s*(==|>=|>)\s*(\d+)$").captures(c) {
            let flags: Vec<_> = re!(r"be:FLGisOn\((\d+)\)").captures_iter(&m[1]).map(|f| f[1].to_string()).collect();
            let threshold = m[3].parse::<usize>().unwrap();
            let all_required = (&m[2] == "==" || &m[2] == ">=") && threshold == flags.len()
                || &m[2] == ">" && threshold + 1 == flags.len();
            if all_required {
                return flags.iter().fold(vec![Activation::default()], |out, flag| {
                    product(out, &self.condition(&format!("be:FLGisOn({flag}) == 1"), seen, depth + 1))
                });
            }
            if &m[2] == ">=" && threshold == 1 || &m[2] == ">" && threshold == 0 {
                return flags
                    .iter()
                    .flat_map(|flag| self.condition(&format!("be:FLGisOn({flag}) == 1"), seen, depth + 1))
                    .take(64)
                    .collect();
            }
            return vec![Activation {
                unresolved: true,
                conditions: vec!["An additional combination of event conditions applies.".into()],
                ..Default::default()
            }];
        }
        if let Some(m) = re!(r#"^be:SYSctlFlagFolder\("IS",\s*(\d+)\)\s*(==|~=)\s*(\d+)$"#).captures(c) {
            if (&m[2] == "==") == (&m[3] != "0") {
                return vec![Activation {
                    items: vec![Item { category: "impItem".into(), id: m[1].parse().unwrap() }],
                    ..Default::default()
                }];
            }
        }
        let flag = re!(r"^be:FLGisOn\((\d+)\)\s*(==|~=)\s*(\d+)$")
            .captures(c)
            .and_then(|m| ((&m[2] == "==") == (&m[3] != "0")).then(|| format!("flag:{}", &m[1])));
        let variable = re!(r"^(g_\w+)\s*==\s*(\d+)$").captures(c).map(|m| format!("{}={}", &m[1], &m[2]));
        if let Some(key) = flag.or(variable) {
            if depth > 24 {
                return vec![Activation { unresolved: true, ..Default::default() }];
            }
            if seen.contains(&key) {
                return vec![Activation::default()];
            }
            let mut visited = seen.clone();
            visited.insert(key.clone());
            if let Some(setters) = self.setters.get(&key) {
                let mut paths = Vec::new();
                for (file, conditions) in setters {
                    paths.extend(self.resolve(file, conditions, &visited, depth + 1));
                }
                paths.retain(|p| p.meaningful());
                if !paths.is_empty() {
                    return paths;
                }
            }
            let text =
                key.strip_prefix("flag:").and_then(|n| n.parse::<i64>().ok()).and_then(|n| self.meanings.get(&n));
            return vec![Activation {
                conditions: text.into_iter().map(|s| s.to_string()).collect(),
                unresolved: text.is_none(),
                ..Default::default()
            }];
        }
        // Runtime checks and one-time latches are not actions a player must perform.
        vec![Activation::default()]
    }
}

fn analyze_sources(
    sources: BTreeMap<String, String>,
    callbacks: HashMap<String, Vec<String>>,
    areas: HashMap<String, TriggerArea>,
) -> Analysis {
    let files: BTreeMap<_, _> = sources.iter().map(|(file, source)| (file.clone(), statements(source))).collect();
    let mut a = Analysis {
        areas,
        files,
        placements: BTreeMap::new(),
        setters: HashMap::new(),
        callers: HashMap::new(),
        callbacks,
        meanings: scripts::load_flag_names(),
        powered_controls: BTreeMap::new(),
        held_controls: HashSet::new(),
    };
    for (file, statements) in &a.files {
        let Some(model) = file.strip_prefix("off_").and_then(|s| s.strip_suffix(".lua")) else { continue };
        let Some(hit) = a.files.get(&format!("hit_{model}.lua")) else { continue };
        if statements.iter().any(|s| {
            re!(r"^(g_\w+) = 0$")
                .captures(&s.text)
                .is_some_and(|m| hit.iter().any(|s| s.text == format!("{} = 1", &m[1])))
        }) {
            a.held_controls.insert(model.into());
        }
    }
    for (file, statements) in &a.files {
        for statement in statements {
            if let Some(args) = command(&statement.text) {
                if args.len() >= 4 && quoted(&args[0]) == Some("MODELCTRL") {
                    if quoted(&args[3]) == Some("SQ_POWERON") {
                        if let Some(model) = quoted(&args[1]).filter(|m| a.held_controls.contains(*m)) {
                            for id in ids(&args[2], statement) {
                                a.powered_controls
                                    .entry((model.into(), id))
                                    .or_default()
                                    .push((file.clone(), statement.conditions.clone()));
                            }
                        }
                    }
                    if let (Some(model), Some((position, facing))) = (quoted(&args[1]), placement(&args)) {
                        for id in ids(&args[2], statement) {
                            a.placements.entry((model.into(), id)).or_insert((position.clone(), facing));
                        }
                    }
                }
            }
            let key = re!(r"^be:FLGset\((\d+),\s*1\)$")
                .captures(&statement.text)
                .map(|m| format!("flag:{}", &m[1]))
                .or_else(|| {
                    re!(r"^(g_\w+) = (\d+)$")
                        .captures(&statement.text)
                        .filter(|m| &m[2] != "0")
                        .map(|m| format!("{}={}", &m[1], &m[2]))
                });
            if let Some(key) = key {
                a.setters.entry(key).or_default().push((file.clone(), statement.conditions.clone()));
            }
            if let Some(m) = re!(r#"^be:DMsetLua\("([^"]+\.lua)"\)$"#).captures(&statement.text) {
                a.callers.entry(m[1].into()).or_default().push((file.clone(), statement.conditions.clone()));
            }
        }
    }
    a
}

fn doors_from_analysis(a: &Analysis) -> Vec<Door> {
    let mut doors = Vec::new();
    for ((model, instance), (position, facing)) in &a.placements {
        if !is_door(model) {
            continue;
        }
        let mut activations = Vec::new();
        for (file, statements) in &a.files {
            for statement in statements {
                let Some(args) = command(&statement.text) else { continue };
                if args.len() < 4
                    || quoted(&args[0]) != Some("MODELCTRL")
                    || quoted(&args[1]) != Some(model)
                    || !ids(&args[2], statement).contains(instance)
                    || !quoted(&args[3]).is_some_and(opening)
                {
                    continue;
                }
                let mut paths = a.resolve(file, &statement.conditions, &HashSet::new(), 0);
                for p in &mut paths {
                    if !p.meaningful() {
                        p.unresolved = true;
                    }
                    if !p.switches.is_empty() || !p.generators.is_empty() || !p.enemy_models.is_empty() {
                        p.description = None;
                    }
                    if !p.items.is_empty() && p.description.is_none() {
                        p.description = Some("Approach the door with the required key items.".into());
                    }
                }
                activations.extend(paths);
            }
        }
        if activations.iter().any(|p| p.meaningful() && !p.unresolved) {
            activations.retain(|p| p.meaningful());
        }
        let mut unique = Vec::new();
        for p in activations.into_iter().filter(|p| !p.difficulties.is_empty() && !p.players.is_empty()) {
            let p = Activation::default().merge(&p);
            if !unique.contains(&p) {
                unique.push(p);
            }
        }
        // An extra prerequisite cannot create another route when a simpler route already
        // suffices. Elseif negations commonly produce these redundant alternatives.
        let simpler = |a: &Activation, b: &Activation| {
            a.meaningful()
                && !a.unresolved
                && a.description == b.description
                && a.switches.iter().all(|s| b.switches.contains(s))
                && a.areas.iter().all(|s| b.areas.contains(s))
                && a.generators.iter().all(|s| b.generators.contains(s))
                && a.enemy_models.iter().all(|s| b.enemy_models.contains(s))
                && a.items.iter().all(|s| b.items.contains(s))
                && a.conditions.iter().all(|s| b.conditions.contains(s))
                && b.difficulties.iter().all(|d| a.difficulties.contains(d))
                && b.players.iter().all(|p| a.players.contains(p))
        };
        unique = unique
            .iter()
            .enumerate()
            .filter(|(i, p)| !unique.iter().enumerate().any(|(j, other)| i != &j && simpler(other, p)))
            .map(|(_, p)| p.clone())
            .collect();
        let label = if model.contains("entryway") {
            "Exit door"
        } else if model.contains("gate") {
            "Gate"
        } else {
            "Door"
        };
        doors.push(Door {
            id: format!("{model}:{instance}"),
            label: format!("{label} {}", doors.len() + 1),
            model: model.clone(),
            instance: *instance,
            position: position.clone(),
            facing: *facing,
            activations: unique,
        });
    }
    doors
}

pub fn from_sources(sources: BTreeMap<String, String>, callbacks: HashMap<String, Vec<String>>) -> Vec<Door> {
    doors_from_analysis(&analyze_sources(sources, callbacks, HashMap::new()))
}

fn movement_destination(args: &[String]) -> Option<Position> {
    if quoted(args.get(3)?) != Some("MOVETRANS") {
        return None;
    }
    let value = quoted(args.get(4)?)?;
    let m = re!(r"V<(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)>").captures(value)?;
    Some(Position { x: m[1].parse().ok()?, y: m[2].parse().ok()?, z: m[3].parse().ok()? })
}

fn platforms_from_analysis(a: &Analysis) -> Vec<Platform> {
    let mut out = Vec::new();
    for ((model, instance), (position, facing)) in &a.placements {
        if !is_platform(model) {
            continue;
        }
        // Moving-cell wall meshes are attached parts of the same platform.
        if let Some(base) = model.strip_suffix('w') {
            if a.placements.get(&(base.to_string(), *instance)).is_some_and(|(p, f)| p == position && f == facing) {
                continue;
            }
        }
        let mut movements: Vec<PlatformMovement> = Vec::new();
        for (file, statements) in &a.files {
            for statement in statements {
                let Some(args) = command(&statement.text) else { continue };
                if args.len() < 4
                    || quoted(&args[0]) != Some("MODELCTRL")
                    || quoted(&args[1]) != Some(model)
                    || !ids(&args[2], statement).contains(instance)
                {
                    continue;
                }
                let Some(verb) = quoted(&args[3]) else { continue };
                if !matches!(verb, "SQ_SWON" | "SQ_SWOF" | "MOVETRANS") {
                    continue;
                }
                let mut paths = a.resolve(file, &statement.conditions, &HashSet::new(), 0);
                // No animation is exported without a located control, trigger area,
                // enemy-completion callback or explicit key-item requirement.
                paths.retain(|p| p.has_trigger() && !p.difficulties.is_empty() && !p.players.is_empty());
                if paths.is_empty() {
                    continue;
                }
                let destination = movement_destination(&args);
                if verb == "MOVETRANS" && destination.is_none() {
                    continue;
                }
                let key = destination
                    .as_ref()
                    .map_or_else(|| verb.to_string(), |p| format!("{verb}:{},{},{}", p.x, p.y, p.z));
                let movement = if let Some(i) = movements.iter().position(|m| m.id == key) {
                    &mut movements[i]
                } else {
                    let label = if verb == "SQ_SWOF" {
                        "Return platform"
                    } else if destination.as_ref().is_some_and(|p| p.y > position.y) {
                        "Raise platform"
                    } else if destination.as_ref().is_some_and(|p| p.y < position.y) {
                        "Lower platform"
                    } else {
                        "Move platform"
                    };
                    movements.push(PlatformMovement { id: key, label: label.into(), destination, activations: vec![] });
                    movements.last_mut().unwrap()
                };
                for p in paths {
                    let p = Activation::default().merge(&p);
                    if !movement.activations.contains(&p) {
                        movement.activations.push(p);
                    }
                }
            }
        }
        if movements.is_empty() {
            continue;
        }
        let label = if model.contains("movepass") {
            "Moving bridge"
        } else if model == "g_upblockz04" {
            "Rising platform"
        } else if model.contains("lift") {
            "Lift"
        } else {
            "Moving platform"
        };
        let mut activations = Vec::new();
        for a in movements.iter().flat_map(|m| &m.activations) {
            if !activations.contains(a) {
                activations.push(a.clone());
            }
        }
        out.push(Platform {
            placement: Door {
                id: format!("{model}:{instance}"),
                label: label.into(),
                model: model.clone(),
                instance: *instance,
                position: position.clone(),
                facing: *facing,
                activations,
            },
            movements,
        });
    }
    // Lift arm panels share the main lift's origin and movement controller.
    // Keep unrelated co-located platforms separate.
    out.iter()
        .filter(|platform| {
            let Some(parts) = re!(r"^(g_lift\d+)[ab](z\d+)$").captures(&platform.placement.model) else { return true };
            let base = format!("{}{}", &parts[1], &parts[2]);
            !out.iter().any(|parent| {
                parent.placement.model == base
                    && parent.placement.instance == platform.placement.instance
                    && parent.placement.position == platform.placement.position
                    && parent.placement.facing == platform.placement.facing
                    && parent.movements == platform.movements
            })
        })
        .cloned()
        .collect()
}

fn trigger_areas(packs: &[Vec<u8>]) -> HashMap<String, TriggerArea> {
    let mut out = HashMap::new();
    for pack in packs {
        let Ok(g) = Graph::new(pack.clone()) else { continue };
        for (i, r) in g.s2.iter().enumerate() {
            if r.class != "beMatCtrlData" {
                continue;
            }
            let Some(name) = r.name.as_ref() else { continue };
            let Some(bbox) = g.vals(i).get(1).and_then(|v| g.r#ref(v)) else { continue };
            if g.class(bbox) != "igAABox" {
                continue;
            }
            let vals = g.vals(bbox);
            let (Some(lo), Some(hi)) = (vals.first().and_then(|v| v.floats()), vals.get(1).and_then(|v| v.floats()))
            else {
                continue;
            };
            if lo.len() != 3
                || hi.len() != 3
                || !(0..3).all(|i| lo[i].is_finite() && hi[i].is_finite() && lo[i] <= hi[i])
            {
                continue;
            }
            out.insert(
                format!("{name}.lua"),
                TriggerArea {
                    id: name.clone(),
                    label: format!("Trigger area {}", out.len() + 1),
                    position: Position { x: (lo[0] + hi[0]) / 2.0, y: (lo[1] + hi[1]) / 2.0, z: (lo[2] + hi[2]) / 2.0 },
                    bounds: AreaBounds {
                        min_x: lo[0],
                        max_x: hi[0],
                        min_y: lo[1],
                        max_y: hi[1],
                        min_z: lo[2],
                        max_z: hi[2],
                    },
                    all_players: false,
                    event: "enter".into(),
                },
            );
        }
    }
    out
}

pub fn extract(packs: &[Vec<u8>], difficulties: &serde_json::Value) -> Vec<Door> {
    extract_mechanisms(packs, difficulties).doors
}

pub fn extract_mechanisms(packs: &[Vec<u8>], difficulties: &serde_json::Value) -> Mechanisms {
    if !packs.iter().any(|pack| {
        [b"door".as_slice(), b"gate", b"entryway", b"lift", b"movepass", b"movecell", b"movescaffold", b"upblock"]
            .iter()
            .any(|word| pack.windows(word.len()).any(|w| w == *word))
    }) {
        return Mechanisms { doors: vec![], platforms: vec![] };
    }
    let mut sources = BTreeMap::new();
    for pack in packs {
        sources.extend(trades::scripts(pack));
    }
    let mut callbacks: HashMap<String, Vec<String>> = HashMap::new();
    for difficulty in difficulties.as_object().into_iter().flat_map(|d| d.values()) {
        for generator in difficulty["generators"].as_array().into_iter().flatten() {
            if let (Some(file), Some(name)) = (generator["lua"].as_str(), generator["name"].as_str()) {
                let names = callbacks.entry(file.into()).or_default();
                if !names.iter().any(|n| n == name) {
                    names.push(name.into());
                }
            }
        }
    }
    let a = analyze_sources(sources, callbacks, trigger_areas(packs));
    Mechanisms { doors: doors_from_analysis(&a), platforms: platforms_from_analysis(&a) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(sources: &[(&str, &str)], callbacks: &[(&str, &str)]) -> Vec<Door> {
        from_sources(
            sources.iter().map(|(name, text)| (name.to_string(), text.to_string())).collect(),
            callbacks.iter().map(|(file, name)| (file.to_string(), vec![name.to_string()])).collect(),
        )
    }

    const DOOR: &str = "be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"GENERATE\", \"V<10,20,30>/V<0,90,0>\")";

    #[test]
    fn enemy_callbacks_and_numeric_door_loops_are_linked() {
        let doors = read(
            &[
                (
                    "start.lua",
                    &format!("{DOOR}\nbe:sd(\"MODELCTRL\", \"g_d1door\", 1, \"GENERATE\", \"V<40,20,30>/V<0,0,0>\")"),
                ),
                (
                    "gene03.lua",
                    "for local_0 = 0, 1 do\n    be:sd(\"MODELCTRL\", \"g_d1door\", local_0, \"SQ_SWON\")\nend",
                ),
            ],
            &[("gene03.lua", "GENE-03")],
        );
        assert_eq!(doors.len(), 2);
        assert!(doors.iter().all(|d| d.activations[0].generators == ["GENE-03"]));
        assert_eq!(doors[0].position, Position { x: 10.0, y: 20.0, z: 30.0 });
        assert_eq!(doors[0].facing, 90.0);
    }

    #[test]
    fn two_enemy_group_latches_require_both_groups() {
        let doors = read(
            &[
                ("start.lua", DOOR),
                (
                    "gene00.lua",
                    "g_doneA = 1\nif g_doneB == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nend",
                ),
                (
                    "gene19.lua",
                    "g_doneB = 1\nif g_doneA == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nend",
                ),
            ],
            &[("gene00.lua", "GENE-00"), ("gene19.lua", "GENE-19")],
        );
        assert_eq!(doors[0].activations.len(), 1);
        assert_eq!(doors[0].activations[0].generators, ["GENE-00", "GENE-19"]);
    }

    #[test]
    fn elseif_switch_branches_keep_their_own_button_instances() {
        let start=format!("{DOOR}\nbe:sd(\"MODELCTRL\", \"g_d1door\", 1, \"GENERATE\", \"V<40,20,30>/V<0,0,0>\")\nbe:sd(\"MODELCTRL\", \"g_dbutton1\", 0, \"GENERATE\", \"V<100,20,30>/V<0,0,0>\")\nbe:sd(\"MODELCTRL\", \"g_dbutton1\", 1, \"GENERATE\", \"V<200,20,30>/V<0,0,0>\")");
        let doors=read(&[("start.lua",&start),("hit_g_dbutton1.lua","if be:MDLgetRamNo() == 0 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nelseif be:MDLgetRamNo() == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 1, \"SQ_SWON\")\nend")],&[]);
        assert_eq!(doors[0].activations[0].switches.len(), 1);
        assert_eq!(doors[1].activations[0].switches.len(), 1);
        assert_eq!(doors[0].activations[0].switches[0].id, "g_dbutton1:0");
        assert_eq!(doors[1].activations[0].switches[0].id, "g_dbutton1:1");
    }

    #[test]
    fn else_branches_exclude_earlier_hit_break_and_destruction_instances() {
        let mut start = String::new();
        for id in 0..3 {
            for model in ["g_d1door", "g_dbutton1"] {
                start += &format!(
                    "be:sd(\"MODELCTRL\", \"{model}\", {id}, \"GENERATE\", \"V<{},20,30>/V<0,0,0>\")\n",
                    id * 100
                );
            }
        }
        let callback = "if be:MDLgetRamNo() == 0 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nelseif be:MDLgetRamNo() == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 1, \"SQ_SWON\")\nelse\n    be:sd(\"MODELCTRL\", \"g_d1door\", 2, \"SQ_SWON\")\nend";
        for (file, action) in
            [("hit_g_dbutton1.lua", "activate"), ("ded_g_dbutton1.lua", "destroy"), ("br1_g_dbutton1.lua", "break")]
        {
            let doors = read(&[("start.lua", &start), (file, callback)], &[]);
            assert_eq!(doors.len(), 3);
            for (id, door) in doors.iter().enumerate() {
                assert_eq!(door.activations.len(), 1, "{file}: door {id}");
                let activation = &door.activations[0];
                assert_eq!(activation.switches.len(), 1, "{file}: door {id}");
                assert_eq!(activation.switches[0].id, format!("g_dbutton1:{id}"));
                assert_eq!(activation.switches[0].action, action);
            }
        }
    }

    #[test]
    fn inequality_guards_and_unknown_or_alternatives_keep_possible_instances() {
        let start = format!("{DOOR}\nbe:sd(\"MODELCTRL\", \"g_dbutton1\", 0, \"GENERATE\", \"V<100,20,30>/V<0,0,0>\")\nbe:sd(\"MODELCTRL\", \"g_dbutton1\", 1, \"GENERATE\", \"V<200,20,30>/V<0,0,0>\")");
        for condition in
            ["be:MDLgetRamNo() ~= 0", "not (be:MDLgetRamNo() == 0)", "be:MDLgetRamNo(be:MDLgetRamNo(), be) == 1"]
        {
            let callback = format!("if {condition} then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nend");
            let doors = read(&[("start.lua", &start), ("hit_g_dbutton1.lua", &callback)], &[]);
            assert_eq!(doors[0].activations.len(), 1);
            assert_eq!(doors[0].activations[0].switches[0].id, "g_dbutton1:1");
        }
        let callback = "if be:MDLgetRamNo() == 0 or be:MATisPlayer() == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nend";
        let doors = read(&[("start.lua", &start), ("hit_g_dbutton1.lua", callback)], &[]);
        assert_eq!(doors[0].activations.len(), 2);
        assert_eq!(
            doors[0].activations.iter().map(|a| a.switches[0].id.as_str()).collect::<Vec<_>>(),
            ["g_dbutton1:0", "g_dbutton1:1"]
        );
    }

    #[test]
    fn key_items_follow_the_flag_that_enables_the_door() {
        let doors=read(&[("start.lua",DOOR),("mate00.lua","if be:SYSctlFlagFolder(\"IS\", 9) == 1 and be:SYSctlFlagFolder(\"IS\", 10) == 1 then\n    be:FLGset(905, 1)\nend\nif be:FLGisOn(905) == 1 then\n    be:DMsetSD(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nend")],&[]);
        assert_eq!(doors[0].activations[0].items.iter().map(|item| item.id).collect::<Vec<_>>(), [9, 10]);
        assert!(!doors[0].activations[0].unresolved);
    }

    #[test]
    fn called_scripts_keep_item_prerequisites_and_difficulty_alternatives() {
        let doors=read(&[("start.lua",DOOR),("talk.lua","if be:SYSctlFlagFolder(\"IS\", 2) == 1 and be:SYSgetDifficulty() == 1 then\n    be:DMsetLua(\"demo.lua\")\nend"),("demo.lua","be:DMsetSD(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")")],&[]);
        assert_eq!(doors[0].activations[0].items[0].id, 2);
        assert_eq!(doors[0].activations[0].difficulties, ["hard"]);
    }

    #[test]
    fn item_alternatives_are_not_combined_into_a_false_conjunction() {
        let doors=read(&[("start.lua",DOOR),("mate00.lua","if be:SYSctlFlagFolder(\"IS\", 2) == 1 or be:SYSctlFlagFolder(\"IS\", 3) == 1 then\n    be:DMsetSD(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\nend")],&[]);
        assert_eq!(doors[0].activations.len(), 2);
        assert!(doors[0].activations.iter().all(|a| a.items.len() == 1));
    }

    #[test]
    fn unresolved_doors_and_transport_gates_are_not_mislabeled() {
        let doors = read(
            &[(
                "start.lua",
                &format!("{DOOR}\nbe:sd(\"MODELCTRL\", \"g_dreturngate\", 0, \"GENERATE\", \"V<40,20,30>/V<0,0,0>\")"),
            )],
            &[],
        );
        assert_eq!(doors.len(), 1);
        assert!(doors[0].activations.is_empty());
    }

    fn mechanisms(sources: &[(&str, &str)], areas: HashMap<String, TriggerArea>) -> Mechanisms {
        let a = analyze_sources(
            sources.iter().map(|(file, text)| (file.to_string(), text.to_string())).collect(),
            HashMap::new(),
            areas,
        );
        Mechanisms { doors: doors_from_analysis(&a), platforms: platforms_from_analysis(&a) }
    }

    const LIFT: &str = "be:sd(\"MODELCTRL\", \"g_lift01z01\", 0, \"GENERATE\", \"V<0,0,0>/V<0,0,0>\")";
    const LEVER: &str = "be:sd(\"MODELCTRL\", \"g_lever01z01\", 0, \"GENERATE\", \"V<40,0,0>/V<0,0,0>\")";

    fn area(id: &str) -> TriggerArea {
        TriggerArea {
            id: id.into(),
            label: "Trigger area 1".into(),
            position: Position { x: 10.0, y: 10.0, z: 10.0 },
            bounds: AreaBounds { min_x: 0.0, max_x: 20.0, min_y: 0.0, max_y: 20.0, min_z: 0.0, max_z: 20.0 },
            all_players: false,
            event: "enter".into(),
        }
    }

    #[test]
    fn excludes_train_models_and_platform_animations_without_triggers() {
        let start=format!("{LIFT}\nbe:sd(\"MODELCTRL\", \"g_lift01z01\", 0, \"SQ_SWON\")\nbe:sd(\"MODELCTRL\", \"g_traingatez02\", 0, \"GENERATE\", \"V<500,210,-320>/V<0,0,0>\")");
        let result = mechanisms(&[("start.lua", &start)], HashMap::new());
        assert!(result.doors.is_empty());
        assert!(result.platforms.is_empty());
    }

    #[test]
    fn lift_motion_is_linked_to_its_placed_lever() {
        let result = mechanisms(
            &[
                ("start.lua", &format!("{LIFT}\n{LEVER}")),
                ("hit_g_lever01z01.lua", "be:sd(\"MODELCTRL\", \"g_lift01z01\", 0, \"SQ_SWON\")"),
            ],
            HashMap::new(),
        );
        assert_eq!(result.platforms.len(), 1);
        let movement = &result.platforms[0].movements[0];
        assert_eq!(movement.activations[0].switches[0].id, "g_lever01z01:0");
        assert!(movement.activations.iter().all(Activation::has_trigger));
    }

    #[test]
    fn floor_area_entry_and_exit_control_different_movements() {
        let result = mechanisms(
            &[
                ("start.lua", LIFT),
                (
                    "matt01.lua",
                    "if be:MATisAllPlayer() == 1 then\n    be:sd(\"MODELCTRL\", \"g_lift01z01\", 0, \"SQ_SWON\")\nend",
                ),
                (
                    "matt02.lua",
                    "if be:MATisPlayer() ~= 1 then\n    be:sd(\"MODELCTRL\", \"g_lift01z01\", 0, \"SQ_SWOF\")\nend",
                ),
            ],
            [("matt01.lua".into(), area("matt01")), ("matt02.lua".into(), area("matt02"))].into(),
        );
        let movements = &result.platforms[0].movements;
        assert_eq!(movements.len(), 2);
        let entry = movements.iter().find(|m| m.id == "SQ_SWON").unwrap();
        let exit = movements.iter().find(|m| m.id == "SQ_SWOF").unwrap();
        assert!(entry.activations[0].areas[0].all_players);
        assert_eq!(entry.activations[0].areas[0].event, "enter");
        assert_eq!(exit.activations[0].areas[0].event, "leave");
        assert!(!exit.activations[0].areas[0].all_players);
    }

    #[test]
    fn unknown_floor_volume_does_not_create_a_platform_marker() {
        let result = mechanisms(
            &[
                ("start.lua", LIFT),
                (
                    "matt01.lua",
                    "if be:MATisPlayer() == 1 then\n    be:sd(\"MODELCTRL\", \"g_lift01z01\", 0, \"SQ_SWON\")\nend",
                ),
            ],
            HashMap::new(),
        );
        assert!(result.platforms.is_empty());
    }

    #[test]
    fn raising_a_platform_records_its_destination_and_control() {
        let start =
            format!("{LEVER}\nbe:sd(\"MODELCTRL\", \"g_upblockz04\", 2, \"GENERATE\", \"V<80,0,240>/V<0,0,0>\")");
        let result = mechanisms(
            &[
                ("start.lua", &start),
                (
                    "hit_g_lever01z01.lua",
                    "be:sd(\"MODELCTRL\", \"g_upblockz04\", 2, \"MOVETRANS\", \"V<80,20,240>/V<0,0,0>\")",
                ),
            ],
            HashMap::new(),
        );
        let movement = &result.platforms[0].movements[0];
        assert_eq!(movement.label, "Raise platform");
        assert_eq!(movement.destination.as_ref().unwrap().y, 20.0);
        assert_eq!(movement.activations[0].switches.len(), 1);
    }

    #[test]
    fn co_located_button_variants_form_one_two_button_requirement() {
        let mut start = DOOR.to_string();
        for model in ["g_dbutton1", "g_dbutton2"] {
            for id in 0..2 {
                start += &format!(
                    "\nbe:sd(\"MODELCTRL\", \"{model}\", {id}, \"GENERATE\", \"V<{},0,0>/V<0,0,0>\")",
                    50 + id * 20
                );
            }
        }
        let hit="if be:MDLgetRamNo() == 0 then\n    if be:FLGisOn(201) == 1 then\n        be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\n    end\n    be:FLGset(200, 1)\nelseif be:MDLgetRamNo() == 1 then\n    if be:FLGisOn(200) == 1 then\n        be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\n    end\n    be:FLGset(201, 1)\nend";
        let result = read(&[("start.lua", &start), ("hit_g_dbutton1.lua", hit), ("hit_g_dbutton2.lua", hit)], &[]);
        assert_eq!(result[0].activations.len(), 1);
        assert_eq!(result[0].activations[0].switches.len(), 2);
    }

    #[test]
    fn collective_enemy_clear_callbacks_require_all_groups_and_the_dark_tower() {
        let start = format!("{DOOR}\nbe:sd(\"MODELCTRL\", \"g_d2dktower\", 0, \"GENERATE\", \"V<100,0,0>/V<0,0,0>\")");
        let mut sources: BTreeMap<String, String> =
            [("start.lua".into(), start), ("ded_g_d2dktower.lua".into(), "be:FLGset(127, 1)".into())].into();
        let mut callbacks = HashMap::new();
        for (n, flag) in [106, 111, 112, 113].into_iter().enumerate() {
            let others = [106, 111, 112, 113]
                .into_iter()
                .filter(|f| *f != flag)
                .map(|f| format!("be:FLGisOn({f})"))
                .collect::<Vec<_>>()
                .join(" + ");
            let file = format!("gene{n:02}.lua");
            sources.insert(file.clone(),format!("if be:FLGisOn(127) == 1 then\n    be:FLGset({flag}, 1)\n    if {others} == 3 then\n        be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\n    end\nend"));
            callbacks.insert(file, vec![format!("GENE-{n:02}")]);
        }
        let doors = from_sources(sources, callbacks);
        assert_eq!(doors[0].activations.len(), 1);
        let activation = &doors[0].activations[0];
        assert_eq!(activation.generators, ["GENE-00", "GENE-01", "GENE-02", "GENE-03"]);
        assert_eq!(activation.switches.len(), 1);
        assert_eq!(activation.switches[0].action, "destroy");
        assert_eq!(activation.switches[0].label, "Dark Tower");
    }

    #[test]
    fn attached_lift_panels_are_one_platform_but_other_lifts_stay_separate() {
        let mut start = LEVER.to_string();
        let mut hit = String::new();
        for model in ["g_lift03z02", "g_lift03az02", "g_lift03bz02", "g_lift04z02"] {
            start += &format!("\nbe:sd(\"MODELCTRL\", \"{model}\", 0, \"GENERATE\", \"V<0,0,0>/V<0,0,0>\")");
            hit += &format!("be:sd(\"MODELCTRL\", \"{model}\", 0, \"SQ_SWON\")\n");
        }
        let result = mechanisms(&[("start.lua", &start), ("hit_g_lever01z01.lua", &hit)], HashMap::new());
        assert_eq!(result.platforms.len(), 2);
        assert!(result.platforms.iter().any(|p| p.placement.model == "g_lift03z02"));
        assert!(result.platforms.iter().any(|p| p.placement.model == "g_lift04z02"));
    }

    #[test]
    fn powered_pressure_buttons_follow_party_count_and_all_tower_prerequisites() {
        let mut start = format!(
            "{DOOR}\nif be:FLGisOn(55) == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SILENTON\")\nend"
        );
        let mut sources = BTreeMap::new();
        let mut setup = "if be:MATisPlayer() == 1 and be:FLGisOn(55) == 0 and be:FLGisOn(51) == 1 and be:FLGisOn(52) == 1 and be:FLGisOn(53) == 1 and be:FLGisOn(54) == 1 then\n    for local_1 = 0, 3 do\n        if be:SYSisJoinPlayer(local_1) == 1 then\n            local_0 = local_0 + 1\n        end\n    end\n".to_string();
        let mut hit = String::new();
        let mut off = String::new();
        for id in 0..4 {
            start +=
                &format!("\nbe:sd(\"MODELCTRL\", \"g_sbutton\", {id}, \"GENERATE\", \"V<{},0,0>/V<0,0,0>\")", id * 20);
            start += &format!(
                "\nbe:sd(\"MODELCTRL\", \"g_ctower0{}z02\", 0, \"GENERATE\", \"V<{},0,50>/V<0,0,0>\")",
                id + 1,
                id * 20
            );
            sources.insert(format!("br{}_g_ctower0{}z02.lua", id + 1, id + 1), format!("be:FLGset({}, 1)", 51 + id));
            hit += &format!("if be:MDLgetRamNo() == {id} then\n    g_button{id} = 1\nend\n");
            off += &format!("if be:MDLgetRamNo() == {id} then\n    g_button{id} = 0\nend\n");
        }
        for players in (1..=4).rev() {
            setup += &format!("    {} local_0 == {players} then\n", if players == 4 { "if" } else { "elseif" });
            for id in 0..4 {
                let sequence = if id < players { "SQ_POWERON" } else { "SQ_ONLOOP" };
                setup += &format!("        be:sd(\"MODELCTRL\", \"g_sbutton\", {id}, \"{sequence}\")\n");
                if id >= players {
                    setup += &format!("        g_button{id} = 1\n");
                }
            }
        }
        setup += "    end\nend";
        hit += "if be:FLGisOn(55) == 0 and g_button0 == 1 and g_button1 == 1 and g_button2 == 1 and g_button3 == 1 then\n    be:sd(\"MODELCTRL\", \"g_d1door\", 0, \"SQ_SWON\")\n    be:FLGset(55, 1)\nend";
        sources.insert("start.lua".into(), start);
        sources.insert("maty00.lua".into(), setup);
        sources.insert("hit_g_sbutton.lua".into(), hit);
        sources.insert("off_g_sbutton.lua".into(), off);
        let a = analyze_sources(sources, HashMap::new(), [("maty00.lua".into(), area("maty00"))].into());
        let doors = doors_from_analysis(&a);
        for players in 1..=4 {
            let paths: Vec<_> = doors[0].activations.iter().filter(|a| a.players.contains(&players)).collect();
            assert_eq!(paths.len(), 1, "party {players}: {paths:#?}");
            assert!(!paths[0].unresolved, "party {players}: {paths:#?}");
            assert_eq!(paths[0].switches.iter().filter(|s| s.action == "hold").count(), players as usize);
            assert_eq!(paths[0].switches.iter().filter(|s| s.action == "break").count(), 4);
            assert_eq!(paths[0].areas.len(), 1);
        }
    }
}

//! Train Line's controls and shortest successful rail journey, read from Lua and animation data.
use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{
    doors::Position,
    igb::{Graph, ListValue},
    luadec::{self, Function},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Control {
    pub id: String,
    pub model: String,
    pub instance: i64,
    pub label: String,
    pub junction: u8,
    pub choice: String,
    pub position: Position,
    pub facing: f64,
    pub preview: Vec<[f64; 3]>,
    pub preview_destination: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub control_id: String,
    pub instruction: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journey {
    pub controls: Vec<Control>,
    pub steps: Vec<Step>,
    pub points: Vec<[f64; 3]>,
    pub rail_frames: f64,
    pub destination: String,
}

#[derive(Clone, Debug, PartialEq)]
enum Value {
    Nil,
    Int(i64),
    Text(String),
    Method(String),
    Receiver,
}
impl Value {
    fn text(&self) -> Option<&str> {
        if let Self::Text(s) = self {
            Some(s)
        } else {
            None
        }
    }
    fn int(&self) -> Option<i64> {
        if let Self::Int(n) = self {
            Some(*n)
        } else {
            None
        }
    }
}

#[derive(Clone, Default)]
struct Machine {
    globals: HashMap<String, Value>,
    calls: Vec<(String, Vec<Value>)>,
    inside: bool,
    instance: i64,
}

impl Machine {
    fn set(&mut self, name: &str, n: i64) {
        self.globals.insert(name.into(), Value::Int(n));
    }
    fn get(&self, name: &str) -> i64 {
        self.globals.get(name).and_then(Value::int).unwrap_or(0)
    }

    // A bounded interpreter for the train's small control callbacks. Unsupported operations fail
    // closed. Running their original bytecode preserves the entry/exit split and branch targets.
    fn run(&mut self, function: &Function) -> Option<()> {
        let mut stack: Vec<Value> = Vec::new();
        let mut pc = 0usize;
        for _ in 0..4096 {
            let word = *function.code.get(pc)?;
            let op = word & 63;
            let u = word >> 6;
            let signed = u as i64 - ((1 << 25) - 1);
            let string = || function.kstr.get(u as usize)?.as_ref().cloned();
            let mut jump = false;
            match op {
                0 | 1 => return Some(()),
                2 => {
                    let at = (word >> 15) as usize;
                    let results = (word >> 6) & 511;
                    let callee = stack.get(at)?.clone();
                    let args = stack.get(at + 1..)?.to_vec();
                    stack.truncate(at);
                    let Value::Method(method) = callee else { return None };
                    let args = args.get(1..)?.to_vec();
                    let result = match method.as_str() {
                        "MATisPlayer" | "MATisAllPlayer" => Value::Int(i64::from(self.inside)),
                        "MDLgetRamNo" => Value::Int(self.instance),
                        "DMgetCount" => Value::Int(0),
                        "MDLsetDMGTurn" | "MDLsetSeq" | "sd" => {
                            self.calls.push((method, args));
                            Value::Nil
                        }
                        _ => return None,
                    };
                    if results == 1 {
                        stack.push(result);
                    } else if results != 0 {
                        return None;
                    }
                }
                4 => stack.extend((0..=u).map(|_| Value::Nil)),
                5 => stack.truncate(stack.len().checked_sub(u as usize)?),
                6 => stack.push(Value::Int(signed)),
                7 => stack.push(Value::Text(string()?)),
                12 => {
                    let name = string()?;
                    stack.push(if name == "be" {
                        Value::Receiver
                    } else {
                        self.globals.get(&name).cloned().unwrap_or(Value::Int(0))
                    });
                }
                16 => {
                    if stack.pop()? != Value::Receiver {
                        return None;
                    }
                    stack.push(Value::Method(string()?));
                    stack.push(Value::Receiver);
                }
                19 => {
                    self.globals.insert(string()?, stack.pop()?);
                }
                32..=37 => {
                    let right = stack.pop()?;
                    let left = stack.pop()?;
                    jump = match op {
                        32 => left != right,
                        33 => left == right,
                        34 => left.int()? < right.int()?,
                        35 => left.int()? <= right.int()?,
                        36 => left.int()? > right.int()?,
                        _ => left.int()? >= right.int()?,
                    };
                }
                38 | 39 => {
                    let truthy = stack.pop()? != Value::Nil;
                    jump = if op == 38 { truthy } else { !truthy };
                }
                42 => jump = true,
                _ => return None,
            }
            pc = usize::try_from(pc as i64 + 1 + if jump { signed } else { 0 }).ok()?;
        }
        None
    }
}

#[derive(Clone, Debug)]
struct Command {
    kind: String,
    name: String,
    target: Option<String>,
}
#[derive(Clone, Debug)]
struct Rail {
    label: String,
    action: String,
    next: Option<String>,
    frames: f64,
}
#[derive(Clone, Debug)]
struct Motion {
    ranges: Vec<(f64, f64)>,
    loops: bool,
}

type Keys<const N: usize> = Vec<(f64, [f64; N])>;

struct TrainTrack {
    position: Keys<3>,
    rotation: Keys<4>,
    offset: Keys<3>,
}

fn commands(g: &Graph, object: usize) -> Option<Vec<Command>> {
    let list = g.vals(object).get(1).and_then(|v| g.r#ref(v))?;
    g.list_refs(list)
        .ok()?
        .into_iter()
        .flatten()
        .map(|i| {
            Some(Command {
                kind: g.class(i).into(),
                name: g.s2[i].name.clone()?,
                target: g.vals(i).get(1).and_then(|v| v.str()).map(str::to_string),
            })
        })
        .collect()
}

fn programs(g: &Graph) -> BTreeMap<String, Function> {
    g.s2.iter()
        .enumerate()
        .filter_map(|(i, record)| {
            let name = record.name.as_ref()?;
            if record.class != "beLuaData"
                || !(name.starts_with("mate")
                    || name.starts_with("hit_g_turn")
                    || name == "hit_g_gatesign.lua"
                    || name == "matz00.lua")
            {
                return None;
            }
            let data = g.vals(i).get(1).and_then(|v| g.r#ref(v))?;
            let vals = g.vals(data);
            let size = usize::try_from(vals.first()?.int()?).ok()?;
            let memory = usize::try_from(vals.get(1)?.int()?).ok()?;
            let (function, _) = luadec::parse_chunk(g.block(memory, size).ok()?, 0).ok()?;
            Some((name.clone(), function))
        })
        .collect()
}

fn placed(args: &[Value]) -> Option<(String, i64, Position, f64)> {
    if args.first()?.text()? != "MODELCTRL" || args.get(3)?.text()? != "GENERATE" {
        return None;
    }
    let text = args.get(4)?.text()?;
    let mut parts = text.split('/');
    let vector = |s: &str| -> Option<Vec<f64>> {
        s.strip_prefix("V<")?.strip_suffix('>')?.split(',').map(|n| n.parse().ok()).collect()
    };
    let p = vector(parts.next()?)?;
    let facing = vector(parts.next()?)?;
    Some((
        args.get(1)?.text()?.into(),
        args.get(2)?.int()?,
        Position { x: *p.first()?, y: *p.get(1)?, z: *p.get(2)? },
        *facing.get(1)?,
    ))
}

fn motion(g: &Graph, i: usize) -> Option<Motion> {
    let list = g.vals(i).get(1).and_then(|v| g.r#ref(v))?;
    let mut out = Motion { ranges: vec![], loops: false };
    for component in g.list_refs(list).ok()?.into_iter().flatten() {
        if g.class(component) != "beAction2JOINTSET" {
            continue;
        }
        let vals = g.vals(component);
        let start = vals.get(1)?.float()?;
        let end = vals.get(2)?.float()?;
        if !start.is_finite() || !end.is_finite() || end < start {
            return None;
        }
        out.ranges.push((start, end));
        out.loops |= vals.get(3)?.str()?.starts_with('L');
    }
    (!out.ranges.is_empty()).then_some(out)
}

fn rail_graph(
    controllers: &BTreeMap<String, Vec<Command>>,
    motions: &BTreeMap<String, Motion>,
) -> BTreeMap<String, Vec<Rail>> {
    controllers
        .iter()
        .filter(|(name, _)| name.starts_with("SQ_RAIL"))
        .map(|(name, commands)| {
            let mut rails = Vec::new();
            let mut label = "start".to_string();
            let mut action = None;
            for command in commands.iter().chain(std::iter::once(&Command {
                kind: "end".into(),
                name: String::new(),
                target: None,
            })) {
                if command.kind == "beModelCtrlLABEL" || command.kind == "beModelCtrlJUMP" || command.kind == "end" {
                    if let Some(action) = action.take() {
                        if let Some(motion) = motions.get(&action).filter(|m| !m.loops) {
                            rails.push(Rail {
                                label: label.clone(),
                                action,
                                next: (command.kind == "beModelCtrlJUMP").then(|| command.name.clone()),
                                frames: motion.ranges.iter().map(|(start, end)| end - start + 1.0).sum(),
                            });
                        }
                    }
                    if command.kind == "beModelCtrlLABEL" {
                        label.clone_from(&command.name);
                    }
                } else if command.kind == "beModelCtrlACTION" {
                    action = Some(command.name.clone());
                }
            }
            (name.clone(), rails)
        })
        .collect()
}

fn shortest(graph: &BTreeMap<String, Vec<Rail>>, goal: &str) -> Option<Vec<(String, Rail)>> {
    let mut pending = vec![(0.0_f64, "SQ_RAIL00".to_string(), Vec::new())];
    let mut seen = HashSet::new();
    while !pending.is_empty() {
        let best = (0..pending.len()).min_by(|&a, &b| pending[a].0.total_cmp(&pending[b].0))?;
        let (cost, node, path) = pending.swap_remove(best);
        if node.is_empty() {
            return Some(path);
        }
        if !seen.insert(node.clone()) {
            continue;
        }
        for rail in graph.get(&node)? {
            // Some finite rail branches run into a failure trigger before their animation ends.
            // Only the final gate's successful branch is an accepted destination.
            if rail.next.is_none() && node != goal {
                continue;
            }
            let mut path = path.clone();
            path.push((node.clone(), rail.clone()));
            pending.push((cost + rail.frames, rail.next.clone().unwrap_or_default(), path));
        }
    }
    None
}

fn translation_keys(g: &Graph, node: usize) -> Option<Keys<3>> {
    let sequence = g.vals(node).get(6).and_then(|v| g.r#ref(v))?;
    if g.s2[sequence].field("slot16")?.int()? & 0xff != 1 {
        return None;
    }
    let positions = g.r#ref(g.vals(sequence).first()?)?;
    let times = g.r#ref(g.vals(sequence).get(8)?)?;
    if g.class(positions) != "igVec3fList" || g.class(times) != "igLongList" {
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
    let vals = g.vals(times);
    let count = usize::try_from(vals.first()?.int()?).ok()?;
    if count != positions.len() || count < 2 {
        return None;
    }
    let data = g.block(usize::try_from(vals.get(2)?.int()?).ok()?, count.checked_mul(8)?).ok()?;
    let keys: Vec<_> = data
        .as_chunks::<8>()
        .0
        .iter()
        .zip(positions)
        .map(|(time, p)| (u64::from_le_bytes(*time) as f64 * 60.0 / 1e9, p))
        .collect();
    (keys.windows(2).all(|k| k[0].0 < k[1].0) && keys.iter().all(|(_, p)| p.iter().all(|n| n.is_finite())))
        .then_some(keys)
}

fn train_track(g: &Graph) -> Option<TrainTrack> {
    let parent = g.s2.iter().position(|r| r.class == "igTransform" && r.name.as_deref() == Some("route00"))?;
    let children = g.vals(parent).get(3).and_then(|v| g.r#ref(v))?;
    let child = g
        .list_refs(children)
        .ok()?
        .into_iter()
        .flatten()
        .find(|&i| g.class(i) == "igTransform" && g.s2[i].name.as_deref() == Some("route01"))?;
    let position = translation_keys(g, parent)?;
    let offset = translation_keys(g, child)?;
    let sequence = g.vals(parent).get(6).and_then(|v| g.r#ref(v))?;
    // The authored rotation mode is shortest-path normalized linear interpolation.
    if (g.s2[sequence].field("slot16")?.int()? >> 8) & 0xff != 1 {
        return None;
    }
    let list = g.vals(sequence).get(1).and_then(|v| g.r#ref(v))?;
    if g.class(list) != "igQuaternionfList" || usize::try_from(g.vals(list).first()?.int()?).ok()? != position.len() {
        return None;
    }
    let memory = usize::try_from(g.vals(list).get(2)?.int()?).ok()?;
    let bytes = g.block(memory, position.len().checked_mul(16)?).ok()?;
    let rotation: Keys<4> = bytes
        .as_chunks::<16>()
        .0
        .iter()
        .zip(&position)
        .map(|(bytes, (time, _))| {
            (*time, std::array::from_fn(|i| f32::from_le_bytes(bytes[4 * i..4 * i + 4].try_into().unwrap()) as f64))
        })
        .collect();
    if rotation.iter().any(|(_, q)| q.iter().any(|n| !n.is_finite()) || q.iter().map(|n| n * n).sum::<f64>() < 1e-12) {
        return None;
    }
    Some(TrainTrack { position, rotation, offset })
}

fn interval<const N: usize>(keys: &[(f64, [f64; N])], frame: f64) -> (usize, f64) {
    let i = keys.partition_point(|(time, _)| *time < frame).clamp(1, keys.len() - 1);
    (i, ((frame - keys[i - 1].0) / (keys[i].0 - keys[i - 1].0)).clamp(0.0, 1.0))
}

fn sample<const N: usize>(keys: &[(f64, [f64; N])], frame: f64) -> [f64; N] {
    let (i, ratio) = interval(keys, frame);
    let a = keys[i - 1].1;
    let b = keys[i].1;
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * ratio)
}

impl TrainTrack {
    fn sample(&self, frame: f64) -> [f64; 3] {
        let (i, ratio) = interval(&self.rotation, frame);
        let a = self.rotation[i - 1].1;
        let b = self.rotation[i].1;
        let sign = if a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>() < 0.0 { -1.0 } else { 1.0 };
        let mut q: [f64; 4] = std::array::from_fn(|i| a[i] * (1.0 - ratio) + sign * b[i] * ratio);
        let norm = q.iter().map(|v| v * v).sum::<f64>().sqrt();
        q.iter_mut().for_each(|v| *v /= norm);
        let offset = sample(&self.offset, frame);
        let cross = |a: [f64; 3], b: [f64; 3]| {
            [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
        };
        let axis = [q[0], q[1], q[2]];
        let c = cross(axis, offset);
        let cc = cross(axis, c);
        let position = sample(&self.position, frame);
        // Alchemy's row-vector convention matches scene::transform_point.
        std::array::from_fn(|i| position[i] + offset[i] + 2.0 * (cc[i] - q[3] * c[i]))
    }
}

fn read(g: &Graph) -> Option<Journey> {
    let scripts = programs(g);
    let source = crate::trades::scripts(&g.b);
    let start = source.get("start.lua")?;
    let mut controllers = BTreeMap::new();
    let mut motions = BTreeMap::new();
    for (i, r) in g.s2.iter().enumerate() {
        let Some(name) = &r.name else { continue };
        if r.class == "beModelCtrlData" && (name.starts_with("SQ_RAIL") || name.starts_with("SQ_CHANGE")) {
            controllers.insert(name.clone(), commands(g, i)?);
        }
        if r.class == "beAction2Data" && name.starts_with("RAIL") {
            motions.insert(name.clone(), motion(g, i)?);
        }
    }
    let graph = rail_graph(&controllers, &motions);
    let goals: Vec<_> = graph
        .iter()
        .filter(|(_, rails)| rails.iter().any(|r| r.label == "hits" && r.next.is_none()))
        .map(|(name, _)| name)
        .collect();
    if goals.len() != 1 {
        return None;
    }
    let path = shortest(&graph, goals[0])?;
    let track = train_track(g)?;
    let mut controls = BTreeMap::new();
    let mut callbacks = BTreeMap::new();
    for (file, program) in scripts.iter().filter(|(file, _)| file.starts_with("mate")) {
        for state in 1..=32 {
            let mut entry = Machine { inside: true, ..Default::default() };
            entry.set("g_IFLG00", state);
            entry.run(program)?;
            let calls: Vec<_> = entry.calls.iter().filter(|(method, _)| method == "sd").collect();
            for (_, args) in calls {
                if let Some((model, instance, position, facing)) =
                    placed(args).filter(|(model, _, _, _)| model.starts_with("g_turn"))
                {
                    let choice = match model.as_str() {
                        "g_turnstra" => "straight",
                        "g_turnleft" => "left",
                        "g_turnright" => "right",
                        _ => return None,
                    };
                    let junction = file.strip_prefix("mate")?.strip_suffix(".lua")?.parse::<u8>().ok()? + 1;
                    let label = format!(
                        "Junction {junction} · {}",
                        match choice {
                            "straight" => "Straight",
                            "left" => "Left",
                            _ => "Right",
                        }
                    );
                    let id = format!("{model}:{instance}");
                    controls.insert(
                        id.clone(),
                        Control {
                            id,
                            model,
                            instance,
                            label,
                            junction,
                            choice: choice.into(),
                            position,
                            facing,
                            preview: vec![],
                            preview_destination: String::new(),
                        },
                    );
                    callbacks.insert(state, (file.clone(), junction));
                } else if args.first().and_then(Value::text) == Some("MODELCTRL")
                    && args.get(1).and_then(Value::text) == Some("g_gatesign")
                    && args.get(3).and_then(Value::text) == Some("SQ_POWERON")
                {
                    // Gate posts are placed at startup; their control scripts supply the ID.
                    let instance = args.get(2)?.int()?;
                    let pattern = regex::Regex::new(&format!(
                        r#"be:sd\("MODELCTRL", "g_gatesign", {instance}, "GENERATE", "V<([^>]+)>/V<([^>]+)>"\)"#
                    ))
                    .ok()?;
                    let found = pattern.captures(start)?;
                    let vector = |text: &str| {
                        text.split(',').map(str::parse::<f64>).collect::<std::result::Result<Vec<_>, _>>().ok()
                    };
                    let p = vector(&found[1])?;
                    let f = vector(&found[2])?;
                    let id = format!("g_gatesign:{instance}");
                    controls.insert(
                        id.clone(),
                        Control {
                            id,
                            model: "g_gatesign".into(),
                            instance,
                            label: format!("Gate post {}", instance + 1),
                            junction: 10 + instance as u8,
                            choice: "gate".into(),
                            position: Position { x: p[0], y: p[1], z: p[2] },
                            facing: f[1],
                            preview: vec![],
                            preview_destination: String::new(),
                        },
                    );
                    // Their entry code powers the same post for any state; the exit callback
                    // identifies its real state by issuing a train sequence only there.
                    let mut exit = Machine::default();
                    exit.set("g_IFLG00", state);
                    exit.set("g_IFLG01", 1);
                    exit.run(program)?;
                    if exit.calls.iter().any(|(_, args)| args.get(1).and_then(Value::text) == Some("r_trainz02")) {
                        callbacks.insert(state, (file.clone(), 10 + instance as u8));
                    }
                }
            }
        }
    }
    if controls.len() != 20 {
        return None;
    }
    let mut initial = Machine { inside: true, ..Default::default() };
    initial.run(scripts.get("matz00.lua")?)?;
    let first_fork = graph.get("SQ_RAIL00")?.first()?.next.clone()?;
    let mut pending = std::collections::VecDeque::from([(initial, first_fork)]);
    let mut visited = HashSet::new();
    while let Some((arrival, fork)) = pending.pop_front() {
        if !visited.insert((arrival.get("g_IFLG00"), arrival.get("g_IFLG02"), fork.clone())) {
            continue;
        }
        let Some((file, junction)) = callbacks.get(&arrival.get("g_IFLG00")) else { continue };
        let ids: Vec<_> = controls.values().filter(|c| c.junction == *junction).map(|c| c.id.clone()).collect();
        for id in ids {
            let control = controls.get_mut(&id)?;
            let mut test = arrival.clone();
            test.inside = true;
            test.calls.clear();
            test.run(&scripts[file])?;
            test.instance = control.instance;
            test.run(scripts.get(&format!("hit_{}.lua", control.model))?)?;
            test.inside = false;
            test.calls.clear();
            test.run(&scripts[file])?;
            let change = test
                .calls
                .iter()
                .filter(|(_, args)| args.get(1).and_then(Value::text) == Some("r_trainz02"))
                .filter_map(|(_, args)| args.get(3).and_then(Value::text).and_then(|name| controllers.get(name)))
                .flatten()
                .find(|command| command.kind == "beModelCtrlLABELCTRL" && command.target.as_deref() == Some(&fork))?;
            let mut active = false;
            let mut action = None;
            for command in controllers.get(&fork)? {
                if command.kind == "beModelCtrlLABEL" {
                    active = command.name == change.name;
                }
                if active && command.kind == "beModelCtrlACTION" {
                    action = Some(command.name.clone());
                    break;
                }
            }
            let points = motion_points(&track, motions.get(&action?)?);
            if !control.preview.is_empty() && control.preview != points {
                return None;
            }
            control.preview = points;
            let next = test.get("g_IFLG00");
            control.preview_destination = callbacks
                .get(&next)
                .map(|(_, junction)| {
                    if *junction >= 10 {
                        format!("Gate post {}", junction - 9)
                    } else {
                        format!("Junction {junction}")
                    }
                })
                .unwrap_or_else(|| if next == 22 { "Power Plant".into() } else { "an unsuccessful branch".into() });
            if let Some(next_fork) =
                graph.get(&fork)?.iter().find(|rail| rail.label == change.name).and_then(|rail| rail.next.clone())
            {
                pending.push_back((test, next_fork));
            }
        }
    }
    if controls.values().any(|control| control.preview.len() < 2) {
        return None;
    }
    let mut machine = Machine { inside: true, ..Default::default() };
    machine.run(scripts.get("matz00.lua")?)?;
    let mut steps = Vec::new();
    for (node, rail) in path.iter().skip(1) {
        let (file, junction) = callbacks.get(&machine.get("g_IFLG00"))?;
        let selected = controls.values().filter(|c| &c.junction == junction).find(|control| {
            let mut test = machine.clone();
            test.inside = true;
            test.calls.clear();
            if test.run(&scripts[file]).is_none() {
                return false;
            }
            test.instance = control.instance;
            let Some(hit) = scripts.get(&format!("hit_{}.lua", control.model)) else { return false };
            if test.run(hit).is_none() {
                return false;
            }
            test.inside = false;
            test.calls.clear();
            if test.run(&scripts[file]).is_none() {
                return false;
            }
            test.calls
                .iter()
                .filter_map(|(_, args)| {
                    (args.get(1).and_then(Value::text) == Some("r_trainz02")).then(|| args.get(3)?.text()).flatten()
                })
                .filter_map(|name| controllers.get(name))
                .flatten()
                .any(|c| c.kind == "beModelCtrlLABELCTRL" && c.target.as_deref() == Some(node) && c.name == rail.label)
        })?;
        machine.inside = true;
        machine.run(&scripts[file])?;
        machine.instance = selected.instance;
        machine.run(scripts.get(&format!("hit_{}.lua", selected.model))?)?;
        machine.inside = false;
        machine.run(&scripts[file])?;
        steps.push(Step {
            control_id: selected.id.clone(),
            instruction: match selected.choice.as_str() {
                "straight" => "Continue straight".into(),
                "left" => "Hit the left arrow".into(),
                "right" => "Hit the right arrow".into(),
                _ => format!("Hit {}", selected.label),
            },
        });
    }
    let mut points = Vec::new();
    for (_, rail) in &path {
        points.extend(motion_points(&track, motions.get(&rail.action)?));
    }
    Some(Journey {
        controls: controls.into_values().collect(),
        steps,
        points,
        rail_frames: path.iter().map(|(_, rail)| rail.frames).sum(),
        destination: regex::Regex::new(r#""NEXTSTAGE", "([^"]+)""#).ok()?.captures(source.get("matz04.lua")?)?[1]
            .into(),
    })
}

fn motion_points(track: &TrainTrack, motion: &Motion) -> Vec<[f64; 3]> {
    fn trace(track: &TrainTrack, times: [f64; 2], ends: [[f64; 3]; 2], depth: usize, out: &mut Vec<[f64; 3]>) {
        let curved = [0.25, 0.5, 0.75].into_iter().any(|ratio| {
            let p = track.sample(times[0] + (times[1] - times[0]) * ratio);
            (0..3).map(|i| (p[i] - (ends[0][i] + (ends[1][i] - ends[0][i]) * ratio)).powi(2)).sum::<f64>()
                > 0.25_f64.powi(2)
        });
        if curved && depth < 12 {
            let mid = (times[0] + times[1]) / 2.0;
            let point = track.sample(mid);
            trace(track, [times[0], mid], [ends[0], point], depth + 1, out);
            trace(track, [mid, times[1]], [point, ends[1]], depth + 1, out);
        } else {
            out.push(ends[1]);
        }
    }
    let mut points = Vec::new();
    for &(start, end) in &motion.ranges {
        let mut times = vec![start, end];
        times.extend(
            track.position.iter().chain(&track.offset).map(|(time, _)| *time).filter(|t| *t > start && *t < end),
        );
        times.sort_by(f64::total_cmp);
        times.dedup();
        points.push(track.sample(start));
        if times.len() == 1 {
            points.push(track.sample(end));
        }
        for interval in times.windows(2) {
            let times = [interval[0], interval[1]];
            trace(track, times, [track.sample(times[0]), track.sample(times[1])], 0, &mut points);
        }
    }
    points
}

pub fn extract(packs: &[Vec<u8>]) -> Option<Journey> {
    packs
        .iter()
        .filter(|p| p.windows(11).any(|w| w == b"g_turnright"))
        .find_map(|pack| read(&Graph::new(pack.clone()).ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track() -> TrainTrack {
        TrainTrack {
            position: vec![(0.0, [0.0; 3]), (10.0, [0.0; 3])],
            rotation: vec![(0.0, [0.0, 0.0, 0.0, 1.0]), (10.0, [0.0, 0.0, 0.0, 1.0])],
            offset: vec![(0.0, [0.0; 3]), (10.0, [0.0; 3])],
        }
    }

    #[test]
    fn child_offset_traces_the_train_arc_while_the_parent_pivot_stays_still() {
        let mut track = track();
        let half = 0.5_f64.sqrt();
        track.rotation[1].1 = [0.0, half, 0.0, half];
        track.offset = vec![(0.0, [10.0, 0.0, 0.0]), (10.0, [10.0, 0.0, 0.0])];
        let path = motion_points(&track, &Motion { ranges: vec![(0.0, 10.0)], loops: false });
        assert!(path.len() > 3 && path.len() < 100);
        assert!((path[0][0] - 10.0).abs() < 1e-9);
        assert!(path[0][2].abs() < 1e-9);
        assert!(path.last().unwrap()[0].abs() < 1e-9);
        assert!((path.last().unwrap()[2] - 10.0).abs() < 1e-9);
        assert!(path.iter().any(|p| (p[0] - 10.0 * half).abs() < 1e-9 && (p[2] - 10.0 * half).abs() < 1e-9));
        for point in path {
            assert!((point[0].hypot(point[2]) - 10.0).abs() < 1e-9);
        }
        // Opposite quaternion signs represent the same orientation. The native interpolator
        // flips the second sign, avoiding a long rotation in the other direction.
        let expected = track.sample(2.5);
        track.rotation[1].1.iter_mut().for_each(|v| *v = -*v);
        for (actual, expected) in track.sample(2.5).into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-9);
        }
    }

    #[test]
    fn child_key_times_are_preserved_and_straight_tracks_need_no_extra_points() {
        let mut track = track();
        track.position[1].1 = [20.0, 0.0, 0.0];
        let motion = Motion { ranges: vec![(0.0, 10.0)], loops: false };
        assert_eq!(motion_points(&track, &motion), [[0.0; 3], [20.0, 0.0, 0.0]]);
        track.offset.insert(1, (3.0, [0.0, 0.0, 4.0]));
        assert_eq!(motion_points(&track, &motion), [[0.0; 3], [6.0, 0.0, 4.0], [20.0, 0.0, 0.0]]);
        assert_eq!(motion_points(&track, &Motion { ranges: vec![(3.0, 3.0)], loops: false }), [[6.0, 0.0, 4.0]; 2]);
    }

    #[test]
    fn shortest_journey_uses_time_instead_of_fewest_decisions_and_rejects_loops() {
        let rail = |next: Option<&str>, frames| Rail {
            label: "stra".into(),
            action: "a".into(),
            next: next.map(str::to_string),
            frames,
        };
        let graph = BTreeMap::from([
            ("SQ_RAIL00".into(), vec![rail(Some("long"), 1.0), rail(Some("short"), 1.0), rail(Some("failure"), 0.0)]),
            ("long".into(), vec![rail(Some("last"), 100.0)]),
            ("short".into(), vec![rail(Some("SQ_RAIL00"), 1.0), rail(Some("middle"), 1.0)]),
            ("middle".into(), vec![rail(Some("last"), 1.0)]),
            ("failure".into(), vec![rail(None, 0.0)]),
            ("last".into(), vec![rail(None, 1.0)]),
        ]);
        let path = shortest(&graph, "last").unwrap();
        assert_eq!(
            path.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>(),
            ["SQ_RAIL00", "short", "middle", "last"]
        );
    }

    #[test]
    fn original_bytecode_keeps_entry_and_exit_mutually_exclusive() {
        let int = |n: i64| 6 | (((n + ((1 << 25) - 1)) as u32) << 6);
        let jump = |op: u32, pc: i64, to: i64| op | (((to - pc - 1 + ((1 << 25) - 1)) as u32) << 6);
        let program = Function {
            numparams: 0,
            is_vararg: 0,
            kstr: ["be", "MATisPlayer", "choice"].map(|s| Some(s.into())).to_vec(),
            knum: vec![],
            kproto: vec![],
            code: vec![
                12,
                16 | (1 << 6),
                2 | (1 << 6),
                int(1),
                jump(32, 4, 8),
                int(7),
                19 | (2 << 6),
                jump(42, 7, 10),
                int(9),
                19 | (2 << 6),
                0,
            ],
        };
        let mut m = Machine { inside: true, ..Default::default() };
        m.run(&program).unwrap();
        assert_eq!(m.get("choice"), 7);
        m.inside = false;
        m.run(&program).unwrap();
        assert_eq!(m.get("choice"), 9);
    }
}

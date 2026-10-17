//! What the game's scripts do to each spawner, read from the decompiled stage scripts.
//!
//! Stage packs carry Lua 4.0.1 chunks. A call like `be:sd("GENERATER", nil, -1, "START", "GENE-53")`
//! starts a spawner; `RESTART` rearms it and `STOP` ends it. Each call sits under the `if` conditions
//! of its chunk, which are kept as written and also put into plain words where the function is known.
//! Spawner names built in code (`"GENE-" .. n`) cannot be tied to one spawner and are reported as
//! prefixes. The text work runs on decompiled source, so it can be checked without the decompiler.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;

use crate::luadec;

const VERBS: [&str; 8] = ["START", "RESTART", "STOP", "STOPREVERS", "RESET", "PERFECTDROP", "ONFREEZE", "OFFFREEZE"];

/// A lazily compiled pattern; `fullmatch` patterns are written anchored as `^(?:...)$`.
macro_rules! pattern {
    ($name:ident, $re:expr) => {
        fn $name() -> &'static Regex {
            static RE: OnceLock<Regex> = OnceLock::new();
            RE.get_or_init(|| Regex::new($re).unwrap())
        }
    };
}

pattern!(call_re, r#"^be:(?:sd|DMsetSD)\("GENERATER",\s*[^,]+,\s*(-?\d+),\s*"(\w+)"(?:,\s*(.*))?\)\s*$"#);
pattern!(block_re, r"^(if|elseif|while)\s+(.*)\s+(then|do)$");
pattern!(flag_re, r"^(?:be:FLGisOn\((\d+)\)\s*(==|~=)\s*(\d+))$");
pattern!(ninzu_re, r"^(?:be:SYSgetPlayerNinzu\(\)\s*(==|~=|<=|>=|<|>)\s*(\d+))$");
pattern!(ramno_re, r"^(?:be:MDLgetRamNo\(\)\s*(==|~=)\s*(\d+))$");
pattern!(entry_re, r"^(?:be:PLAYERgetPos\(\)\s*(==|~=)\s*(\d+))$");
pattern!(mat_re, r"^(?:be:MATisPlayer\(\)\s*(==|~=)\s*(\d+))$");
pattern!(playing_re, r#"^(?:local_\d+\s*(==|~=)\s*"(p_\w+)")$"#);
pattern!(negation_re, r"^(?:not \((.*)\))$");
pattern!(events_re, r"^events? [\d, -]+ not done yet");
pattern!(and_re, r"\s+and\s+");
pattern!(latch_re, r"be:FLGset\((\d+),\s*1\)");
pattern!(quoted_re, r#"^(?:"([^"]*)")$"#);
pattern!(concat_re, r#"^"([^"]*)"\s*\.\."#);
pattern!(format_re, r#"^format\("([^"%]*)%"#);

/// Python's `str.strip()`: its whitespace also counts the separators U+001C..U+001F.
pub(crate) fn py_strip(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || ('\x1c'..='\x1f').contains(&c))
}

/// A `\d+` match as a number (the decompiler writes numbers in ASCII).
fn int(digits: &str) -> i64 {
    digits.parse().unwrap_or_default()
}

/// Meanings of the story and quest flags (names/flags.json).
pub fn load_flag_names() -> HashMap<i64, String> {
    let Some(raw) = crate::names::flags().as_object() else { return HashMap::new() };
    raw.iter()
        .filter(|(k, _)| !k.starts_with('_'))
        .filter_map(|(k, v)| Some((py_strip(k).parse().ok()?, v["meaning"].as_str()?.to_string())))
        .collect()
}

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

/// `[598, 599, 600, 605]` -> "598-600, 605".
///
/// Ported literally: a run is extended when the last entry ends in `n - 1`, either as the end of a
/// range or as a lone number.
pub fn ranges(numbers: &[i64]) -> String {
    let mut out: Vec<String> = Vec::new();
    for n in sorted_unique(numbers) {
        let prev = (n - 1).to_string();
        let extend = out.last().is_some_and(|last| {
            last.ends_with(&prev)
                && (last.contains('-') && last.split('-').next_back() == Some(prev.as_str()) || *last == prev)
        });
        if extend {
            let last = out.last_mut().unwrap();
            let head = last.split('-').next().unwrap().to_string();
            *last = format!("{head}-{n}");
        } else {
            out.push(n.to_string());
        }
    }
    out.join(", ")
}

fn sorted_unique(numbers: &[i64]) -> Vec<i64> {
    let mut v = numbers.to_vec();
    v.sort_unstable();
    v.dedup();
    v
}

/// "events 598-610 done (600: Boss 1 story scene done; ...)", naming the ones the flag table knows.
fn events(numbers: &[i64], state: &str, meanings: &HashMap<i64, String>) -> String {
    let unique = sorted_unique(numbers);
    let mut text = format!("event{} {} {state}", if unique.len() > 1 { "s" } else { "" }, ranges(numbers));
    let known: Vec<String> = unique.iter().filter_map(|n| meanings.get(n).map(|m| format!("{n}: {m}"))).collect();
    if !known.is_empty() {
        let shown = &known[..known.len().min(6)];
        text += &format!(" ({}{})", shown.join("; "), if known.len() > 6 { "; ..." } else { "" });
    }
    text
}

/// One condition in words; unknown ones are returned as written.
///
/// `digimon` maps player model names (`p_agumon`) to display names ("Agumon"); `meanings` names
/// story flags; `latched` are flags the same script sets after testing them, which makes the test
/// "the first time" and not a story fact.
pub fn describe(
    cond: &str,
    digimon: &HashMap<String, String>,
    meanings: &HashMap<i64, String>,
    latched: &HashSet<i64>,
) -> String {
    if let Some(m) = negation_re().captures(cond) {
        let inner = describe(&m[1], digimon, meanings, latched);
        if events_re().is_match(&inner) {
            // "not (X not done yet)" is just "X done".
            return inner.replacen(" not done yet", " done", 1);
        }
        return if inner.contains("this is the first time") {
            inner.replacen("this is the first time", "this is not the first time", 1)
        } else {
            format!("not ({inner})")
        };
    }
    let mut parts: Vec<String> = Vec::new();
    let (mut done, mut pending, mut first) = (Vec::new(), Vec::new(), Vec::new());
    for piece in and_re().split(cond) {
        let piece = py_strip(piece).trim_matches(|c| c == '(' || c == ')');
        if let Some(m) = flag_re().captures(piece) {
            let n = int(&m[1]);
            let is_done = (&m[2] == "==") == (&m[3] != "0");
            if !is_done && latched.contains(&n) {
                first.push(n);
            } else if is_done {
                done.push(n);
            } else {
                pending.push(n);
            }
        } else if let Some(m) = ninzu_re().captures(piece) {
            let (op, n) = (&m[1], int(&m[2]));
            let plural = if n != 1 { "s" } else { "" };
            parts.push(if op == "~=" && n == 1 {
                "2 or more players".to_string()
            } else {
                match op {
                    "==" => format!("exactly {n} player{plural}"),
                    "~=" => format!("not {n} player{plural}"),
                    ">=" => format!("{n} or more players"),
                    ">" => format!("more than {n} player{plural}"),
                    "<=" => format!("{n} or fewer players"),
                    _ => format!("fewer than {n} players"),
                }
            });
        } else if let Some(m) = ramno_re().captures(piece) {
            let slot = int(&m[2]) + 1;
            parts.push(if &m[1] == "==" { format!("player {slot}") } else { format!("not player {slot}") });
        } else if let Some(m) = entry_re().captures(piece) {
            parts.push(if &m[1] == "==" {
                format!("entered by gate {}", &m[2])
            } else {
                format!("not entered by gate {}", &m[2])
            });
        } else if let Some(m) = mat_re().captures(piece) {
            let on = (&m[1] == "==") == (&m[2] != "0");
            parts.push(if on { "a player touches the trigger" } else { "triggered by something else" }.to_string());
        } else if let Some((m, name)) =
            playing_re().captures(piece).and_then(|m| digimon.get(&m[2]).map(|name| (m, name)))
        {
            parts.push(if &m[1] == "==" {
                format!("you play as {name}")
            } else {
                format!("you do not play as {name}")
            });
        } else {
            parts.push(piece.to_string());
        }
    }
    if !first.is_empty() {
        let named = first.iter().any(|n| meanings.contains_key(n));
        let meaning = match meanings.get(&first[0]) {
            Some(m) if first.len() == 1 && named => format!(": {m}"),
            _ => String::new(),
        };
        parts.push(format!("this is the first time (event {}{meaning})", ranges(&first)));
    }
    if !done.is_empty() {
        parts.push(events(&done, "done", meanings));
    }
    if !pending.is_empty() {
        parts.push(events(&pending, "not done yet", meanings));
    }
    parts.join(" and ")
}

/// Top-level comma-separated arguments of a call (commas inside quotes or brackets do not split).
pub fn split_args(text: &str) -> Vec<String> {
    let (mut out, mut depth, mut cur, mut quote) = (Vec::new(), 0i32, String::new(), false);
    for ch in text.chars() {
        if ch == '"' {
            quote = !quote;
        }
        if !quote && (ch == '(' || ch == '[') {
            depth += 1;
        }
        if !quote && (ch == ')' || ch == ']') {
            depth -= 1;
        }
        if !quote && depth == 0 && ch == ',' {
            out.push(py_strip(&cur).to_string());
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    if !py_strip(&cur).is_empty() {
        out.push(py_strip(&cur).to_string());
    }
    out
}

/// (name, prefix): a plain quoted name, or the constant start of a name built with `..`.
fn target(arg: &str) -> (Option<String>, Option<String>) {
    if let Some(m) = quoted_re().captures(arg) {
        return (Some(m[1].to_string()), None);
    }
    let m = concat_re().captures(arg).or_else(|| format_re().captures(arg));
    (None, Some(m.map_or_else(String::new, |m| m[1].to_string())))
}

/// Every spawner command in one decompiled chunk with the conditions above it.
///
/// `elseif` and `else` branches carry the negation of the branches before them, so a script that
/// starts one spawner when a flag is set and another otherwise says so for both.
pub fn references(source: &str, digimon: &HashMap<String, String>, meanings: &HashMap<i64, String>) -> Vec<Ref> {
    let mut refs = Vec::new();
    // A flag the chunk sets to 1 is a once-only latch when the same chunk tests it as not yet done.
    let latched: HashSet<i64> = latch_re().captures_iter(source).map(|m| int(&m[1])).collect();
    let mut stack: Vec<Vec<String>> = Vec::new(); // per open block: the raw conditions that hold inside
    let mut chain: HashMap<usize, Vec<String>> = HashMap::new(); // per level: if/elseif conditions so far
    let negated = |conds: &[String]| conds.iter().map(|c| format!("not ({c})")).collect::<Vec<_>>();
    for line in source.split('\n') {
        let stripped = py_strip(line);
        if stripped.is_empty() {
            continue;
        }
        let level = (line.len() - line.trim_start_matches(' ').len()) / 4;
        stack.truncate(level);
        if let Some(m) = block_re().captures(stripped) {
            let cond = m[2].to_string();
            match &m[1] {
                "if" => {
                    chain.insert(level, vec![cond.clone()]);
                    stack.push(vec![cond]);
                }
                "elseif" => {
                    let mut prior = chain.get(&level).cloned().unwrap_or_default();
                    let mut conds = negated(&prior);
                    conds.push(cond.clone());
                    stack.push(conds);
                    prior.push(cond);
                    chain.insert(level, prior);
                }
                _ => stack.push(vec![cond]),
            }
            continue;
        }
        if stripped == "else" {
            stack.push(negated(chain.get(&level).map_or(&[][..], Vec::as_slice)));
            continue;
        }
        let Some(m) = call_re().captures(stripped) else { continue };
        if !VERBS.contains(&&m[2]) {
            continue;
        }
        let args = split_args(m.get(3).map_or("", |a| a.as_str()));
        let Some(first) = args.first() else { continue };
        let (name, prefix) = target(first);
        let raw: Vec<String> = stack.iter().flatten().cloned().collect();
        let when = raw.iter().map(|c| describe(c, digimon, meanings, &latched)).collect();
        refs.push(Ref { verb: m[2].to_string(), target: name, prefix, when, raw });
    }
    refs
}

/// Every spawner reference in a stage's scripts, by spawner name and by built-name prefix.
#[derive(Debug, Default)]
pub struct StageScripts {
    by_name: HashMap<String, Vec<Ref>>,
    /// Name prefix -> the calls that build names, in first-seen order (the first matching prefix wins).
    dynamic: Vec<(String, Vec<Ref>)>,
}

impl StageScripts {
    pub fn add(&mut self, refs: Vec<Ref>) {
        for r in refs {
            match r.target.as_deref() {
                Some(name) if !name.is_empty() => self.by_name.entry(name.to_string()).or_default().push(r),
                _ => {
                    let prefix = r.prefix.clone().unwrap_or_default();
                    match self.dynamic.iter_mut().find(|(p, _)| *p == prefix) {
                        Some((_, list)) => list.push(r),
                        None => self.dynamic.push((prefix, vec![r])),
                    }
                }
            }
        }
    }

    /// How scripts relate to a spawner: ("referenced" | "dynamic" | "unknown" | "none", refs).
    pub fn status(&self, name: &str) -> (&'static str, Vec<Ref>) {
        if let Some(refs) = self.by_name.get(name) {
            return ("referenced", refs.clone());
        }
        if let Some((_, refs)) = self.dynamic.iter().find(|(p, _)| !p.is_empty() && name.starts_with(p.as_str())) {
            return ("dynamic", refs.clone());
        }
        if let Some((_, refs)) = self.dynamic.iter().find(|(p, _)| p.is_empty()) {
            return ("unknown", refs.clone());
        }
        ("none", Vec::new())
    }
}

/// Spawner references in already decompiled chunks, in order.
pub fn analyse_sources<'a>(
    sources: impl IntoIterator<Item = &'a str>,
    digimon: &HashMap<String, String>,
    meanings: &HashMap<i64, String>,
) -> StageScripts {
    let mut out = StageScripts::default();
    for source in sources {
        out.add(references(source, digimon, meanings));
    }
    out
}

/// Every spawner reference in a stage's packs.
pub fn analyse(packs: &[Vec<u8>], digimon: &HashMap<String, String>, meanings: &HashMap<i64, String>) -> StageScripts {
    let chunks: Vec<String> =
        packs.iter().flat_map(|blob| luadec::decompile_chunks(blob)).map(|(_, source)| source).collect();
    analyse_sources(chunks.iter().map(String::as_str), digimon, meanings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> HashMap<String, String> {
        HashMap::new()
    }

    fn flags(entries: &[(i64, &str)]) -> HashMap<i64, String> {
        entries.iter().map(|(n, m)| (*n, m.to_string())).collect()
    }

    fn say(cond: &str) -> String {
        describe(cond, &none(), &HashMap::new(), &HashSet::new())
    }

    fn refs(source: &str) -> Vec<Ref> {
        references(source, &none(), &HashMap::new())
    }

    fn when_by_target(refs: &[Ref]) -> HashMap<String, Vec<String>> {
        refs.iter().map(|r| (r.target.clone().unwrap(), r.when.clone())).collect()
    }

    const TRAP: &str = r#"if be:MATisPlayer() == 1 and be:FLGisOn(339) == 0 then
    be:sd("MODELCTRL", "g_rockdownz01", 2, "SQ_POWERON")
    be:sd("GENERATER", nil, -1, "RESTART", "GENE-53")
    be:FLGset(339, 1)
end"#;

    const GBOX: &str = r#"be:sd("GENERATER", nil, -1, "START", format("GBOX-%02d", local_2))"#;

    #[test]
    fn a_negated_not_done_yet_reads_as_done() {
        let text = describe("not (be:FLGisOn(38) == 0)", &none(), &flags(&[(38, "lever pulled")]), &HashSet::new());
        assert_eq!(text, "event 38 done (38: lever pulled)");
    }

    #[test]
    fn first_time_names_the_flag_when_known() {
        let text = describe("be:FLGisOn(38) == 0", &none(), &flags(&[(38, "lever pulled")]), &HashSet::from([38]));
        assert_eq!(text, "this is the first time (event 38: lever pulled)");
    }

    #[test]
    fn a_start_keeps_the_conditions_above_it_in_words() {
        let [r] = refs(TRAP).try_into().unwrap();
        assert_eq!((r.verb.as_str(), r.target.as_deref()), ("RESTART", Some("GENE-53")));
        assert_eq!(r.when, ["a player touches the trigger and this is the first time (event 339)"]);
    }

    #[test]
    fn commands_for_other_systems_are_ignored() {
        assert_eq!(refs(r#"be:sd("MODELCTRL", nil, -1, "START", "GENE-01")"#), []);
    }

    #[test]
    fn a_trailing_delay_argument_does_not_hide_the_name() {
        let [r] = refs(r#"be:DMsetSD("GENERATER", nil, -1, "START", "GENE-22", 10)"#).try_into().unwrap();
        assert_eq!(r.target.as_deref(), Some("GENE-22"));
        assert!(r.when.is_empty());
    }

    #[test]
    fn else_and_elseif_branches_carry_the_negated_earlier_conditions() {
        let when = when_by_target(&refs(
            r#"if be:FLGisOn(5) == 1 then
    be:sd("GENERATER", nil, -1, "START", "GENE-a")
elseif be:SYSgetPlayerNinzu() == 2 then
    be:sd("GENERATER", nil, -1, "START", "GENE-b")
else
    be:sd("GENERATER", nil, -1, "START", "GENE-c")
end"#,
        ));
        assert_eq!(when["GENE-a"], ["event 5 done"]);
        assert_eq!(when["GENE-b"], ["not (event 5 done)", "exactly 2 players"]);
        assert_eq!(when["GENE-c"], ["not (event 5 done)", "not (exactly 2 players)"]);
    }

    #[test]
    fn names_built_in_code_become_prefixes() {
        let r = &refs(GBOX)[0];
        assert_eq!((r.target.as_deref(), r.prefix.as_deref()), (None, Some("GBOX-")));
    }

    #[test]
    fn status_of_a_spawner() {
        let mut s = StageScripts::default();
        s.add(refs(TRAP));
        s.add(refs(GBOX));
        assert_eq!(s.status("GENE-53").0, "referenced");
        assert_eq!(s.status("GBOX-04").0, "dynamic");
        assert_eq!(s.status("GENE-01").0, "none");
        s.add(refs(r#"be:sd("GENERATER", nil, -1, "START", local_0)"#));
        assert_eq!(s.status("GENE-01").0, "unknown");
    }

    #[test]
    fn runs_of_events_are_written_as_ranges() {
        assert_eq!(ranges(&[598, 599, 600, 605, 607, 608]), "598-600, 605, 607-608");
        assert_eq!(say("be:FLGisOn(1) == 1 and be:FLGisOn(2) == 1"), "events 1-2 done");
    }

    #[test]
    fn a_flag_the_script_sets_itself_is_a_first_time_latch() {
        let names = load_flag_names();
        let [r] = references(TRAP, &none(), &names).try_into().unwrap();
        assert_eq!(r.when, ["a player touches the trigger and this is the first time (event 339)"]);
        // Without the FLGset in the chunk, the same test is a plain "not done yet".
        let plain = TRAP.replace("    be:FLGset(339, 1)\n", "");
        assert!(references(&plain, &none(), &names)[0].when[0].contains("event 339 not done yet"));
    }

    #[test]
    fn the_else_of_a_first_time_latch_is_not_the_first_time() {
        let when = when_by_target(&refs(
            r#"if be:FLGisOn(355) == 0 then
    be:FLGset(355, 1)
    be:sd("GENERATER", nil, -1, "START", "GENE-21")
else
    be:sd("GENERATER", nil, -1, "START", "GENE-22")
end"#,
        ));
        assert_eq!(when["GENE-21"], ["this is the first time (event 355)"]);
        assert_eq!(when["GENE-22"], ["this is not the first time (event 355)"]);
    }

    #[test]
    fn story_flags_use_the_decomp_meanings() {
        let names = load_flag_names();
        assert_eq!(names[&610], "Final boss story scene done");
        assert!(!names.contains_key(&150)); // per-stage scratch flags are not named
        let text = describe("be:FLGisOn(600) == 1 and be:FLGisOn(610) == 1", &none(), &names, &HashSet::new());
        assert!(text.contains("(600: Boss 1 story scene done; 610: Final boss story scene done)"));
    }

    #[test]
    fn the_digimon_you_play_is_named() {
        let names = HashMap::from([("p_agumon".to_string(), "Agumon".to_string())]);
        let say_with = |cond: &str| describe(cond, &names, &HashMap::new(), &HashSet::new());
        assert_eq!(say_with(r#"local_0 == "p_agumon""#), "you play as Agumon");
        assert_eq!(say_with(r#"local_0 ~= "p_agumon""#), "you do not play as Agumon");
        assert_eq!(say(r#"local_0 == "p_agumon""#), r#"local_0 == "p_agumon""#);
    }

    #[test]
    fn player_count_and_slot_conditions() {
        assert_eq!(say("be:SYSgetPlayerNinzu() ~= 1"), "2 or more players");
        assert_eq!(say("be:MDLgetRamNo() == 1"), "player 2");
    }

    #[test]
    fn strip_and_split_follow_python() {
        assert_eq!(say("((be:MDLgetRamNo() == 0))"), "player 1");
        assert_eq!(split_args(r#" "a,b" , f(1, 2), [3, 4] "#), [r#""a,b""#, "f(1, 2)", "[3, 4]"]);
        // A run is only extended from its last number, so a gap restarts it.
        assert_eq!(ranges(&[1, 3, 4, 10, 11, 12]), "1, 3-4, 10-12");
    }
}

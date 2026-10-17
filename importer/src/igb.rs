//! igBinary pack decoder for DW4 packs (stage data, models, databases).
//!
//! A pack is a type directory plus two record chains. Records are
//! `{u32 classIndex}{u32 recordSize}{values in descriptor order}` and self-verify through
//! `recordSize`. `igObjectRef` fields hold global ids that resolve through the id remap table
//! between the chains. List contents live in a trailing pool of memory blocks. Fields are read by
//! position: `fields[i]` is the i-th descriptor of the class.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::bytes::Regex;

use crate::error::{Error, Result};
use crate::fail;
use crate::pyfmt;

/// A decoded field value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Int(i64),
    Float(f64),
    Str(String),
    Floats(Vec<f64>),
}

impl Value {
    pub fn int(&self) -> Option<i64> {
        match self {
            Value::Int(v) => Some(*v),
            _ => None,
        }
    }
    pub fn float(&self) -> Option<f64> {
        match self {
            Value::Float(v) => Some(*v),
            Value::Int(v) => Some(*v as f64),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn floats(&self) -> Option<&[f64]> {
        match self {
            Value::Floats(v) => Some(v),
            _ => None,
        }
    }
    /// Python truthiness, for flags stored as numbers.
    pub fn truthy(&self) -> bool {
        match self {
            Value::Int(v) => *v != 0,
            Value::Float(v) => *v != 0.0,
            Value::Str(s) => !s.is_empty(),
            Value::Floats(v) => !v.is_empty(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ClassDef {
    pub name: String,
    pub off: usize,
    /// (type id, slot ordinal, size) per field.
    pub trips: Vec<(u16, u16, u16)>,
}

#[derive(Debug, Clone)]
pub struct Field {
    /// `_name` for the first string field, `slot<N>` otherwise.
    pub name: String,
    pub value: Value,
    pub ty: u16,
}

#[derive(Debug, Clone)]
pub struct Record {
    pub off: usize,
    pub class: String,
    pub class_index: usize,
    pub size: usize,
    pub name: Option<String>,
    pub fields: Vec<Field>,
    pub end: usize,
}

impl Record {
    /// A field by name; like the Python exporter's dict view, a repeated name gives the last one.
    pub fn field(&self, name: &str) -> Option<&Value> {
        self.fields.iter().rev().find(|f| f.name == name).map(|f| &f.value)
    }
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes(s.try_into().unwrap()))
}
fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}
fn f32_at(b: &[u8], at: usize) -> Option<f64> {
    b.get(at..at + 4).map(|s| f32::from_le_bytes(s.try_into().unwrap()) as f64)
}

fn ident_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?-u)[A-Za-z_][A-Za-z0-9_:]{2,60}\x00").unwrap())
}
fn object_anchor() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?-u)\x00igObject\x00").unwrap())
}

fn triple(b: &[u8], at: usize) -> Option<(u16, u16, u16)> {
    Some((u16_at(b, at)?, u16_at(b, at + 2)?, u16_at(b, at + 4)?))
}

/// Validated class-record walk: `{name NUL}{pad to even}{6-byte triples}` repeated. The triple
/// count is not stored, so a record ends where the next identifier sits at `align2(name)+6N` with
/// every triple decoding (`type id < 48`). The last class runs into the type-name pool, so a valid
/// prefix is taken for it.
fn walk_directory(b: &[u8], start: usize, limit: usize) -> (Vec<ClassDef>, usize) {
    let limit = limit.min(b.len());
    let mut idents: HashMap<usize, &[u8]> = HashMap::new();
    if start < limit {
        for m in ident_regex().find_iter(&b[start..limit]) {
            idents.insert(start + m.start(), &m.as_bytes()[..m.len() - 1]);
        }
    }
    let triples_ok = |pad: usize, n: usize| -> bool {
        (0..n).all(|k| match triple(b, pad + 6 * k) {
            Some((t, o, _)) => t < 48 && (1..4096).contains(&o),
            None => false,
        })
    };
    let mut out: Vec<ClassDef> = Vec::new();
    let mut cur = idents.keys().min().copied();
    while let Some(c) = cur {
        let Some(nm) = idents.get(&c) else { break };
        let name = String::from_utf8_lossy(nm).into_owned();
        let pad = (c + nm.len() + 2) & !1;
        let mut best: Option<(usize, usize)> = None;
        for n in 0..600 {
            let cand = pad + 6 * n;
            if cand > limit {
                break;
            }
            if idents.contains_key(&cand) && cand > c && triples_ok(pad, n) {
                best = Some((cand, n));
                break;
            }
        }
        let read = |n: usize| (0..n).map(|k| triple(b, pad + 6 * k).unwrap()).collect::<Vec<_>>();
        match best {
            None => {
                let mut n = 0;
                while pad + 6 * (n + 1) <= b.len() && triples_ok(pad, n + 1) {
                    n += 1;
                }
                if n > 0 {
                    out.push(ClassDef { name, off: c, trips: read(n) });
                }
                break;
            }
            Some((next, n)) => {
                out.push(ClassDef { name, off: c, trips: read(n) });
                cur = Some(next);
            }
        }
    }
    let end = out.last().map(|d| d.off).unwrap_or(start);
    (out, end)
}

/// The class-record run opens with `igObject`; the anchor whose walk yields the most classes wins
/// (later anchors can parse as a suffix of the directory).
fn find_directory_start(b: &[u8]) -> Result<usize> {
    let window = &b[..b.len().min(0x8000)];
    let cands: Vec<usize> = object_anchor().find_iter(window).map(|m| m.start() + 1).collect();
    if cands.is_empty() {
        fail!("could not locate a type directory in this blob");
    }
    let (mut best, mut bestn) = (cands[0], -1i64);
    for &c in &cands {
        let (recs, _) = walk_directory(b, c, b.len().min(c + 0x8000));
        if recs.len() as i64 > bestn {
            best = c;
            bestn = recs.len() as i64;
        }
    }
    Ok(best)
}

pub fn parse_directory(b: &[u8]) -> Result<Vec<ClassDef>> {
    let start = find_directory_start(b)?;
    Ok(walk_directory(b, start, b.len()).0)
}

const fn align4(x: usize) -> usize {
    (x + 3) & !3
}

/// Decode one record at `p`, or None if `p` is not a record start (`recordSize` must match).
pub fn decode_record(b: &[u8], p: usize, dirs: &[ClassDef]) -> Option<Record> {
    if p + 8 > b.len() {
        return None;
    }
    let cl = u32_at(b, p)? as usize;
    let size = u32_at(b, p + 4)? as usize;
    if cl >= dirs.len() || size < 8 || p + size > b.len() {
        return None;
    }
    let rec = &dirs[cl];
    let mut q = p + 8;
    let mut fields = Vec::with_capacity(rec.trips.len());
    let mut name: Option<String> = None;
    for &(ty, ordn, sz) in &rec.trips {
        let fname = if ty == 4 && name.is_none() { "_name".to_string() } else { format!("slot{ordn}") };
        if ty == 4 {
            let n = u32_at(b, q)? as usize;
            if !n.is_multiple_of(4) || n > 8192 || q + 4 + n > b.len() {
                return None;
            }
            if n > 0 && b[q + 4 + n - 1] != 0 {
                return None;
            }
            let s: String = if n > 0 {
                b[q + 4..q + 4 + n].split(|&c| c == 0).next().unwrap().iter().map(|&c| c as char).collect()
            } else {
                String::new()
            };
            if name.is_none() {
                name = Some(s.clone());
            }
            fields.push(Field { name: fname, value: Value::Str(s), ty });
            q += 4 + n;
            continue;
        }
        // The descriptor states its own width (per pack); padded to a 4-byte slot.
        let w = align4(sz as usize);
        if q + w > b.len() {
            return None;
        }
        let value = match ty {
            36 => {
                Value::Floats((0..3).map(|i| f32_at(b, q + 4 * i).map(|x| pyfmt::round(x, 4))).collect::<Option<_>>()?)
            }
            38 => {
                Value::Floats((0..4).map(|i| f32_at(b, q + 4 * i).map(|x| pyfmt::round(x, 4))).collect::<Option<_>>()?)
            }
            16 => Value::Float(pyfmt::round(f32_at(b, q)?, 4)),
            40 => Value::Floats((0..16).map(|i| f32_at(b, q + 4 * i)).collect::<Option<_>>()?),
            2 | 3 | 8 | 34 => Value::Int(*b.get(q)? as i64),
            12 => Value::Int(i64::from_le_bytes(b.get(q..q + 8)?.try_into().unwrap())),
            31 => Value::Float(f64::from_le_bytes(b.get(q..q + 8)?.try_into().unwrap())),
            10 => Value::Int(u16_at(b, q)? as i64),
            17 => Value::Int(u16_at(b, q)? as i16 as i64),
            _ => Value::Int(u32_at(b, q)? as i64),
        };
        fields.push(Field { name: fname, value, ty });
        q += w;
    }
    if q - p != size {
        return None;
    }
    Some(Record { off: p, class: rec.name.clone(), class_index: cl, size, name, fields, end: q })
}

/// Every maximal contiguous record chain, longest first. Every byte offset is tried (records start
/// at either parity), and a record start is a chain start only when no other record ends on it.
pub fn find_chains(b: &[u8], dirs: &[ClassDef], lo: usize) -> Vec<Vec<Record>> {
    let hi = b.len();
    let mut hits: Vec<(usize, usize)> = Vec::new();
    let mut p = lo;
    while p + 8 < hi {
        let cl = u32::from_le_bytes(b[p..p + 4].try_into().unwrap()) as usize;
        let size = u32::from_le_bytes(b[p + 4..p + 8].try_into().unwrap()) as usize;
        if cl < dirs.len() && (8..=8192).contains(&size) && p + size <= hi && decode_record(b, p, dirs).is_some() {
            hits.push((p, p + size));
        }
        p += 1;
    }
    let ends: HashSet<usize> = hits.iter().map(|&(_, e)| e).collect();
    let mut chains: Vec<Vec<Record>> = Vec::new();
    for &(p, _) in &hits {
        if ends.contains(&p) {
            continue;
        }
        let mut recs = Vec::new();
        let mut q = p;
        while let Some(r) = decode_record(b, q, dirs) {
            q = r.end;
            recs.push(r);
        }
        chains.push(recs);
    }
    chains.sort_by_key(|c| c[0].off);
    let mut keep: Vec<Vec<Record>> = Vec::new();
    let mut far: i64 = -1;
    for c in chains {
        if (c[0].off as i64) < far {
            continue;
        }
        far = far.max(c.last().unwrap().end as i64);
        keep.push(c);
    }
    keep.sort_by_key(|c| std::cmp::Reverse(c.len()));
    keep
}

/// The type directory and the two multi-record chains.
fn sections(b: &[u8]) -> Result<(Vec<ClassDef>, Vec<Record>, Vec<Record>)> {
    let dirs = parse_directory(b)?;
    let mut chains: Vec<Vec<Record>> = find_chains(b, &dirs, 0x800).into_iter().filter(|c| c.len() > 1).collect();
    chains.sort_by_key(|c| c[0].off);
    if chains.len() < 2 {
        fail!("expected two object chains, found {}", chains.len());
    }
    let s2 = chains.remove(1);
    let s1 = chains.remove(0);
    Ok((dirs, s1, s2))
}

/// The id remap table in the gap before section 2: (offset, id count, section-2 record per id).
fn find_table(b: &[u8], s1: &[Record], s2: &[Record]) -> Result<(usize, usize, Vec<Option<usize>>)> {
    let lo = s1.last().unwrap().end;
    let hi = s2[0].off;
    let want: Vec<i64> = s2.iter().map(|r| r.class_index as i64).collect();
    let mut p = lo;
    while p + 8 < lo.max(hi) {
        let tb = u32_at(b, p).unwrap() as usize;
        let cnt = u32_at(b, p + 4).unwrap() as usize;
        let next = p + 2;
        if !(8 <= tb && tb <= b.len() - p) || !(0 < cnt && cnt < 200_000) || p + 8 + 2 * cnt > b.len() {
            p = next;
            continue;
        }
        let vals: Vec<usize> = (0..cnt).map(|i| u16_at(b, p + 8 + 2 * i).unwrap() as usize).collect();
        if *vals.iter().max().unwrap() >= s1.len() {
            p = next;
            continue;
        }
        let mut obj: Vec<(usize, &Record)> = Vec::new();
        for (i, &v) in vals.iter().enumerate() {
            if s1[v].class == "igObjectDirEntry" {
                obj.push((i, &s1[v]));
            }
        }
        // igObjectDirEntry._typeMetaIndex is one of the two int slots (11, 12).
        let slot = ["slot11", "slot12"].into_iter().find(|s| {
            obj.len() == want.len()
                && obj.iter().zip(&want).all(|((_, r), w)| r.field(s).and_then(Value::int) == Some(*w))
        });
        if slot.is_none() {
            p = next;
            continue;
        }
        let mut obj_of_id = vec![None; cnt];
        for (k, (i, _)) in obj.iter().enumerate() {
            obj_of_id[*i] = Some(k);
        }
        return Ok((p, cnt, obj_of_id));
    }
    fail!("no validated id remap table in 0x{lo:x}..0x{hi:x}")
}

/// List element values, by list class.
#[derive(Debug, Clone, PartialEq)]
pub enum ListValue {
    Int(i64),
    Float(f64),
    Vec3([f64; 3]),
}

impl ListValue {
    pub fn int(&self) -> Option<i64> {
        match self {
            ListValue::Int(v) => Some(*v),
            _ => None,
        }
    }
}

/// Resolved view of a pack: records, the id remap table and memory-block contents.
///
/// Ids that land on an `igMemoryDirEntry` are memory blocks (`_memSize` bytes), stored after the
/// object records in ascending id order, each padded to 4 bytes, tiling the rest of the pack.
pub struct Graph {
    pub b: Vec<u8>,
    pub s1: Vec<Record>,
    pub s2: Vec<Record>,
    pub id_count: usize,
    obj_of_id: Vec<Option<usize>>,
    block: HashMap<usize, usize>,
    block_size: HashMap<usize, usize>,
}

impl Graph {
    pub fn new(data: Vec<u8>) -> Result<Graph> {
        let (_dirs, s1, s2) = sections(&data)?;
        let (off, id_count, obj_of_id) = find_table(&data, &s1, &s2)?;
        let mut block = HashMap::new();
        let mut block_size = HashMap::new();
        let mut cursor = s2.last().unwrap().end;
        for gid in 0..id_count {
            let entry = &s1[u16_at(&data, off + 8 + 2 * gid).unwrap() as usize];
            if entry.class != "igMemoryDirEntry" {
                continue;
            }
            let size =
                entry.field("slot7").and_then(Value::int).ok_or_else(|| Error("memory entry without a size".into()))?
                    as usize;
            block.insert(gid, cursor);
            block_size.insert(gid, size);
            cursor += (size + 3) & !3;
        }
        if cursor != data.len() {
            fail!("memory blocks end at {cursor}, pack is {} bytes", data.len());
        }
        Ok(Graph { b: data, s1, s2, id_count, obj_of_id, block, block_size })
    }

    /// Field values of section-2 record `k`, in descriptor order.
    pub fn vals(&self, k: usize) -> Vec<&Value> {
        self.s2[k].fields.iter().map(|f| &f.value).collect()
    }

    pub fn class(&self, k: usize) -> &str {
        &self.s2[k].class
    }

    /// The section-2 record a global id refers to.
    pub fn r#ref(&self, value: &Value) -> Option<usize> {
        let v = value.int()?;
        if v < 0 || v as usize >= self.id_count {
            return None;
        }
        self.obj_of_id[v as usize]
    }

    pub fn has_block(&self, memory_id: usize) -> bool {
        self.block.contains_key(&memory_id)
    }

    pub fn block_start(&self, memory_id: usize) -> Option<usize> {
        self.block.get(&memory_id).copied()
    }

    /// `size` bytes of the memory block with global id `memory_id`.
    pub fn block(&self, memory_id: usize, size: usize) -> Result<&[u8]> {
        let start = *self.block.get(&memory_id).ok_or_else(|| Error(format!("no memory block {memory_id}")))?;
        if start + size > self.b.len() {
            fail!("block {memory_id} ({size} bytes) runs past the pack");
        }
        Ok(&self.b[start..start + size])
    }

    pub fn block_size(&self, memory_id: usize) -> Option<usize> {
        self.block_size.get(&memory_id).copied()
    }

    /// Contents of list record `k`: ints/floats by list class, raw element ids otherwise.
    pub fn list_values(&self, k: usize) -> Result<Vec<ListValue>> {
        let cls = self.class(k).to_string();
        let vals = self.vals(k);
        let count = vals.first().and_then(|v| v.int()).ok_or_else(|| Error("list without a count".into()))?;
        if count <= 0 {
            return Ok(Vec::new());
        }
        let data_id = vals.get(2).and_then(|v| v.int()).ok_or_else(|| Error("list without data".into()))? as usize;
        let base = self.block_start(data_id).ok_or_else(|| Error(format!("no memory block {data_id}")))?;
        let b = &self.b;
        let count = count as usize;
        let read = |size: usize, j: usize| -> Result<&[u8]> {
            b.get(base + size * j..base + size * (j + 1)).ok_or_else(|| Error("list runs past the pack".into()))
        };
        let mut out = Vec::with_capacity(count);
        for j in 0..count {
            out.push(match cls.as_str() {
                "igFloatList" => ListValue::Float(f32::from_le_bytes(read(4, j)?.try_into().unwrap()) as f64),
                "igVec3fList" => {
                    let s = read(12, j)?;
                    let f = |i: usize| f32::from_le_bytes(s[4 * i..4 * i + 4].try_into().unwrap()) as f64;
                    ListValue::Vec3([f(0), f(1), f(2)])
                }
                "igShortList" => ListValue::Int(i16::from_le_bytes(read(2, j)?.try_into().unwrap()) as i64),
                "igCharList" => ListValue::Int(read(1, j)?[0] as i8 as i64),
                "igBoolList" => ListValue::Int(read(1, j)?[0] as i64),
                "igIntList" => ListValue::Int(i32::from_le_bytes(read(4, j)?.try_into().unwrap()) as i64),
                _ => ListValue::Int(u32::from_le_bytes(read(4, j)?.try_into().unwrap()) as i64),
            });
        }
        Ok(out)
    }

    /// Resolve list elements that are object ids.
    pub fn list_refs(&self, k: usize) -> Result<Vec<Option<usize>>> {
        Ok(self.list_values(k)?.iter().map(|v| v.int().and_then(|i| self.r#ref(&Value::Int(i)))).collect())
    }

    /// Strings of an `igNamedObjectList` (None where an element does not resolve).
    pub fn names(&self, k: usize) -> Result<Vec<Option<String>>> {
        Ok(self
            .list_refs(k)?
            .into_iter()
            .map(|r| match r {
                Some(r) if self.s2[r].class == "igNamedObject" => self.s2[r].name.clone(),
                _ => None,
            })
            .collect())
    }
}

/// The first chain of a pack whose records name its files (the root manifest).
pub fn first_chain(b: &[u8]) -> Result<(Vec<ClassDef>, Vec<Record>)> {
    let dirs = parse_directory(b)?;
    let chain = find_chains(b, &dirs, 0x800).into_iter().next().ok_or_else(|| Error("no records".into()))?;
    Ok((dirs, chain))
}

//! Lua 4.0.1 bytecode decompiler for the scripts inside DW4 stage packs.
//!
//! The stage readers parse the decompiled text with regexes, so the text format matters, quirks
//! included; it matches the Python decompiler this was ported from. Wherever that one raised (an
//! out-of-range constant or jump target, a truncated chunk) this returns `Err`, and
//! `decompile_chunks` skips that chunk.
//!
//! Instruction layout (verified against reference Lua 4.0.1): `OP(6) | B(9 bits @6) | A(17 bits @15)`.
//! Jump opcodes are the stock pop variants, so scripts have no `and`/`or` short-circuit, and local
//! variable names are stripped, so locals get synthetic names (`local_0`...).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::error::{Error, Result};
use crate::fail;
use crate::pyfmt;

const MAXARG_S: i64 = (1 << 25) - 1;

const OP_END: u32 = 0;
const OP_RETURN: u32 = 1;
const OP_CALL: u32 = 2;
const OP_TAILCALL: u32 = 3;
const OP_PUSHNIL: u32 = 4;
const OP_POP: u32 = 5;
const OP_PUSHINT: u32 = 6;
const OP_PUSHSTRING: u32 = 7;
const OP_PUSHNUM: u32 = 8;
const OP_PUSHNEGNUM: u32 = 9;
const OP_PUSHUPVALUE: u32 = 10;
const OP_GETLOCAL: u32 = 11;
const OP_GETGLOBAL: u32 = 12;
const OP_GETTABLE: u32 = 13;
const OP_GETDOTTED: u32 = 14;
const OP_GETINDEXED: u32 = 15;
const OP_PUSHSELF: u32 = 16;
const OP_CREATETABLE: u32 = 17;
const OP_SETLOCAL: u32 = 18;
const OP_SETGLOBAL: u32 = 19;
const OP_SETTABLE: u32 = 20;
const OP_SETLIST: u32 = 21;
const OP_SETMAP: u32 = 22;
const OP_ADD: u32 = 23;
const OP_ADDI: u32 = 24;
const OP_SUB: u32 = 25;
const OP_MULT: u32 = 26;
const OP_DIV: u32 = 27;
const OP_POW: u32 = 28;
const OP_CONCAT: u32 = 29;
const OP_MINUS: u32 = 30;
const OP_NOT: u32 = 31;
const OP_JMPNE: u32 = 32;
const OP_JMPGE: u32 = 37;
const OP_JMPT: u32 = 38;
const OP_JMPF: u32 = 39;
const OP_JMP: u32 = 42;
const OP_FORPREP: u32 = 44;
const OP_FORLOOP: u32 = 45;
const OP_LFORPREP: u32 = 46;
const OP_LFORLOOP: u32 = 47;
const OP_CLOSURE: u32 = 48;

/// The comparison jumps OP_JMPNE..=OP_JMPGE.
fn is_cmp_jump(op: u32) -> bool {
    (OP_JMPNE..=OP_JMPGE).contains(&op)
}

/// Comparison and truth jumps: the ones that open an `if` or `while`.
fn is_cond_jump(op: u32) -> bool {
    is_cmp_jump(op) || op == OP_JMPT || op == OP_JMPF
}

/// Every jump with a target (OP_JMPNE..=OP_JMP).
fn is_jump(op: u32) -> bool {
    (OP_JMPNE..=OP_JMP).contains(&op)
}

/// A comparison jump skips the then-body when the comparison is true, so the reconstructed
/// condition is the inverse comparison.
fn inverse_comparison(op: u32) -> &'static str {
    ["==", "~=", ">=", ">", "<=", "<"][(op - OP_JMPNE) as usize]
}

/// A parsed Lua function prototype.
#[derive(Debug, Clone)]
pub struct Function {
    pub numparams: i32,
    pub is_vararg: u8,
    pub kstr: Vec<Option<String>>,
    pub knum: Vec<f64>,
    pub kproto: Vec<Function>,
    pub code: Vec<u32>,
}

// ---------------------------------------------------------------- parser

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        match self.data.get(self.pos..self.pos.saturating_add(n)) {
            Some(bytes) => {
                self.pos += n;
                Ok(bytes)
            }
            _ => fail!("Lua chunk truncated at {}", self.pos),
        }
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    /// A length-prefixed string, latin1 with trailing NULs stripped; length 0 is a null string.
    /// Like the Python slice, a length running past the data reads what is there and moves on,
    /// so only the next read fails.
    fn string(&mut self) -> Result<Option<String>> {
        let n = self.u32()? as usize;
        if n == 0 {
            return Ok(None);
        }
        let start = self.pos.min(self.data.len());
        let end = self.pos.saturating_add(n).min(self.data.len());
        let mut raw = &self.data[start..end];
        while let [rest @ .., 0] = raw {
            raw = rest;
        }
        self.pos = self.pos.saturating_add(n);
        Ok(Some(raw.iter().map(|&b| b as char).collect()))
    }
}

fn parse_function(c: &mut Reader) -> Result<Function> {
    let _depth = Depth::enter()?;
    c.string()?; // source
    c.i32()?; // lineDefined
    let numparams = c.i32()?;
    let is_vararg = c.u8()?;
    c.i32()?; // maxstack
    for _ in 0..c.i32()?.max(0) {
        c.string()?; // local name
        c.i32()?; // startpc
        c.i32()?; // endpc
    }
    for _ in 0..c.i32()?.max(0) {
        c.i32()?; // line info
    }
    let mut kstr = Vec::new();
    for _ in 0..c.i32()?.max(0) {
        kstr.push(c.string()?);
    }
    let mut knum = Vec::new();
    for _ in 0..c.i32()?.max(0) {
        knum.push(c.f64()?);
    }
    let mut kproto = Vec::new();
    for _ in 0..c.i32()?.max(0) {
        kproto.push(parse_function(c)?);
    }
    let mut code = Vec::new();
    for _ in 0..c.i32()?.max(0) {
        code.push(c.u32()?);
    }
    Ok(Function { numparams, is_vararg, kstr, knum, kproto, code })
}

/// Parse the chunk starting at `off`: (main function, chunk size in bytes).
pub fn parse_chunk(data: &[u8], off: usize) -> Result<(Function, usize)> {
    let mut c = Reader { data, pos: off };
    if c.u8()? != 0x1B || c.take(3)? != b"Lua" {
        fail!("no Lua chunk at {off}");
    }
    c.u8()?; // version
    c.u8()?; // endianness
    c.take(7)?; // type sizes
    c.f64()?; // test number
    let main = parse_function(&mut c)?;
    Ok((main, c.pos - off))
}

// ---------------------------------------------------------------- expressions

const PREC_OR: u8 = 1;
const PREC_AND: u8 = 2;
const PREC_COMPARE: u8 = 3;
const PREC_CONCAT: u8 = 4;
const PREC_ADD: u8 = 5;
const PREC_MUL: u8 = 6;
const PREC_UNARY: u8 = 7;
const PREC_POW: u8 = 8;
const PREC_ATOM: u8 = 100;

/// A table constructor. Array items set by OP_SETLIST only ever render as `???`, so only their
/// count is kept. Shared and mutable: OP_SETLIST/OP_SETMAP fill the constructor wherever it sits
/// on the stack, including copies held by enclosing blocks, as the Python's shared tuples do.
#[derive(Debug, Default)]
struct Table {
    array: usize,
    hash: Vec<(E, E)>,
}

type E = Rc<Expr>;

/// A reconstructed expression. `None` names stand for null strings in the constant table: the
/// Python formats them as `None` in f-strings and fails when concatenating them.
#[derive(Debug)]
enum Expr {
    Nil,
    /// An integer constant (OP_PUSHINT, OP_ADDI).
    Int(i64),
    /// A number constant from the constant table.
    Num(f64),
    Str(Option<String>),
    Local(String),
    Global(Option<String>),
    Index(E, E),
    Dot(E, Option<String>),
    Binop(&'static str, E, E),
    Unop(&'static str, E),
    Call(E, Vec<E>),
    Method(E, Option<String>, Vec<E>),
    Table(Rc<RefCell<Table>>),
    Func(String),
}

/// The shared `nil` constant. OP_PUSHNIL counts can be huge in false chunks; one shared value
/// keeps the stack as small as the Python's, which pushes one constant tuple.
fn nil() -> E {
    thread_local! {
        static NIL: E = Rc::new(Expr::Nil);
    }
    NIL.with(Rc::clone)
}

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n"))
}

/// A rendered value used in string concatenation, where the Python fails on `None`.
fn need(s: Option<String>) -> Result<String> {
    s.ok_or_else(|| Error("null string constant in an expression".into()))
}

/// A rendered value inside an f-string, where the Python prints `None` as `None`.
fn show(s: Option<String>) -> String {
    s.unwrap_or_else(|| "None".into())
}

/// Rendered items joined with `, `, built in place: false chunks can pass millions of values.
fn join(items: &[E]) -> Result<String> {
    let mut out = String::new();
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push_str(&need(render(item)?)?);
    }
    Ok(out)
}

/// A number constant: integral values below 1e15 print as integers (so -0.0 prints `0`), the
/// rest as Python's `repr`. NaN and infinities fail like Python's `int(v)`.
fn render_number(v: f64) -> Result<String> {
    if !v.is_finite() {
        fail!("cannot convert {v} to an integer");
    }
    if v == v.trunc() && v.abs() < 1e15 {
        Ok(format!("{}", v as i64))
    } else {
        Ok(pyfmt::repr(v))
    }
}

/// How deep expressions and nested blocks may go. Real scripts stay far below it; a damaged
/// chunk past it is skipped, as the Python skipped one that hit its recursion limit, instead of
/// exhausting the stack or memory.
const MAX_DEPTH: usize = 300;

thread_local! {
    static DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Counts one level of recursion while it lives.
struct Depth;

impl Depth {
    fn enter() -> Result<Depth> {
        let depth = DEPTH.with(|d| {
            d.set(d.get() + 1);
            d.get()
        });
        let guard = Depth;
        if depth > MAX_DEPTH {
            fail!("nested more than {MAX_DEPTH} levels deep");
        }
        Ok(guard)
    }
}

impl Drop for Depth {
    fn drop(&mut self) {
        DEPTH.with(|d| d.set(d.get() - 1));
    }
}

/// Source text of an expression; `None` only for a global named by a null string.
fn render(expr: &Expr) -> Result<Option<String>> {
    let _depth = Depth::enter()?;
    Ok(Some(match expr {
        Expr::Nil => "nil".into(),
        Expr::Int(v) => v.to_string(),
        Expr::Num(v) => render_number(*v)?,
        Expr::Str(s) => match s {
            Some(s) => quote(s),
            None => fail!("null string constant"),
        },
        Expr::Local(name) => name.clone(),
        Expr::Global(name) => return Ok(name.clone()),
        Expr::Index(t, key) => format!("{}[{}]", need(render(t)?)?, need(render(key)?)?),
        Expr::Dot(t, name) => format!("{}.{}", need(render(t)?)?, need(name.clone())?),
        Expr::Binop(op, l, r) => {
            let lp = prec_of_op(op);
            let rp = if matches!(*op, ".." | "^") { lp } else { lp + 1 };
            format!("{} {op} {}", show(render_with(l, lp)?), show(render_with(r, rp)?))
        }
        Expr::Unop(op, operand) => {
            let inner = need(render_with(operand, PREC_UNARY)?)?;
            if *op == "not" {
                format!("not {inner}")
            } else {
                format!("{op}{inner}")
            }
        }
        Expr::Call(func, args) => format!("{}({})", need(render_with(func, PREC_ATOM)?)?, join(args)?),
        Expr::Method(recv, name, args) => {
            format!("{}:{}({})", need(render_with(recv, PREC_ATOM)?)?, need(name.clone())?, join(args)?)
        }
        Expr::Table(t) => {
            let t = t.borrow();
            let mut parts = vec!["???".to_string(); t.array];
            for (k, v) in &t.hash {
                parts.push(format!("[{}] = {}", show(render(k)?), show(render(v)?)));
            }
            format!("{{{}}}", parts.join(", "))
        }
        Expr::Func(src) => src.clone(),
    }))
}

fn render_with(expr: &Expr, min_prec: u8) -> Result<Option<String>> {
    let s = render(expr)?;
    if prec_of(expr) < min_prec {
        return Ok(Some(format!("({})", need(s)?)));
    }
    Ok(s)
}

fn prec_of(expr: &Expr) -> u8 {
    match expr {
        Expr::Binop(op, _, _) => prec_of_op(op),
        Expr::Unop(..) => PREC_UNARY,
        // anonymous functions are always parenthesised in call position
        Expr::Func(_) => 0,
        _ => PREC_ATOM,
    }
}

fn prec_of_op(op: &str) -> u8 {
    match op {
        "or" => PREC_OR,
        "and" => PREC_AND,
        "~=" | "==" | "<" | ">" | "<=" | ">=" => PREC_COMPARE,
        ".." => PREC_CONCAT,
        "+" | "-" => PREC_ADD,
        "*" | "/" => PREC_MUL,
        "^" => PREC_POW,
        _ => PREC_ATOM,
    }
}

// ---------------------------------------------------------------- decompiler

/// A statement line: (indent level, text).
type Stmt = (usize, String);

struct Ins {
    op: u32,
    u: i64,
    s: i64,
    b: i64,
    a: i64,
}

fn indent_block(stmts: Vec<Stmt>, extra: usize) -> impl Iterator<Item = Stmt> {
    stmts.into_iter().map(move |(lev, t)| (lev + extra, t))
}

/// Symbolic execution of one function. Program counters are `i64` because jump targets can be
/// negative, and the Python then indexes `code` from the end; `code_at` reproduces that.
struct Decompiler<'f> {
    code: &'f [u32],
    kstr: &'f [Option<String>],
    knum: &'f [f64],
    kproto: &'f [Function],
    nparams: i32,
    local_names: HashMap<i64, String>,
    stack: Vec<E>,
    stmts: Vec<Stmt>,
    pc: i64,
    end: i64,
    jump_tgt: HashMap<i64, i64>,
    memo: HashMap<(i64, i64), (Vec<Stmt>, i64)>,
}

impl<'f> Decompiler<'f> {
    fn new(f: &'f Function) -> Self {
        Decompiler {
            code: &f.code,
            kstr: &f.kstr,
            knum: &f.knum,
            kproto: &f.kproto,
            nparams: f.numparams,
            local_names: HashMap::new(),
            stack: Vec::new(),
            stmts: Vec::new(),
            pc: 0,
            end: f.code.len() as i64,
            jump_tgt: HashMap::new(),
            memo: HashMap::new(),
        }
    }

    // -- name/const helpers --

    fn local(&mut self, idx: i64) -> String {
        self.local_names.entry(idx).or_insert_with(|| format!("local_{idx}")).clone()
    }

    /// A string constant; an index past the table gives a placeholder, as in the Python.
    fn s(&self, k: i64) -> E {
        Rc::new(Expr::Str(match self.kstr.get(k as usize) {
            Some(s) => s.clone(),
            None => Some(format!("<str[{k}]>")),
        }))
    }

    fn n(&self, k: i64) -> E {
        Rc::new(Expr::Num(self.knum.get(k as usize).copied().unwrap_or(0.0)))
    }

    /// A string constant used as a name, where an index past the table fails.
    fn kstr_at(&self, u: i64) -> Result<Option<String>> {
        match self.kstr.get(u as usize) {
            Some(s) => Ok(s.clone()),
            None => fail!("string constant {u} out of range"),
        }
    }

    /// `code[pc]` with Python indexing: negative indices count from the end.
    fn code_at(&self, pc: i64) -> Result<u32> {
        let n = self.code.len() as i64;
        let i = if pc < 0 { pc + n } else { pc };
        if i < 0 || i >= n {
            fail!("instruction {pc} out of range");
        }
        Ok(self.code[i as usize])
    }

    fn op_at(&self, pc: i64) -> Result<u32> {
        Ok(self.code_at(pc)? & 0x3F)
    }

    fn decode(&self, pc: i64) -> Result<Ins> {
        let ins = self.code_at(pc)?;
        let u = (ins >> 6) as i64;
        Ok(Ins { op: ins & 0x3F, u, s: u - MAXARG_S, b: ((ins >> 6) & 0x1ff) as i64, a: (ins >> 15) as i64 })
    }

    fn jt(&self, pc: i64) -> Result<i64> {
        Ok(pc + 1 + self.decode(pc)?.s)
    }

    fn push(&mut self, e: E) {
        self.stack.push(e);
    }

    fn pop(&mut self) -> E {
        self.stack.pop().unwrap_or_else(nil)
    }

    fn pop_n(&mut self, n: i64) -> Vec<E> {
        let mut vals: Vec<E> = (0..n.max(0)).map(|_| self.pop()).collect();
        vals.reverse();
        vals
    }

    fn emit(&mut self, text: String) {
        self.stmts.push((0, text));
    }

    fn decompile(mut self) -> Result<Vec<Stmt>> {
        for pc in 0..self.code.len() as i64 {
            if is_jump(self.op_at(pc)?) {
                let t = self.jt(pc)?;
                self.jump_tgt.insert(pc, t);
            }
        }
        self.pc = 0;
        // the function's parameters occupy the lowest stack slots
        for i in 0..self.nparams.max(0) as i64 {
            let name = self.local(i);
            self.push(Rc::new(Expr::Local(name)));
        }
        self.collect(self.end)?;
        Ok(self.stmts)
    }

    /// Decompile statements until `limit` or an unconditional jump; returns where it stopped.
    fn collect(&mut self, limit: i64) -> Result<i64> {
        while self.pc < limit {
            let pc = self.pc;
            let op = self.op_at(pc)?;
            if op == OP_JMP {
                return Ok(pc);
            }
            if is_cond_jump(op) {
                self.if_or_while()?;
            } else if op == OP_FORPREP {
                self.num_for()?;
            } else if op == OP_LFORPREP {
                self.lfor()?;
            } else {
                self.pc = self.step(pc)?;
            }
        }
        Ok(self.pc)
    }

    fn find_backjump(&self, start: i64, end: i64) -> Result<Option<i64>> {
        for pc in start..end {
            if self.op_at(pc)? == OP_JMP && self.jt(pc)? <= pc {
                return Ok(Some(pc));
            }
        }
        Ok(None)
    }

    fn pop_cond(&mut self, op: u32) -> E {
        if is_cmp_jump(op) {
            let rhs = self.pop();
            let lhs = self.pop();
            return Rc::new(Expr::Binop(inverse_comparison(op), lhs, rhs));
        }
        match op {
            // jump if truthy -> skip when `x` truthy -> condition is `not x`
            OP_JMPT => Rc::new(Expr::Unop("not", self.pop())),
            // jump if falsy -> skip when `x` falsy -> condition is `x`
            OP_JMPF => self.pop(),
            _ => nil(),
        }
    }

    fn if_or_while(&mut self) -> Result<()> {
        let pc = self.pc;
        let op = self.op_at(pc)?;
        let t = self.jt(pc)?;
        let mut cond = self.pop_cond(op);

        // `and`-chain detection: the game compiles `a and b and c` as nested ifs whose conditions
        // all jump to the same else target. Collect them into one flat condition (this also
        // prevents exponential re-decoding of the shared else body).
        let mut scan = pc + 1;
        while scan < t {
            let Some(cj) = self.find_cond_jump_to(scan, t, t)? else { break };
            self.run_expr(scan, cj)?;
            let c = self.pop_cond(self.op_at(cj)?);
            cond = Rc::new(Expr::Binop("and", cond, c));
            scan = cj + 1;
        }

        if let Some(back) = self.find_backjump(scan, t)? {
            let (body, _) = self.collect_sub(scan, back)?;
            self.emit(format!("while {} do", show(render(&cond)?)));
            self.stmts.extend(indent_block(body, 1));
            self.emit("end".into());
            self.pc = t;
        } else {
            self.emit_if(scan, t, &cond)?;
        }
        Ok(())
    }

    /// The first conditional jump in [start, end) that targets `target`, with no unconditional
    /// jump before it.
    fn find_cond_jump_to(&self, start: i64, end: i64, target: i64) -> Result<Option<i64>> {
        for pc in start..end {
            let op = self.op_at(pc)?;
            if op == OP_JMP {
                return Ok(None);
            }
            if is_cond_jump(op) && self.jt(pc)? == target {
                return Ok(Some(pc));
            }
        }
        Ok(None)
    }

    /// Run [start, end) as a pure expression: values are pushed, statements are dropped.
    fn run_expr(&mut self, start: i64, end: i64) -> Result<()> {
        let saved_stmts = std::mem::take(&mut self.stmts);
        let saved_pc = self.pc;
        self.pc = start;
        while self.pc < end {
            self.pc = self.step(self.pc)?;
        }
        self.stmts = saved_stmts;
        self.pc = saved_pc;
        Ok(())
    }

    fn emit_if(&mut self, then_start: i64, else_pc: i64, cond: &Expr) -> Result<()> {
        // then body = [then_start, else_pc); it stops early at a forward JMP
        let (then_body, stop_pc) = self.collect_sub(then_start, else_pc)?;
        self.emit(format!("if {} then", show(render(cond)?)));
        self.stmts.extend(indent_block(then_body, 1));
        if stop_pc < else_pc {
            // stopped at a forward JMP: there is an else / elseif at else_pc
            let Some(&skip_target) = self.jump_tgt.get(&stop_pc) else {
                fail!("no jump target recorded at {stop_pc}");
            };
            let (mut else_body, _) = self.collect_sub(else_pc, skip_target)?;
            if is_single_if(&else_body) {
                // Flatten `else if ...` into `elseif ...`; the inner levels are already right.
                // The test only looks at the first and last lines, so an else body of several
                // statements that starts with an `if` and ends with an `end` is flattened too.
                else_body.pop();
                let mut lines = else_body.into_iter();
                let head = lines.next().expect("checked by is_single_if").1;
                self.stmts.push((0, head.replacen("if ", "elseif ", 1)));
                self.stmts.extend(lines);
                self.stmts.push((0, "end".into()));
            } else {
                self.emit("else".into());
                self.stmts.extend(indent_block(else_body, 1));
                self.emit("end".into());
            }
            self.pc = skip_target;
        } else {
            self.emit("end".into());
            self.pc = else_pc;
        }
        Ok(())
    }

    /// Decompile [start, end) into a statement list. The block sees a copy of the current stack
    /// (locals and loop control slots stay visible), but its stack changes are discarded. Returns
    /// (statements, stop pc): stop pc is `end`, or less when a forward JMP ended the block.
    ///
    /// Memoised by (start, end) whatever the stack holds: deeply nested if-chains often share one
    /// else body, and re-decompiling it per nesting level blows up exponentially.
    fn collect_sub(&mut self, start: i64, end: i64) -> Result<(Vec<Stmt>, i64)> {
        if let Some((result, stop)) = self.memo.get(&(start, end)) {
            return Ok((result.clone(), *stop));
        }
        let _depth = Depth::enter()?;
        let saved_stack = self.stack.clone();
        let saved_stmts = std::mem::take(&mut self.stmts);
        let saved_pc = self.pc;
        self.pc = start;
        let stop = self.collect(end)?;
        let result = std::mem::replace(&mut self.stmts, saved_stmts);
        self.stack = saved_stack;
        self.pc = saved_pc;
        self.memo.insert((start, end), (result.clone(), stop));
        Ok((result, stop))
    }

    fn num_for(&mut self) -> Result<()> {
        let pc = self.pc;
        let step = self.pop();
        let limit = self.pop();
        let init = self.pop();
        let var_pos = self.stack.len() as i64; // the init slot is the loop variable
        let varname = self.local(var_pos);
        // keep the three control slots on the stack while the body runs
        self.push(Rc::new(Expr::Local(varname.clone())));
        self.push(Rc::new(Expr::Local(format!("{varname}_limit"))));
        self.push(Rc::new(Expr::Local(format!("{varname}_step"))));
        let body_start = pc + 1;
        let after = self.jt(pc)?;
        // Empty-loop branches can be threaded past the loop's immediate end. Pair by the back
        // edge, which also distinguishes nested loops.
        let mut pc2 = None;
        for p in body_start..self.code.len() as i64 {
            if self.op_at(p)? == OP_FORLOOP && self.jt(p)? == body_start {
                pc2 = Some(p);
                break;
            }
        }
        let Some(pc2) = pc2 else { fail!("FORPREP at {pc} has no matching FORLOOP") };
        // the body runs inline: its stack changes carry over
        let saved_stmts = std::mem::take(&mut self.stmts);
        let saved_pc = self.pc;
        self.pc = body_start;
        self.collect(pc2)?;
        let body = std::mem::replace(&mut self.stmts, saved_stmts);
        self.pc = saved_pc;
        self.pop();
        self.pop();
        self.pop();
        let sstep = show(render(&step)?);
        let (sinit, slimit) = (show(render(&init)?), show(render(&limit)?));
        if sstep == "1" {
            self.emit(format!("for {varname} = {sinit}, {slimit} do"));
        } else {
            self.emit(format!("for {varname} = {sinit}, {slimit}, {sstep} do"));
        }
        self.stmts.extend(indent_block(body, 1));
        self.emit("end".into());
        self.pc = after;
        Ok(())
    }

    /// Generic `for`: absent from the game's scripts, so best-effort.
    fn lfor(&mut self) -> Result<()> {
        let pc = self.pc;
        let iter_expr = self.pop();
        let after = self.jt(pc)?;
        let body_start = pc + 1;
        let mut pc2 = self.end - 1;
        for p in body_start..self.end {
            if self.op_at(p)? == OP_LFORLOOP {
                pc2 = p;
                break;
            }
        }
        let (body, _) = self.collect_sub(body_start, pc2)?;
        self.emit(format!("for k, v in {} do", show(render(&iter_expr)?)));
        self.stmts.extend(indent_block(body, 1));
        self.emit("end".into());
        self.pc = after;
        Ok(())
    }

    /// The table constructor nearest the top of the stack (for SETLIST/SETMAP), if any.
    fn peek_table(&self) -> Option<Rc<RefCell<Table>>> {
        self.stack.iter().rev().find_map(|e| match &**e {
            Expr::Table(t) => Some(t.clone()),
            _ => None,
        })
    }

    fn binop(&mut self, op: &'static str) {
        let r = self.pop();
        let l = self.pop();
        self.push(Rc::new(Expr::Binop(op, l, r)));
    }

    /// Execute one instruction; returns the next pc.
    fn step(&mut self, pc: i64) -> Result<i64> {
        let Ins { op, u, s, b, a } = self.decode(pc)?;
        match op {
            OP_END => {}
            OP_RETURN => {
                let vals = if u == 0 { std::mem::take(&mut self.stack) } else { self.pop_n(u) };
                self.emit(format!("return {}", join(&vals)?));
            }
            OP_CALL | OP_TAILCALL => {
                let func_pos = a;
                let nargs = self.stack.len() as i64 - func_pos - 1;
                let args = self.pop_n(nargs);
                let func = self.pop();
                self.stack.truncate(func_pos as usize);
                let call = match &*func {
                    // args[0] is the receiver (self) pushed by PUSHSELF
                    Expr::Method(recv, name, _) => {
                        Expr::Method(recv.clone(), name.clone(), args.get(1..).unwrap_or_default().to_vec())
                    }
                    _ => Expr::Call(func.clone(), args),
                };
                if b == 0 {
                    self.emit(need(render(&call)?)?);
                } else {
                    self.push(Rc::new(call));
                }
            }
            OP_PUSHNIL => {
                for _ in 0..u {
                    self.push(nil());
                }
            }
            OP_POP => {
                let keep = self.stack.len().saturating_sub(u as usize);
                self.stack.truncate(keep);
            }
            OP_PUSHINT => self.push(Rc::new(Expr::Int(s))),
            OP_PUSHSTRING => self.push(self.s(u)),
            OP_PUSHNUM => self.push(self.n(u)),
            OP_PUSHNEGNUM => self.push(Rc::new(Expr::Unop("-", self.n(u)))),
            OP_PUSHUPVALUE => self.push(Rc::new(Expr::Global(Some(format!("upvalue_{u}"))))),
            OP_GETLOCAL => {
                let name = self.local(u);
                self.push(Rc::new(Expr::Local(name)));
            }
            OP_GETGLOBAL => self.push(Rc::new(Expr::Global(self.kstr_at(u)?))),
            OP_GETTABLE => {
                let key = self.pop();
                let t = self.pop();
                self.push(Rc::new(Expr::Index(t, key)));
            }
            OP_GETDOTTED => {
                let t = self.pop();
                self.push(Rc::new(Expr::Dot(t, self.kstr_at(u)?)));
            }
            OP_GETINDEXED => {
                let t = self.pop();
                let key = Rc::new(Expr::Local(self.local(u)));
                self.push(Rc::new(Expr::Index(t, key)));
            }
            OP_PUSHSELF => {
                // PUSHSELF pushes two values, the method and the receiver (the self argument),
                // so CALL's absolute stack positions stay right.
                let recv = self.pop();
                self.push(Rc::new(Expr::Method(recv.clone(), self.kstr_at(u)?, Vec::new())));
                self.push(recv);
            }
            OP_CREATETABLE => self.push(Rc::new(Expr::Table(Rc::default()))),
            OP_SETLOCAL => {
                let v = self.pop();
                let text = format!("{} = {}", self.local(u), show(render(&v)?));
                self.emit(text);
            }
            OP_SETGLOBAL => {
                let v = self.pop();
                let text = format!("{} = {}", show(self.kstr_at(u)?), show(render(&v)?));
                self.emit(text);
            }
            OP_SETTABLE => {
                let v = self.pop();
                let key = self.pop();
                let t = self.pop();
                let target = need(render(&Expr::Index(t, key))?)?;
                self.emit(format!("{target} = {}", show(render(&v)?)));
            }
            OP_SETLIST => {
                // stack: [table, v1..vn] (a = base, b = count); the items render as `???`
                self.pop_n(b);
                if let Some(t) = self.peek_table() {
                    t.borrow_mut().array += b as usize;
                }
            }
            OP_SETMAP => {
                let v = self.pop();
                let key = self.pop();
                if let Some(t) = self.peek_table() {
                    t.borrow_mut().hash.push((key, v));
                }
            }
            OP_ADD => self.binop("+"),
            OP_ADDI => {
                let l = self.pop();
                self.push(Rc::new(Expr::Binop("+", l, Rc::new(Expr::Int(s)))));
            }
            OP_SUB => self.binop("-"),
            OP_MULT => self.binop("*"),
            OP_DIV => self.binop("/"),
            OP_POW => self.binop("^"),
            OP_CONCAT => {
                let mut vals = self.pop_n(u).into_iter();
                let Some(mut e) = vals.next() else { fail!("CONCAT of nothing at {pc}") };
                for v in vals {
                    e = Rc::new(Expr::Binop("..", e, v));
                }
                self.push(e);
            }
            OP_MINUS => {
                let v = self.pop();
                self.push(Rc::new(Expr::Unop("-", v)));
            }
            OP_NOT => {
                let v = self.pop();
                self.push(Rc::new(Expr::Unop("not", v)));
            }
            OP_CLOSURE => {
                let src = match self.kproto.get(u as usize) {
                    Some(proto) => {
                        let n = proto.numparams.max(0);
                        let params: Vec<String> = (0..n).map(|i| format!("arg_{i}")).collect();
                        let mut inner = Decompiler::new(proto);
                        for (i, name) in params.iter().enumerate() {
                            inner.local_names.insert(i as i64, name.clone());
                        }
                        let body: Vec<String> =
                            inner.decompile()?.into_iter().map(|(lev, t)| "    ".repeat(lev + 1) + &t).collect();
                        format!("function({})\n{}\nend", params.join(", "), body.join("\n"))
                    }
                    None => "function() end".into(),
                };
                self.push(Rc::new(Expr::Func(src)));
            }
            _ => {}
        }
        Ok(pc + 1)
    }
}

fn is_single_if(stmts: &[Stmt]) -> bool {
    match (stmts.first(), stmts.last()) {
        (Some(head), Some(last)) if stmts.len() >= 2 => {
            head.1.starts_with("if ") && last.1 == "end" && last.0 == head.0
        }
        _ => false,
    }
}

/// Decompiled source of a function (statements joined with newlines, four-space indents).
pub fn decompile_function_source(function: &Function) -> Result<String> {
    let lines: Vec<String> =
        Decompiler::new(function).decompile()?.into_iter().map(|(lev, text)| "    ".repeat(lev) + &text).collect();
    Ok(lines.join("\n"))
}

const MAGIC: &[u8] = b"\x1bLua";

/// Every Lua chunk in a pack as (offset, source), in file order. Unreadable chunks are skipped:
/// a false magic inside other data, or a shape the decompiler does not know.
pub fn decompile_chunks(blob: &[u8]) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(found) = blob.get(i..).and_then(|rest| rest.windows(MAGIC.len()).position(|w| w == MAGIC)) {
        let j = i + found;
        if let Ok(src) = parse_chunk(blob, j).and_then(|(main, _)| decompile_function_source(&main)) {
            out.push((j, src));
        }
        i = j + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iu(op: u32, u: u32) -> u32 {
        op | (u << 6)
    }
    fn iab(op: u32, a: u32, b: u32) -> u32 {
        op | (b << 6) | (a << 15)
    }
    fn int(v: i64) -> u32 {
        iu(OP_PUSHINT, (v + MAXARG_S) as u32)
    }
    /// A jump from `pc` to `target`.
    fn jump(op: u32, pc: i64, target: i64) -> u32 {
        op | (((target - pc - 1 + MAXARG_S) as u32) << 6)
    }
    fn function(code: Vec<u32>, kstr: &[&str], knum: &[f64]) -> Function {
        Function {
            numparams: 0,
            is_vararg: 0,
            kstr: kstr.iter().map(|s| Some(s.to_string())).collect(),
            knum: knum.to_vec(),
            kproto: Vec::new(),
            code,
        }
    }
    fn source(code: Vec<u32>, kstr: &[&str], knum: &[f64]) -> String {
        decompile_function_source(&function(code, kstr, knum)).unwrap()
    }
    fn g(name: &str) -> E {
        Rc::new(Expr::Global(Some(name.into())))
    }
    fn bin(op: &'static str, l: E, r: E) -> E {
        Rc::new(Expr::Binop(op, l, r))
    }
    fn text(e: &Expr) -> String {
        render(e).unwrap().unwrap()
    }

    #[test]
    fn skips_expressions_nested_past_the_limit() {
        let mut e = g("x");
        for _ in 0..MAX_DEPTH + 10 {
            e = Rc::new(Expr::Unop("-", e));
        }
        assert!(render(&e).is_err());
        assert_eq!(DEPTH.with(|d| d.get()), 0);
        assert_eq!(text(&bin("+", g("a"), g("b"))), "a + b");
    }

    #[test]
    fn prints_numbers_like_the_python() {
        assert_eq!(render_number(1.0).unwrap(), "1");
        assert_eq!(render_number(-0.0).unwrap(), "0");
        assert_eq!(render_number(-12.0).unwrap(), "-12");
        assert_eq!(render_number(0.5).unwrap(), "0.5");
        assert_eq!(render_number(1e15).unwrap(), "1000000000000000.0");
        assert_eq!(render_number(1e-5).unwrap(), "1e-05");
        assert!(render_number(f64::NAN).is_err());
        assert!(render_number(f64::INFINITY).is_err());
        assert_eq!(text(&Expr::Int(-3)), "-3");
        assert_eq!(text(&Expr::Unop("-", Rc::new(Expr::Num(2.0)))), "-2");
    }

    #[test]
    fn parenthesises_by_precedence() {
        let (a, b, c) = (g("a"), g("b"), g("c"));
        assert_eq!(text(&bin("-", a.clone(), bin("-", b.clone(), c.clone()))), "a - (b - c)");
        assert_eq!(text(&bin("-", bin("-", a.clone(), b.clone()), c.clone())), "a - b - c");
        assert_eq!(text(&bin("*", bin("+", a.clone(), b.clone()), c.clone())), "(a + b) * c");
        assert_eq!(text(&bin("..", a.clone(), bin("..", b.clone(), c.clone()))), "a .. b .. c");
        assert_eq!(text(&bin("^", bin("^", a.clone(), b.clone()), c.clone())), "a ^ b ^ c");
        assert_eq!(text(&Expr::Unop("-", bin("+", a.clone(), b.clone()))), "-(a + b)");
        assert_eq!(text(&Expr::Unop("not", bin("==", a.clone(), b))), "not (a == b)");
        let anon = Rc::new(Expr::Func("function() end".into()));
        assert_eq!(text(&Expr::Call(anon, vec![a])), "(function() end)(a)");
    }

    #[test]
    fn null_strings_fail_in_concatenation_and_print_none_in_fstrings() {
        let null = Rc::new(Expr::Global(None));
        assert_eq!(text(&bin("+", null.clone(), g("a"))), "None + a");
        assert!(render(&Expr::Index(null.clone(), g("a"))).is_err());
        assert!(render(&Expr::Call(g("f"), vec![null])).is_err());
        assert!(render(&Expr::Str(None)).is_err());
    }

    #[test]
    fn flattens_else_if_into_elseif() {
        let code = vec![
            iu(OP_GETGLOBAL, 0),
            int(1),
            jump(OP_JMPNE, 2, 6),
            iu(OP_GETGLOBAL, 1),
            iab(OP_CALL, 0, 0),
            jump(OP_JMP, 5, 11),
            iu(OP_GETGLOBAL, 0),
            int(2),
            jump(OP_JMPNE, 8, 11),
            iu(OP_GETGLOBAL, 2),
            iab(OP_CALL, 0, 0),
            OP_END,
        ];
        assert_eq!(source(code, &["x", "f", "g"], &[]), "if x == 1 then\n    f()\nelseif x == 2 then\n    g()\nend");
    }

    #[test]
    fn joins_jumps_to_one_else_target_into_an_and_chain() {
        let code = vec![
            iu(OP_GETGLOBAL, 0),
            jump(OP_JMPF, 1, 6),
            iu(OP_GETGLOBAL, 1),
            jump(OP_JMPT, 3, 6),
            iu(OP_GETGLOBAL, 2),
            iab(OP_CALL, 0, 0),
            OP_END,
        ];
        assert_eq!(source(code, &["a", "b", "f"], &[]), "if a and not b then\n    f()\nend");
    }

    #[test]
    fn a_back_jump_makes_a_while_loop() {
        let code = vec![
            iu(OP_GETGLOBAL, 0),
            jump(OP_JMPF, 1, 5),
            iu(OP_GETGLOBAL, 1),
            iab(OP_CALL, 0, 0),
            jump(OP_JMP, 4, 0),
            OP_END,
        ];
        assert_eq!(source(code, &["a", "f"], &[]), "while a do\n    f()\nend");
    }

    #[test]
    fn list_items_render_as_placeholders() {
        let code = vec![
            OP_CREATETABLE,
            int(1),
            int(2),
            iab(OP_SETLIST, 0, 2),
            iu(OP_PUSHSTRING, 0),
            iu(OP_PUSHNUM, 0),
            OP_SETMAP,
            iu(OP_SETGLOBAL, 1),
            iu(OP_PUSHNUM, 1),
            iu(OP_SETGLOBAL, 1),
            OP_END,
        ];
        assert_eq!(source(code, &["x", "t"], &[0.5, 1e-5]), "t = {???, ???, [\"x\"] = 0.5}\nt = 1e-05");
    }

    #[test]
    fn fails_where_the_python_raises() {
        let missing_global = function(vec![iu(OP_GETGLOBAL, 3), OP_END], &["a"], &[]);
        assert!(decompile_function_source(&missing_global).is_err());
        let past_the_end = function(vec![iu(OP_GETGLOBAL, 0), jump(OP_JMPF, 1, 40), OP_END], &["a"], &[]);
        assert!(decompile_function_source(&past_the_end).is_err());
        // an out-of-range string push is tolerated
        let placeholder = function(vec![iu(OP_PUSHSTRING, 7), iu(OP_SETGLOBAL, 0), OP_END], &["a"], &[]);
        assert_eq!(decompile_function_source(&placeholder).unwrap(), "a = \"<str[7]>\"");
    }

    #[test]
    fn finds_chunks_and_skips_false_magics() {
        fn string(out: &mut Vec<u8>, s: &str) {
            out.extend((s.len() as u32 + 1).to_le_bytes());
            out.extend(s.as_bytes());
            out.push(0);
        }
        fn ints(out: &mut Vec<u8>, values: &[i32]) {
            for v in values {
                out.extend(v.to_le_bytes());
            }
        }
        let mut chunk = b"\x1bLua\x40\x01\x04\x04\x04\x20\x06\x09\x08".to_vec();
        // Lua 4's header check number, not an attempt at pi.
        #[allow(clippy::approx_constant)]
        chunk.extend(3.14159265358979_f64.to_le_bytes());
        string(&mut chunk, "@test");
        ints(&mut chunk, &[0, 0]); // lineDefined, numparams
        chunk.push(0); // is_vararg
        ints(&mut chunk, &[2, 0, 0, 2]); // maxstack, nloc, nlines, nkstr
        string(&mut chunk, "x");
        string(&mut chunk, "y");
        ints(&mut chunk, &[0, 0, 3]); // nknum, nkproto, ncode
        for ins in [iu(OP_GETGLOBAL, 1), iu(OP_SETGLOBAL, 0), OP_END] {
            chunk.extend(ins.to_le_bytes());
        }
        let mut blob = b"junk\x1bLua!".to_vec();
        let at = blob.len();
        blob.extend(&chunk);
        assert_eq!(parse_chunk(&blob, at).unwrap().1, chunk.len());
        assert_eq!(decompile_chunks(&blob), vec![(at, "x = y".to_string())]);
    }
}

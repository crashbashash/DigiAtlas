"""Lua 4.0.1 bytecode decompiler for the scripts inside DW4 stage packs.

Adapted from DW4_Decomp scripts/lua_decompile.py (same author, GPL-3.0-or-later).

Instruction layout (verified against reference Lua 4.0.1): ``OP(6) | B(9 bits @6) | A(17 bits @15)``.
Jump opcodes are the stock pop variants, so scripts have no ``and``/``or`` short-circuit, and local
variable names are stripped, so locals get synthetic names (``local_0``...).
"""
from __future__ import annotations

import struct

SIZE_OP = 6
SIZE_B = 9
MAXARG_S = (1 << 25) - 1

OPCODES = [
    "OP_END", "OP_RETURN", "OP_CALL", "OP_TAILCALL", "OP_PUSHNIL", "OP_POP",
    "OP_PUSHINT", "OP_PUSHSTRING", "OP_PUSHNUM", "OP_PUSHNEGNUM",
    "OP_PUSHUPVALUE", "OP_GETLOCAL", "OP_GETGLOBAL", "OP_GETTABLE",
    "OP_GETDOTTED", "OP_GETINDEXED", "OP_PUSHSELF", "OP_CREATETABLE",
    "OP_SETLOCAL", "OP_SETGLOBAL", "OP_SETTABLE", "OP_SETLIST", "OP_SETMAP",
    "OP_ADD", "OP_ADDI", "OP_SUB", "OP_MULT", "OP_DIV", "OP_POW",
    "OP_CONCAT", "OP_MINUS", "OP_NOT", "OP_JMPNE", "OP_JMPEQ", "OP_JMPLT",
    "OP_JMPLE", "OP_JMPGT", "OP_JMPGE", "OP_JMPT", "OP_JMPF", "OP_JMPONT",
    "OP_JMPONF", "OP_JMP", "OP_PUSHNILJMP", "OP_FORPREP", "OP_FORLOOP",
    "OP_LFORPREP", "OP_LFORLOOP", "OP_CLOSURE",
]
OP = {n: i for i, n in enumerate(OPCODES)}

CMP_JUMPS = {OP['OP_JMPNE'], OP['OP_JMPEQ'], OP['OP_JMPLT'],
             OP['OP_JMPLE'], OP['OP_JMPGT'], OP['OP_JMPGE']}
JMP_ALL = CMP_JUMPS | {OP['OP_JMPT'], OP['OP_JMPF'], OP['OP_JMP'],
                       OP['OP_JMPONT'], OP['OP_JMPONF']}

# inverse comparison: a comparison jump skips the then-body when the
# comparison is TRUE, so the reconstructed condition is the inverse.
CMP_INV = {
    OP['OP_JMPNE']: '==', OP['OP_JMPEQ']: '~=', OP['OP_JMPLT']: '>=',
    OP['OP_JMPLE']: '>', OP['OP_JMPGT']: '<=', OP['OP_JMPGE']: '<',
}


# ---------------------------------------------------------------- parser

class ChunkReader:
    def __init__(self, data, off):
        self.data = data
        self.pos = off

    def u8(self):
        v = self.data[self.pos]; self.pos += 1; return v

    def u32(self):
        v = struct.unpack_from("<I", self.data, self.pos)[0]; self.pos += 4; return v

    def i32(self):
        v = struct.unpack_from("<i", self.data, self.pos)[0]; self.pos += 4; return v

    def f64(self):
        v = struct.unpack_from("<d", self.data, self.pos)[0]; self.pos += 8; return v

    def read_string(self):
        n = self.u32()
        if n == 0:
            return None
        raw = self.data[self.pos:self.pos + n]
        self.pos += n
        return raw.rstrip(b"\x00").decode("latin1", "replace")


def parse_function(c):
    source = c.read_string()
    line_defined = c.i32()
    numparams = c.i32()
    is_vararg = c.u8()
    maxstack = c.i32()
    nloc = c.i32()
    locals_ = []
    for _ in range(nloc):
        varname = c.read_string()
        startpc = c.i32()
        endpc = c.i32()
        locals_.append((varname, startpc, endpc))
    nlines = c.i32()
    lineinfo = [c.i32() for _ in range(nlines)]
    nkstr = c.i32()
    kstr = [c.read_string() for _ in range(nkstr)]
    nknum = c.i32()
    knum = [c.f64() for _ in range(nknum)]
    nkproto = c.i32()
    kproto = [parse_function(c) for _ in range(nkproto)]
    ncode = c.i32()
    code = [c.u32() for _ in range(ncode)]
    return {
        "source": source, "lineDefined": line_defined, "numparams": numparams,
        "is_vararg": is_vararg, "maxstack": maxstack, "locals": locals_,
        "lineinfo": lineinfo, "kstr": kstr, "knum": knum, "kproto": kproto,
        "code": code,
    }


def parse_chunk(data, off):
    c = ChunkReader(data, off)
    assert c.u8() == 0x1B
    assert bytes([c.u8(), c.u8(), c.u8()]) == b"Lua"
    version = c.u8()
    endian = c.u8()
    for _ in range(7):
        c.u8()
    c.f64()
    main = parse_function(c)
    return main, c.pos - off


# ---------------------------------------------------------------- rendering

PREC = {'or': 1, 'and': 2, 'compare': 3, 'concat': 4, 'add': 5,
        'mul': 6, 'unary': 7, 'pow': 8, 'atom': 100}


def quote(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


def render(expr):
    kind = expr[0]
    if kind == 'const':
        v = expr[1]
        if v is None:
            return 'nil'
        if isinstance(v, float):
            if v == int(v) and abs(v) < 1e15:
                return str(int(v))
            return repr(v)
        return str(v)
    if kind == 'string':
        return quote(expr[1])
    if kind == 'local':
        return expr[1]
    if kind == 'global':
        return expr[1]
    if kind == 'index':
        return render(expr[1]) + '[' + render(expr[2]) + ']'
    if kind == 'dot':
        return render(expr[1]) + '.' + expr[2]
    if kind == 'binop':
        op, l, r = expr[1], expr[2], expr[3]
        lp = prec_of_op(op)
        rp = lp if op in ('..', '^') else lp + 1
        return f"{render_with(l, lp)} {op} {render_with(r, rp)}"
    if kind == 'unop':
        op, operand = expr[1], expr[2]
        return op + " " + render_with(operand, PREC['unary']) if op == 'not' \
            else op + render_with(operand, PREC['unary'])
    if kind == 'call':
        func, args = expr[1], expr[2]
        return render_with(func, PREC['atom']) + '(' + ', '.join(render(a) for a in args) + ')'
    if kind == 'method':
        recv, name, args = expr[1], expr[2], expr[3]
        return render_with(recv, PREC['atom']) + ':' + name + '(' + ', '.join(render(a) for a in args) + ')'
    if kind == 'table':
        array, hash_ = expr[1], expr[2]
        parts = [render(a) for a in array]
        parts += [f"[{render(k)}] = {render(v)}" for k, v in hash_]
        return '{' + ', '.join(parts) + '}'
    if kind == 'func':
        return expr[1]
    if kind == 'vararg':
        return '...'
    return '???'


def render_with(expr, min_prec):
    s = render(expr)
    if prec_of(expr) < min_prec:
        return '(' + s + ')'
    return s


def prec_of(expr):
    kind = expr[0]
    if kind == 'binop':
        return prec_of_op(expr[1])
    if kind == 'unop':
        return PREC['unary']
    if kind == 'func':
        return 0  # always parenthesise anonymous functions in call position
    return PREC['atom']


def prec_of_op(op):
    if op == 'or':
        return PREC['or']
    if op == 'and':
        return PREC['and']
    if op in ('~=', '==', '<', '>', '<=', '>='):
        return PREC['compare']
    if op == '..':
        return PREC['concat']
    if op in ('+', '-'):
        return PREC['add']
    if op in ('*', '/'):
        return PREC['mul']
    if op == '^':
        return PREC['pow']
    return PREC['atom']


# ---------------------------------------------------------------- decompiler

class Decompiler:
    def __init__(self, fn):
        self.code = fn['code']
        self.kstr = fn['kstr']
        self.knum = fn['knum']
        self.kproto = fn['kproto']
        self.nparams = fn['numparams']
        self.is_vararg = fn['is_vararg']
        self.local_names = {}
        self.stack = []
        self.stmts = []
        self._pc = 0
        self._end = len(self.code)
        self._jump_tgt = {}
        self._back_targets = set()
        self._memo = {}

    # -- name/const helpers --
    def local(self, idx):
        if idx not in self.local_names:
            self.local_names[idx] = f"local_{idx}"
        return self.local_names[idx]

    def s(self, k):
        return ('string', self.kstr[k] if k < len(self.kstr) else f"<str[{k}]>")

    def n(self, k):
        return ('const', self.knum[k] if k < len(self.knum) else 0.0)

    def _jt(self, pc):
        _, _, s, _, _ = self.decode(pc)
        return pc + 1 + s

    def decode(self, pc):
        ins = self.code[pc]
        op = ins & 0x3F
        u = ins >> 6
        s = u - MAXARG_S
        b = (ins >> 6) & 0x1ff
        a = ins >> 15
        return op, u, s, b, a

    def push(self, e):
        self.stack.append(e)

    def pop(self):
        return self.stack.pop() if self.stack else ('const', None)

    def emit(self, text, lev=0):
        self.stmts.append((lev, text))

    def indent_block(self, stmts, extra):
        return [(lev + extra, t) for lev, t in stmts]

    # ----------------------------------------------------------------
    def decompile(self):
        self._precompute()
        self._pc = 0
        self._end = len(self.code)
        # the function's parameters occupy the lowest stack slots
        for i in range(self.nparams):
            self.push(('local', self.local(i)))
        self.collect(self._end)
        return self.stmts

    def _precompute(self):
        for pc in range(len(self.code)):
            op = self.code[pc] & 0x3F
            if op in JMP_ALL:
                t = self._jt(pc)
                self._jump_tgt[pc] = t
                if t <= pc:
                    self._back_targets.add(t)

    # ----------------------------------------------------------------
    # collect: decompile statements until `limit` or an unconditional jump.
    def collect(self, limit):
        while self._pc < limit:
            pc = self._pc
            op = self.code[pc] & 0x3F
            if op == OP['OP_JMP']:
                return pc
            if op in CMP_JUMPS or op in (OP['OP_JMPT'], OP['OP_JMPF']):
                self._if_or_while()
                continue
            if op == OP['OP_FORPREP']:
                self._num_for()
                continue
            if op == OP['OP_LFORPREP']:
                self._lfor()
                continue
            self._pc = self.step(pc)
        return self._pc

    # -- and/or short-circuit (38=or, 39=and) handled inside step --
    def _find_backjump(self, start, end):
        for pc in range(start, end):
            op = self.code[pc] & 0x3F
            if op == OP['OP_JMP']:
                t = self._jt(pc)
                if t <= pc:
                    return pc
        return None

    def _pop_cond(self, op):
        if op in CMP_JUMPS:
            rhs = self.pop()
            lhs = self.pop()
            return ('binop', CMP_INV[op], lhs, rhs)
        if op == OP['OP_JMPT']:
            # jump if truthy -> skip when `x` truthy -> condition is `not x`
            return ('unop', 'not', self.pop())
        if op == OP['OP_JMPF']:
            # jump if falsy -> skip when `x` falsy -> condition is `x`
            return self.pop()
        return ('const', None)

    def _if_or_while(self):
        pc = self._pc
        op = self.code[pc] & 0x3F
        t = self._jt(pc)
        conds = [self._pop_cond(op)]

        # `and`-chain detection: the game compiles `a and b and c` as nested
        # ifs whose conditions ALL jump to the same else target. Collect them
        # into one flat condition (this also prevents exponential re-decoding
        # of the shared else body).
        scan = pc + 1
        while scan < t:
            cj = self._find_cond_jump_to(scan, t, t)
            if cj is None:
                break
            self._run_expr(scan, cj)
            conds.append(self._pop_cond(self.code[cj] & 0x3F))
            scan = cj + 1

        cond = conds[0]
        for c in conds[1:]:
            cond = ('binop', 'and', cond, c)

        back = self._find_backjump(scan, t)
        if back is not None:
            body, _ = self._collect_sub(scan, back)
            self.emit(f"while {render(cond)} do")
            self.stmts.extend(self.indent_block(body, 1))
            self.emit("end")
            self._pc = t
        else:
            self._emit_if(scan, t, cond)

    def _find_cond_jump_to(self, start, end, target):
        """Return the pc of the first conditional jump (32-39) in [start,end)
        whose target is `target`, with no unconditional jump in between.
        Return None if none found before `end` or a JMP."""
        pc = start
        while pc < end:
            op = self.code[pc] & 0x3F
            if op == OP['OP_JMP']:
                return None
            if op in CMP_JUMPS or op in (OP['OP_JMPT'], OP['OP_JMPF']):
                if self._jt(pc) == target:
                    return pc
            pc += 1
        return None

    def _run_expr(self, start, end):
        """Process [start, end) as a pure expression (pushes values, no
        statements emitted)."""
        saved_stmts = self.stmts
        self.stmts = []
        saved_pc = self._pc
        self._pc = start
        while self._pc < end:
            self._pc = self.step(self._pc)
        self.stmts = saved_stmts
        self._pc = saved_pc

    def _emit_if(self, then_start, else_pc, cond):
        # then body = [then_start, else_pc). May stop early at a forward JMP.
        then_body, stop_pc = self._collect_sub(then_start, else_pc)
        self.emit(f"if {render(cond)} then")
        self.stmts.extend(self.indent_block(then_body, 1))
        if stop_pc < else_pc:
            # stopped at a forward JMP -> there is an else / elseif at else_pc
            skip_target = self._jump_tgt[stop_pc]
            else_body, _ = self._collect_sub(else_pc, skip_target)
            if self._is_single_if(else_body):
                # flatten 'else: if ...' into 'elseif ...' (levels already correct)
                self.stmts.append((0, else_body[0][1].replace('if ', 'elseif ', 1)))
                self.stmts.extend(else_body[1:-1])
                self.stmts.append((0, 'end'))
            else:
                self.emit("else")
                self.stmts.extend(self.indent_block(else_body, 1))
                self.emit("end")
            self._pc = skip_target
        else:
            self.emit("end")
            self._pc = else_pc

    @staticmethod
    def _is_single_if(stmts):
        if len(stmts) < 2:
            return False
        head = stmts[0][1]
        if not (head.startswith('if ') or head.startswith('if not ')):
            return False
        return stmts[-1][1] == 'end' and stmts[-1][0] == stmts[0][0]

    def _collect_sub(self, start, end):
        """Decompile [start, end) into a statement list. The block sees a
        COPY of the current stack (locals/control vars visible for GETLOCAL
        and CALL), but its stack changes are discarded. Returns (stmts,
        stop_pc). stop_pc == end normally, or < end if a forward JMP hit.

        Memoised by (start, end): deeply nested if-chains frequently share
        one else body, and re-decompiling it per nesting level is what caused
        the exponential output blow-up."""
        key = (start, end)
        if key in self._memo:
            result, stop = self._memo[key]
            return list(result), stop
        saved_stack = self.stack
        saved_stmts = self.stmts
        saved_pc = self._pc
        self.stack = list(saved_stack)
        self.stmts = []
        self._pc = start
        stop = self.collect(end)
        result = self.stmts
        self.stmts = saved_stmts
        self.stack = saved_stack
        self._pc = saved_pc
        self._memo[key] = (list(result), stop)
        return result, stop

    # ----------------------------------------------------------------
    def _num_for(self):
        pc = self._pc
        step = self.pop()
        limit = self.pop()
        init = self.pop()
        var_pos = len(self.stack)  # init slot = loop variable index
        varname = self.local(var_pos)
        # keep the three control slots on the stack while the body runs
        self.push(('local', varname))
        self.push(('local', f"{varname}_limit"))
        self.push(('local', f"{varname}_step"))
        body_start = pc + 1
        after = self._jt(pc)
        # Empty-loop branches can be threaded past the loop's immediate end.
        # Pair by the back edge, which also distinguishes nested loops.
        pc2 = next((p for p in range(body_start, len(self.code))
                    if (self.code[p] & 0x3F) == OP['OP_FORLOOP'] and
                    self._jt(p) == body_start), None)
        if pc2 is None:
            raise ValueError(f"FORPREP at {pc} has no matching FORLOOP")
        # decompile the body inline (stack carries the control slots)
        saved_stmts = self.stmts
        self.stmts = []
        saved_pc = self._pc
        self._pc = body_start
        self.collect(pc2)
        body = self.stmts
        self.stmts = saved_stmts
        self._pc = saved_pc
        # drop the three control slots
        self.pop(); self.pop(); self.pop()
        sstep = render(step)
        if sstep == '1':
            self.emit(f"for {varname} = {render(init)}, {render(limit)} do")
        else:
            self.emit(f"for {varname} = {render(init)}, {render(limit)}, {sstep} do")
        self.stmts.extend(self.indent_block(body, 1))
        self.emit("end")
        self._pc = after

    def _lfor(self):
        # generic for: absent from the game's scripts; best-effort
        pc = self._pc
        iter_expr = self.pop()
        after = self._jt(pc)
        body_start = pc + 1
        for pc2 in range(body_start, self._end):
            if (self.code[pc2] & 0x3F) == OP['OP_LFORLOOP']:
                break
        else:
            pc2 = self._end - 1
        body, _ = self._collect_sub(body_start, pc2)
        self.emit(f"for k, v in {render(iter_expr)} do")
        self.stmts.extend(self.indent_block(body, 1))
        self.emit("end")
        self._pc = after

    # ----------------------------------------------------------------
    def step(self, pc):
        op, u, s, b, a = self.decode(pc)

        if op == OP['OP_END']:
            return pc + 1
        if op == OP['OP_RETURN']:
            nres = u
            if nres == 0:
                vals = list(self.stack)
                self.stack = []
            else:
                vals = [self.pop() for _ in range(nres)][::-1]
            self.emit("return " + (', '.join(render(v) for v in vals) if vals else ""))
            return pc + 1

        if op in (OP['OP_CALL'], OP['OP_TAILCALL']):
            func_pos = a
            nres = b
            nargs = len(self.stack) - func_pos - 1
            args = [self.pop() for _ in range(nargs)][::-1]
            func = self.pop()
            del self.stack[func_pos:]
            if func[0] == 'method':
                # args[0] is the receiver (self) pushed by PUSHSELF
                call = ('method', func[1], func[2], args[1:])
            else:
                call = ('call', func, args)
            if nres == 0:
                self.emit(render(call))
            else:
                self.push(call)
            return pc + 1

        if op == OP['OP_PUSHNIL']:
            for _ in range(u):
                self.push(('const', None))
            return pc + 1
        if op == OP['OP_POP']:
            for _ in range(u):
                self.pop()
            return pc + 1
        if op == OP['OP_PUSHINT']:
            self.push(('const', s))
            return pc + 1
        if op == OP['OP_PUSHSTRING']:
            self.push(self.s(u))
            return pc + 1
        if op == OP['OP_PUSHNUM']:
            self.push(self.n(u))
            return pc + 1
        if op == OP['OP_PUSHNEGNUM']:
            self.push(('unop', '-', self.n(u)))
            return pc + 1
        if op == OP['OP_PUSHUPVALUE']:
            self.push(('global', f"upvalue_{u}"))
            return pc + 1
        if op == OP['OP_GETLOCAL']:
            self.push(('local', self.local(u)))
            return pc + 1
        if op == OP['OP_GETGLOBAL']:
            self.push(('global', self.kstr[u]))
            return pc + 1
        if op == OP['OP_GETTABLE']:
            key = self.pop()
            t = self.pop()
            self.push(('index', t, key))
            return pc + 1
        if op == OP['OP_GETDOTTED']:
            t = self.pop()
            self.push(('dot', t, self.kstr[u]))
            return pc + 1
        if op == OP['OP_GETINDEXED']:
            t = self.pop()
            self.push(('index', t, ('local', self.local(u))))
            return pc + 1
        if op == OP['OP_PUSHSELF']:
            recv = self.pop()
            # PUSHSELF pushes TWO values: the method (function) and the
            # receiver (self argument). Track both so CALL's absolute stack
            # positions stay correct.
            self.push(('method', recv, self.kstr[u], []))
            self.push(recv)
            return pc + 1
        if op == OP['OP_CREATETABLE']:
            self.push(('table', [], []))
            return pc + 1
        if op == OP['OP_SETLOCAL']:
            v = self.pop()
            self.emit(f"{self.local(u)} = {render(v)}")
            return pc + 1
        if op == OP['OP_SETGLOBAL']:
            v = self.pop()
            self.emit(f"{self.kstr[u]} = {render(v)}")
            return pc + 1
        if op == OP['OP_SETTABLE']:
            v = self.pop()
            key = self.pop()
            t = self.pop()
            self.emit(f"{render(('index', t, key))} = {render(v)}")
            return pc + 1
        if op == OP['OP_SETLIST']:
            # stack: [table, v1..vn]  (a = base, b = count)
            n = b
            vals = [self.pop() for _ in range(n)][::-1]
            t = self.peek_table()
            base = a * 50 + 1
            for i, v in enumerate(vals):
                t[1].append(('indexed_set', base + i, v))
            return pc + 1
        if op == OP['OP_SETMAP']:
            v = self.pop()
            key = self.pop()
            t = self.peek_table()
            t[2].append((key, v))
            return pc + 1
        if op == OP['OP_ADD']:
            r = self.pop(); l = self.pop()
            self.push(('binop', '+', l, r))
            return pc + 1
        if op == OP['OP_ADDI']:
            l = self.pop()
            self.push(('binop', '+', l, ('const', s)))
            return pc + 1
        if op == OP['OP_SUB']:
            r = self.pop(); l = self.pop()
            self.push(('binop', '-', l, r))
            return pc + 1
        if op == OP['OP_MULT']:
            r = self.pop(); l = self.pop()
            self.push(('binop', '*', l, r))
            return pc + 1
        if op == OP['OP_DIV']:
            r = self.pop(); l = self.pop()
            self.push(('binop', '/', l, r))
            return pc + 1
        if op == OP['OP_POW']:
            r = self.pop(); l = self.pop()
            self.push(('binop', '^', l, r))
            return pc + 1
        if op == OP['OP_CONCAT']:
            vals = [self.pop() for _ in range(u)][::-1]
            e = vals[0]
            for v in vals[1:]:
                e = ('binop', '..', e, v)
            self.push(e)
            return pc + 1
        if op == OP['OP_MINUS']:
            self.push(('unop', '-', self.pop()))
            return pc + 1
        if op == OP['OP_NOT']:
            self.push(('unop', 'not', self.pop()))
            return pc + 1

        if op == OP['OP_CLOSURE']:
            proto = self.kproto[u] if u < len(self.kproto) else None
            if proto is not None:
                params = ", ".join(f"arg_{i}" for i in range(proto['numparams']))
                inner = Decompiler(proto)
                for i in range(proto['numparams']):
                    inner.local_names[i] = f"arg_{i}"
                inner_stmts = inner.decompile()
                body_lines = ["    " * (lev + 1) + t for lev, t in inner_stmts]
                fn_src = f"function({params})\n" + "\n".join(body_lines) + "\nend"
                self.push(('func', fn_src))
            else:
                self.push(('func', "function() end"))
            return pc + 1

        return pc + 1

    def _param_names(self, proto):
        return [f"arg_{i}" for i in range(proto['numparams'])]

    def peek_table(self):
        # find the nearest table constructor on the stack (for SETLIST/SETMAP)
        for e in reversed(self.stack):
            if e[0] == 'table':
                return e
        t = ('table', [], [])
        return t

    def _make_call(self, func, args):
        if func[0] == 'method':
            return ('method', func[1], func[2], args)
        return ('call', func, args)


# ----------------------------------------------------------------------

def decompile_function(fn):
    d = Decompiler(fn)
    stmts = d.decompile()
    lines = []
    for lev, text in stmts:
        lines.append("    " * lev + text)
    return lines


def decompile_function_source(fn):
    return "\n".join(decompile_function(fn))


MAGIC = b"\x1bLua"


def decompile_chunks(blob: bytes) -> list[tuple[int, str]]:
    """Every Lua chunk in a pack as (offset, source), in file order. Unreadable chunks are skipped."""
    out: list[tuple[int, str]] = []
    i = 0
    while True:
        j = blob.find(MAGIC, i)
        if j < 0:
            return out
        try:
            main, _size = parse_chunk(blob, j)
            out.append((j, decompile_function_source(main)))
        except Exception:  # a false magic inside other data, or a shape the decompiler does not know
            pass
        i = j + 1

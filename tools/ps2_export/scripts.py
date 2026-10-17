"""What the game's scripts do to each spawner, read from the decompiled stage scripts.

Stage packs carry Lua 4.0.1 chunks. A call like ``be:sd("GENERATER", nil, -1, "START", "GENE-53")`` starts
a spawner; ``RESTART`` rearms it and ``STOP`` ends it. Each call sits under the ``if`` conditions of its
chunk, which are kept as written and also put into plain words where the function is known.
Spawner names built in code (``"GENE-" .. n``) cannot be tied to one spawner and are reported as prefixes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import luadec

VERBS = {"START", "RESTART", "STOP", "STOPREVERS", "RESET", "PERFECTDROP", "ONFREEZE", "OFFFREEZE"}
CALL = re.compile(r'^be:(?:sd|DMsetSD)\("GENERATER",\s*[^,]+,\s*(-?\d+),\s*"(\w+)"(?:,\s*(.*))?\)\s*$')
BLOCK = re.compile(r"^(if|elseif|while)\s+(.*)\s+(then|do)$")
FLAG = re.compile(r"be:FLGisOn\((\d+)\)\s*(==|~=)\s*(\d+)")
NINZU = re.compile(r"be:SYSgetPlayerNinzu\(\)\s*(==|~=|<=|>=|<|>)\s*(\d+)")
RAMNO = re.compile(r"be:MDLgetRamNo\(\)\s*(==|~=)\s*(\d+)")
ENTRY = re.compile(r"be:PLAYERgetPos\(\)\s*(==|~=)\s*(\d+)")
MAT = re.compile(r"be:MATisPlayer\(\)\s*(==|~=)\s*(\d+)")
PLAYING = re.compile(r'local_\d+\s*(==|~=)\s*"(p_\w+)"')


def load_flag_names() -> dict[int, str]:
    """Meanings of the story and quest flags (``names/flags.json``)."""
    import json
    from pathlib import Path

    raw = json.loads((Path(__file__).resolve().parents[2] / "importer" / "names" / "flags.json").read_text())
    return {int(k): v["meaning"] for k, v in raw.items() if not k.startswith("_")}


@dataclass
class Ref:
    verb: str
    target: str | None  # the spawner's name, or None when it is built in code
    prefix: str | None  # for a built name, its constant start (e.g. "GENE-")
    when: list[str] = field(default_factory=list)  # plain-language conditions, outermost first
    raw: list[str] = field(default_factory=list)  # the same conditions as decompiled


def _ranges(numbers: list[int]) -> str:
    """[598, 599, 600, 605] -> '598-600, 605'."""
    out: list[str] = []
    for n in sorted(set(numbers)):
        if out and out[-1].endswith(str(n - 1)) and ("-" in out[-1] and out[-1].split("-")[-1] == str(n - 1) or out[-1] == str(n - 1)):
            head = out[-1].split("-")[0]
            out[-1] = f"{head}-{n}"
        else:
            out.append(str(n))
    return ", ".join(out)


def _events(numbers: list[int], state: str, meanings: dict[int, str] | None) -> str:
    """'events 598-610 done (600 Boss 1 story scene done; ...)', naming the ones the game's table knows."""
    text = f"event{'s' if len(set(numbers)) > 1 else ''} {_ranges(numbers)} {state}"
    known = [f"{n}: {meanings[n]}" for n in sorted(set(numbers)) if meanings and n in meanings]
    if known:
        text += " (" + "; ".join(known[:6]) + ("; ..." if len(known) > 6 else "") + ")"
    return text


def describe(
    cond: str,
    digimon: dict[str, str] | None = None,
    meanings: dict[int, str] | None = None,
    latched: frozenset[int] = frozenset(),
) -> str:
    """One condition in words; unknown ones are returned as written.

    ``digimon`` maps player model names (``p_agumon``) to display names ("Agumon"); ``meanings`` names
    story flags; ``latched`` are flags the same script sets after testing them, which makes the test
    "the first time" and not a story fact.
    """
    if m := re.fullmatch(r"not \((.*)\)", cond):
        inner = describe(m[1], digimon, meanings, latched)
        if re.match(r"events? [\d, -]+ not done yet", inner):  # "not (X not done yet)" is just "X done"
            return inner.replace(" not done yet", " done", 1)
        return inner.replace("this is the first time", "this is not the first time", 1) if "this is the first time" in inner else f"not ({inner})"
    parts: list[str] = []
    done: list[int] = []
    pending: list[int] = []
    first: list[int] = []
    for piece in re.split(r"\s+and\s+", cond):
        piece = piece.strip().strip("()")
        if m := FLAG.fullmatch(piece):
            n, is_done = int(m[1]), (m[2] == "==") == (m[3] != "0")
            if not is_done and n in latched:
                first.append(n)
            else:
                (done if is_done else pending).append(n)
        elif m := NINZU.fullmatch(piece):
            op, n = m[1], int(m[2])
            plural = "s" if n != 1 else ""
            parts.append(
                "2 or more players" if (op == "~=" and n == 1) else
                {"==": f"exactly {n} player{plural}", "~=": f"not {n} player{plural}",
                 ">=": f"{n} or more players", ">": f"more than {n} player{plural}",
                 "<=": f"{n} or fewer players", "<": f"fewer than {n} players"}[op]
            )
        elif m := RAMNO.fullmatch(piece):
            parts.append(f"player {int(m[2]) + 1}" if m[1] == "==" else f"not player {int(m[2]) + 1}")
        elif m := ENTRY.fullmatch(piece):
            parts.append(f"entered by gate {m[2]}" if m[1] == "==" else f"not entered by gate {m[2]}")
        elif m := MAT.fullmatch(piece):
            on = (m[1] == "==") == (m[2] != "0")
            parts.append("a player touches the trigger" if on else "triggered by something else")
        elif (m := PLAYING.fullmatch(piece)) and digimon and m[2] in digimon:
            parts.append(f"you play as {digimon[m[2]]}" if m[1] == "==" else f"you do not play as {digimon[m[2]]}")
        else:
            parts.append(piece)
    if first:
        named = [f"{n}: {meanings[n]}" for n in first if meanings and n in meanings]
        parts.append(f"this is the first time (event {_ranges(first)}{': ' + meanings[first[0]] if len(first) == 1 and named else ''})")
    if done:
        parts.append(_events(done, "done", meanings))
    if pending:
        parts.append(_events(pending, "not done yet", meanings))
    return " and ".join(parts)


def _split_args(text: str) -> list[str]:
    out, depth, cur, quote = [], 0, "", False
    for ch in text:
        if ch == '"':
            quote = not quote
        if not quote and ch in "([":
            depth += 1
        if not quote and ch in ")]":
            depth -= 1
        if not quote and depth == 0 and ch == ",":
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def _target(arg: str) -> tuple[str | None, str | None]:
    """(name, prefix): a plain quoted name, or the constant start of a name built with `..`."""
    m = re.fullmatch(r'"([^"]*)"', arg)
    if m:
        return m[1], None
    m = re.match(r'"([^"]*)"\s*\.\.', arg) or re.match(r'format\("([^"%]*)%', arg)
    return None, (m[1] if m else "")


def references(source: str, digimon: dict[str, str] | None = None, meanings: dict[int, str] | None = None) -> list[Ref]:
    """Every spawner command in one decompiled chunk with the conditions above it.

    ``elseif`` and ``else`` branches carry the negation of the branches before them, so a script that
    starts one spawner when a flag is set and another otherwise says so for both.
    """
    refs: list[Ref] = []
    # A flag the chunk sets to 1 is a once-only latch when the same chunk tests it as not yet done.
    latched = frozenset(int(n) for n in re.findall(r"be:FLGset\((\d+),\s*1\)", source))
    stack: list[tuple[str, list[str]]] = []  # per open block: (kind, raw conditions that hold inside)
    chain: dict[int, list[str]] = {}  # per level: the conditions of the if/elseif branches seen so far
    for line in source.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        level = (len(line) - len(line.lstrip(" "))) // 4
        del stack[level:]
        if m := BLOCK.match(stripped):
            kind, cond = m[1], m[2]
            if kind == "if":
                chain[level] = [cond]
                stack.append((kind, [cond]))
            elif kind == "elseif":
                prior = chain.get(level, [])
                stack.append((kind, [f"not ({c})" for c in prior] + [cond]))
                chain[level] = prior + [cond]
            else:  # while
                stack.append((kind, [cond]))
            continue
        if stripped == "else":
            stack.append(("else", [f"not ({c})" for c in chain.get(level, [])]))
            continue
        if m := CALL.match(stripped):
            if m[2] not in VERBS:
                continue
            args = _split_args(m[3] or "")
            if not args:
                continue
            name, prefix = _target(args[0])
            raw = [c for _kind, conds in stack for c in conds]
            refs.append(Ref(m[2], name, prefix, [describe(c, digimon, meanings, latched) for c in raw], raw))
    return refs


@dataclass
class StageScripts:
    by_name: dict[str, list[Ref]] = field(default_factory=dict)
    dynamic: dict[str, list[Ref]] = field(default_factory=dict)  # name prefix -> the calls that build names

    def add(self, refs: list[Ref]) -> None:
        for r in refs:
            if r.target:
                self.by_name.setdefault(r.target, []).append(r)
            else:
                self.dynamic.setdefault(r.prefix or "", []).append(r)

    def status(self, name: str) -> tuple[str, list[Ref]]:
        """How scripts relate to a spawner: referenced, dynamic (a built name matches), unknown, or none."""
        if name in self.by_name:
            return "referenced", self.by_name[name]
        for prefix, refs in self.dynamic.items():
            if prefix and name.startswith(prefix):
                return "dynamic", refs
        if "" in self.dynamic:
            return "unknown", self.dynamic[""]
        return "none", []


def analyse(packs: list[bytes], digimon: dict[str, str] | None = None, meanings: dict[int, str] | None = None) -> StageScripts:
    out = StageScripts()
    for blob in packs:
        for _offset, source in luadec.decompile_chunks(blob):
            out.add(references(source, digimon, meanings))
    return out

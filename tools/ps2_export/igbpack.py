"""igBinary pack decoder for DW4 stage packs (offline, no emulator).

Adapted from DW4_Decomp scripts/igb_inst.py and scripts/igb_ids.py (same author, GPL-3.0-or-later).

A pack is a type directory plus two record chains. Records are
``{u32 classIndex}{u32 recordSize}{values in descriptor order}`` and self-verify through
``recordSize``. ``igObjectRef`` fields hold global ids that resolve through the id remap table
between the chains (``find_table``). List contents live in a trailing pool laid out in ascending
``_data`` order (``list_records``). Fields are read by position: ``fields[i]`` is the i-th
descriptor of the class.
"""
from __future__ import annotations

import re
import struct

TID2REF = {0: "igObjectRef", 1: "igInt", 2: "igBool", 3: "igChar", 4: "igString",
           5: "igRawRef", 6: "igEnum", 7: "igMemoryRef", 8: "igUnsignedChar",
           9: "igUnsignedInt", 10: "igUnsignedShort", 11: "igStruct", 12: "igLong",
           13: "igUnsignedLong", 16: "igFloat", 17: "igShort", 31: "igDouble",
           36: "igVec3f", 37: "igVec2f", 38: "igVec4f", 39: "igVec4uc",
           40: "igMatrix44f", 45: "igVec3uc", 47: "igCharMetrics"}

ITEM_SIZE = {"igVec3fList": 12, "igFloatList": 4, "beGeneraterPlayerDataList": 4,
             "beGeneraterItemDataList": 4, "beGeneraterItemDataOneList": 4,
             "beGeneraterDataList": 4, "beBaseInfoRamList": 4, "igInfoList": 4,
             "igDataList": 4, "igObjectList": 4, "igNamedObjectList": 4,
             "igIntList": 4, "igShortList": 2, "igCharList": 1, "igBoolList": 1,
             "igUnsignedIntList": 4, "beUnicodeObjList": 4, "beBaseInfoDataList": 4}


def align4(x):
    return (x + 3) & ~3


def walk_directory(b, start, limit):
    """Validated class-record walk: `{name NUL}{pad to even}{6-byte triples}` repeated.

    No count is stored, so a record's end is found by searching forward for the next
    identifier at `align2(name)+6N` whose triples all decode (`type id < 48`).  The
    triple's own size field is *not* checked against a global table: it is per-*pack*
    (type 13 is 4 bytes in the small stage packs and 8 in the big model packs), which
    is what `CANON` used to get wrong and what stopped the model packs at a suffix of
    their class list.  The final class has no next class to sit at a 6-aligned offset
    — its triples run straight into the igMemory type-name pool — so a valid prefix is
    emitted for it and the walk ends.  The result's length matches the blob header's
    class count (`hdr[3]`)."""
    idents = {m.start(): m.group()[:-1]
              for m in re.finditer(rb"[A-Za-z_][A-Za-z0-9_:]{2,60}\x00", b[start:limit])}
    idents = {start + k: v for k, v in idents.items()}

    def triples_ok(pad, n):
        for k in range(n):
            t, o, _s = struct.unpack_from("<3H", b, pad + 6 * k)
            if t >= 48 or not 1 <= o < 4096:
                return False
        return True

    out, cur = [], min(idents) if idents else None
    while cur is not None:
        nm = idents.get(cur)
        if nm is None:
            break
        pad = (cur + len(nm) + 2) & ~1
        best = None
        for n in range(0, 600):
            cand = pad + 6 * n
            if cand > limit:
                break
            if cand in idents and cand > cur and triples_ok(pad, n):
                best = (cand, n)
                break
        if best is None:
            n = 0
            while pad + 6 * (n + 1) <= len(b) and triples_ok(pad, n + 1):
                n += 1
            if n:
                out.append({"name": nm.decode(), "off": cur,
                            "trips": [struct.unpack_from("<3H", b, pad + 6 * k)
                                      for k in range(n)]})
            break
        out.append({"name": nm.decode(), "off": cur,
                    "trips": [struct.unpack_from("<3H", b, pad + 6 * k)
                              for k in range(best[1])]})
        cur = best[0]
    return out, (out[-1]["off"] if out else start)


def parse_directory(b, start=None, limit=None):
    """`{name NUL}{pad to even}{6-byte triples}`, repeated. Returns (records, end);
    the list index *is* the classIndex an instance refers to."""
    limit = limit or len(b)
    if start is None:
        start = find_directory_start(b)
    return walk_directory(b, start, limit)


def find_directory_start(b):
    """Locate the class-record run.

    A directory always opens with the base class `igObject`, so candidates are the
    `\x00igObject\x00` anchors; the one whose validated walk yields the most classes
    wins.  Scoring by walked class count (rather than by raw probe offsets) matters on
    the big packs: several later `igObject`-shaped anchors parse as a *suffix* of the
    directory and would otherwise be chosen."""
    cands = [m.start() + 1 for m in re.finditer(rb"\x00igObject\x00", b[:0x8000])]
    if not cands:
        raise ValueError("could not locate a type directory in this blob")
    best, bestn = cands[0], -1
    for c in cands:
        recs, _ = walk_directory(b, c, min(len(b), c + 0x8000))
        if len(recs) > bestn:
            best, bestn = c, len(recs)
    return best


def decode_record(b, p, dirs, reflection=None):
    """Decode one instance record at `p`, or None if `p` is not a record start.
    The `recordSize` check is what makes this self-validating."""
    if p + 8 > len(b):
        return None
    cl, size = struct.unpack_from("<2I", b, p)
    if cl >= len(dirs) or size < 8 or p + size > len(b):
        return None
    rec = dirs[cl]
    q, vals, name = p + 8, [], None
    for ty, ordn, _sz in rec["trips"]:
        fname = "_name" if ty == 4 and name is None else "slot%d" % ordn
        if ty == 4:
            if q + 4 > len(b):
                return None
            n = struct.unpack_from("<I", b, q)[0]
            if n % 4 or n > 8192 or q + 4 + n > len(b):
                return None
            if n and b[q + 4 + n - 1] != 0:
                return None
            s = b[q + 4:q + 4 + n].split(b"\0")[0].decode("latin1") if n else ""
            if name is None:
                name = s
            vals.append([fname, s, ty])
            q += 4 + n
            continue
        # the descriptor states its own width; it is padded to a 4-byte slot.  Use
        # `_sz` rather than a fixed per-type table because it is per-*pack* (type 13
        # is 4 bytes in the small stage packs, 8 in the big model packs).
        w = align4(_sz)
        if q + w > len(b):
            return None
        if ty == 36:
            vals.append([fname, [round(x, 4) for x in struct.unpack_from("<3f", b, q)], ty])
        elif ty == 38:
            vals.append([fname, [round(x, 4) for x in struct.unpack_from("<4f", b, q)], ty])
        elif ty == 16:
            vals.append([fname, round(struct.unpack_from("<f", b, q)[0], 4), ty])
        elif ty in (2, 3, 8, 34):
            vals.append([fname, b[q], ty])
        elif ty in (12, 31):
            vals.append([fname, struct.unpack_from("<q" if ty == 12 else "<d", b, q)[0], ty])
        elif ty in (10, 17):
            vals.append([fname, struct.unpack_from("<H" if ty == 10 else "<h", b, q)[0], ty])
        else:
            vals.append([fname, struct.unpack_from("<I", b, q)[0], ty])
        q += w
    if q - p != size:
        return None
    return {"off": p, "class": rec["name"], "classIndex": cl, "size": size,
            "name": name, "fields": vals, "end": q}


def find_chains(b, dirs, reflection=None, lo=0x800):
    """Every maximal contiguous record chain in the blob, longest first. Records tile
    without gaps, so a chain is maximal and a failure to decode ends it.

    Two traps the old single-pass version fell into, both measured on `NDMW.AFS`:

      * **The scan stepped by two bytes** from an even `lo`.  The stage packs happen to
        start their records at `2 mod 4`, but the character-model packs (`p_*.igb`,
        e.g. entry 861) start at the other parity, so half the offsets -- and *every*
        record -- were never tried.  The first record of entry 861 is at `0x260f`, odd.
      * **After a chain it jumped `p = q` to the chain's end**, which skips a start that
        lies inside a short false chain.  Both are gone here: every offset is tried, and
        a record start is a *chain* start only when no other record ends on it.

    Walking only the chain starts keeps this O(bytes) rather than quadratic.  A chain
    wholly contained in another (a false start inside a record that still rejoins the
    run) is dropped, so the result is the set of maximal chains."""
    hi = len(b)
    hits = []
    for p in range(lo, hi - 8):
        cl, size = struct.unpack_from("<2I", b, p)
        if cl < len(dirs) and 8 <= size <= 8192 and p + size <= hi:
            if decode_record(b, p, dirs, reflection):
                hits.append((p, p + size))
    ends = {e for _p, e in hits}
    chains = []
    for p, _e in hits:
        if p in ends:
            continue
        recs, q = [], p
        while True:
            r = decode_record(b, q, dirs, reflection)
            if r is None:
                break
            recs.append(r)
            q = r["end"]
        chains.append(recs)
    keep, far = [], -1
    for c in sorted(chains, key=lambda c: c[0]["off"]):
        if c[0]["off"] < far:
            continue
        keep.append(c)
        far = max(far, c[-1]["end"])
    keep.sort(key=len, reverse=True)
    return keep


def list_records(chain):
    """[(data_key, count, class, chainIndex, record)] for every list record in the chain."""
    out = []
    for i, r in enumerate(chain):
        if r["class"] in ITEM_SIZE:
            cnt = next((v for k, v, ty in r["fields"] if k == "slot2"), None)
            dk = next((v for k, v, ty in r["fields"] if k == "slot4"), None)
            if isinstance(cnt, int) and isinstance(dk, int):
                out.append((dk, cnt, r["class"], i, r))
    return sorted(out)


def field_map(r):
    return {k: v for k, v, _t in r["fields"]}


def find_table(b, s1, s2):
    """Locate and validate the id remap table in the gap before section 2.

    Returns (offset, idCount, obj_of_id) where obj_of_id[i] is the section-2 record
    index for table position i, or None for a memory entry.
    """
    lo, hi = s1[-1]["end"], s2[0]["off"]
    for p in range(lo, max(lo, hi) - 8, 2):
        tb, cnt = struct.unpack_from("<II", b, p)
        if not (8 <= tb <= len(b) - p) or not (0 < cnt < 200000):
            continue
        if p + 8 + 2 * cnt > len(b):
            continue
        vals = [struct.unpack_from("<H", b, p + 8 + 2 * i)[0] for i in range(cnt)]
        if max(vals) >= len(s1):
            continue
        obj_of_id, obj = [], []
        for i, v in enumerate(vals):
            r = s1[v]
            obj_of_id.append(None)
            if r["class"] == "igObjectDirEntry":
                obj.append((i, r))
        want = [r["classIndex"] for r in s2]
        # igObjectDirEntry._typeMetaIndex is one of the two int slots (11, 12)
        slot = next(
            (
                s
                for s in ("slot11", "slot12")
                if [field_map(r).get(s) for _i, r in obj] == want
            ),
            None,
        )
        if slot is None:
            continue
        obj = [(i, field_map(r)[slot]) for i, r in obj]
        for k, (i, _c) in enumerate(obj):
            obj_of_id[i] = k
        return p, cnt, obj_of_id
    raise ValueError("no validated id remap table in 0x%x..0x%x" % (lo, hi))


def sections(b):
    """(dirs, section1, section2): the type directory and the two multi-record chains."""
    dirs, _ = parse_directory(b)
    chains = [c for c in find_chains(b, dirs) if len(c) > 1]
    chains.sort(key=lambda c: c[0]["off"])
    if len(chains) < 2:
        raise ValueError(f"expected two object chains, found {len(chains)}")
    return dirs, chains[0], chains[1]


class Graph:
    """Resolved view of a pack: records, the id remap table and memory-block contents.

    The remap table lists every global id. Ids that land on an ``igMemoryDirEntry`` are memory
    blocks (``_memSize`` bytes). The blocks are stored after the object records in ascending id
    order, each padded to 4 bytes, and tile the rest of the pack exactly. A list record's ``_data``
    field is the global id of the block holding its elements.
    """

    def __init__(self, data: bytes):
        self.b = data
        _dirs, self.s1, self.s2 = sections(data)
        off, self.id_count, self.obj_of_id = find_table(data, self.s1, self.s2)
        self.pool_start = self.s2[-1]["end"]
        self._block: dict[int, int] = {}
        cursor = self.pool_start
        for gid in range(self.id_count):
            entry = self.s1[struct.unpack_from("<H", data, off + 8 + 2 * gid)[0]]
            if entry["class"] != "igMemoryDirEntry":
                continue
            self._block[gid] = cursor
            cursor += (field_map(entry)["slot7"] + 3) & ~3
        self.pool_end = cursor
        if cursor != len(data):
            raise ValueError(f"memory blocks end at {cursor}, pack is {len(data)} bytes")

    def vals(self, k: int) -> list:
        return [f[1] for f in self.s2[k]["fields"]]

    def ref(self, value) -> int | None:
        if not isinstance(value, int) or value < 0 or value >= self.id_count:
            return None
        return self.obj_of_id[value]

    def block_offset(self, k: int) -> int:
        """File offset of list record ``k``'s elements."""
        return self._block[self.vals(k)[2]]

    def list_values(self, k: int) -> list:
        """Contents of list record ``k``: ints/floats by list class, raw element ids otherwise."""
        cls = self.s2[k]["class"]
        count = self.vals(k)[0]
        if count == 0:
            return []
        fmt = {"igFloatList": "<f", "igVec3fList": "<3f", "igShortList": "<h", "igCharList": "<b",
               "igBoolList": "<B", "igIntList": "<i"}.get(cls, "<I")
        size = struct.calcsize(fmt)
        base = self.block_offset(k)
        out = [struct.unpack_from(fmt, self.b, base + size * j) for j in range(count)]
        return out if cls == "igVec3fList" else [v[0] for v in out]

    def names(self, k: int) -> list[str | None]:
        """Strings of an ``igNamedObjectList`` (None where the element does not resolve)."""
        out = []
        for gid in self.list_values(k):
            r = self.ref(gid)
            out.append(self.s2[r]["name"] if r is not None and self.s2[r]["class"] == "igNamedObject" else None)
        return out

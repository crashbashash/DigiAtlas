"""Decode a stage generator pack into spawn generators and their drop pools.

Adapted from DW4_Decomp scripts/igb_generators.py. Walks, entirely from the file:

    beGeneraterData              spawn row: name, stat row, position/rotation lists, modes
      -> beGeneraterPlayerDataList -> beGeneraterPlayerData (_geneCount, _geneMaxCount,
           _itemDataList, _itemLastDataList)
           -> beGeneraterItemDataList -> beGeneraterItemData (pool name, n/h/v + zone + family)
                -> beGeneraterItemDataOneList -> beGeneraterItemDataOne (category, id, rank, rate)

``rate`` is out of 10000 (the engine rolls ``RNG() % 10000``), so P(nothing) = 1 - sum(rate)/10000.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import igbpack

# Field positions (index into a record's decoded fields) for the classes we read.
GENE_NAME, GENE_POS, GENE_GLOBAL, GENE_POS_LIST, GENE_ROT_LIST = 0, 1, 2, 3, 4
GENE_ROW, GENE_SEQ, GENE_START_MODE, GENE_START_DATA = 5, 6, 7, 8
GENE_FILL_MODE, GENE_FILL_DATA, GENE_LUA, GENE_PLAYER_LIST = 9, 10, 11, 12
PLAYER_COUNT, PLAYER_MAX, PLAYER_ITEMS, PLAYER_LAST_ITEMS = 0, 1, 2, 3
ITEM_NAME, ITEM_ONES = 0, 1
ONE_CATEGORY, ONE_ID, ONE_RANK, ONE_RATE = 0, 1, 2, 3
LIST_COUNT, LIST_DATA = 0, 2

DIFFICULTY_PREFIX = {"n": "normal", "h": "hard", "v": "veryhard"}


@dataclass
class DropEntry:
    category: str
    id: int
    rank: int
    rate: int


@dataclass
class DropPool:
    name: str
    entries: list[DropEntry] = field(default_factory=list)

    @property
    def difficulty(self) -> str | None:
        return DIFFICULTY_PREFIX.get(self.name[:1]) if self.name[1:2].isupper() else None


@dataclass
class Generator:
    name: str
    row: int
    position: tuple[float, float, float]
    positions: list[tuple[float, float, float]]
    rotations: list[float]
    is_global: bool
    start_mode: str
    fill_mode: str
    lua: str
    gene_count: int | None
    gene_max_count: int | None
    pools: list[DropPool]
    last_pools: list[DropPool]

    def spawns(self) -> list[tuple[float, float, float]]:
        """World positions where this generator places things.

        A global generator lists world coordinates. Otherwise ``position`` is the room anchor and
        the list holds offsets from it (dungeon rooms).
        """
        if self.is_global:
            return list(self.positions) or [self.position]
        x, y, z = self.position
        return [(x + dx, y + dy, z + dz) for dx, dy, dz in (self.positions or [(0.0, 0.0, 0.0)])]


def has_generators(data: bytes) -> bool:
    """Cheap test: does this AFS entry carry a ``beGeneraterData`` class?"""
    return b"beGeneraterData\x00" in data[:0x4000]


class Pack:
    def __init__(self, data: bytes):
        self.g = igbpack.Graph(data)
        self.s2 = self.g.s2

    def _vals(self, k: int) -> list:
        return self.g.vals(k)

    def _ref(self, value) -> int | None:
        return self.g.ref(value)

    def _list_ids(self, k: int) -> list[int]:
        return self.g.list_values(k)

    def _vec3s(self, ref) -> list[tuple[float, float, float]]:
        k = self._ref(ref)
        if k is None or self.s2[k]["class"] != "igVec3fList":
            return []
        return [tuple(round(x, 4) for x in v) for v in self.g.list_values(k)]

    def _floats(self, ref) -> list[float]:
        k = self._ref(ref)
        if k is None or self.s2[k]["class"] != "igFloatList":
            return []
        return [round(x, 5) for x in self.g.list_values(k)]

    def _pools(self, list_ref) -> list[DropPool]:
        lk = self._ref(list_ref)
        if lk is None:
            return []
        out: list[DropPool] = []
        for item_id in self._list_ids(lk):
            ik = self._ref(item_id)
            if ik is None or self.s2[ik]["class"] != "beGeneraterItemData":
                continue
            iv = self._vals(ik)
            pool = DropPool(iv[ITEM_NAME])
            ok = self._ref(iv[ITEM_ONES])
            if ok is not None:
                for one_id in self._list_ids(ok):
                    nk = self._ref(one_id)
                    if nk is None or self.s2[nk]["class"] != "beGeneraterItemDataOne":
                        continue
                    ov = self._vals(nk)
                    pool.entries.append(
                        DropEntry(ov[ONE_CATEGORY], ov[ONE_ID], ov[ONE_RANK], ov[ONE_RATE])
                    )
            out.append(pool)
        return out

    def generators(self) -> list[Generator]:
        out: list[Generator] = []
        for k, rec in enumerate(self.s2):
            if rec["class"] != "beGeneraterData":
                continue
            v = self._vals(k)
            count = maximum = None
            pools: list[DropPool] = []
            last_pools: list[DropPool] = []
            pk = self._ref(v[GENE_PLAYER_LIST])
            if pk is not None and self.s2[pk]["class"] == "beGeneraterPlayerDataList":
                for pid in sorted(set(self._list_ids(pk))):
                    dk = self._ref(pid)
                    if dk is None or self.s2[dk]["class"] != "beGeneraterPlayerData":
                        continue
                    pv = self._vals(dk)
                    if count is None:
                        count, maximum = pv[PLAYER_COUNT], pv[PLAYER_MAX]
                    pools = pools or self._pools(pv[PLAYER_ITEMS])
                    last_pools = last_pools or self._pools(pv[PLAYER_LAST_ITEMS])
            out.append(
                Generator(
                    name=v[GENE_NAME],
                    row=v[GENE_ROW],
                    position=tuple(round(x, 4) for x in v[GENE_POS]),
                    positions=self._vec3s(v[GENE_POS_LIST]),
                    rotations=self._floats(v[GENE_ROT_LIST]),
                    is_global=bool(v[GENE_GLOBAL]),
                    start_mode=v[GENE_START_MODE],
                    fill_mode=v[GENE_FILL_MODE],
                    lua=v[GENE_LUA],
                    gene_count=count,
                    gene_max_count=maximum,
                    pools=pools,
                    last_pools=last_pools,
                )
            )
        return out

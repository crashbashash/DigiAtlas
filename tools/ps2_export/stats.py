"""Enemy stat table (649 rows) from AREA.AFS entry 3.

Layout (USA PS2, DW4_Decomp docs/systems/enemy-data.md, findings #195/#196/#205): plain data,
no code involved. Offsets are relative to AREA.AFS entry 3.

    HPMAX         i32 x 649           @ 0x404c5
    12 stats      i16 x 12 per row    @ 0x44cb9   (row stride 24)
    3 rate bytes  u8 x 3 per row      @ 0x4451d   (CHIMEIRITSU, MAHIRITSU, RARITY)

Column names confirmed so far: stats[0] TSUYOSA (strength), [1] MAMORI (defense),
[2] KASHIKOSA (wisdom), [3] SEISHIN (spirit), [4] SUBAYASA (speed), [11] experience.
Columns 5-10 are exported raw until they are named.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

STAT_ENTRY = 3
ROWS = 649
HP_OFFSET = 0x404C5
STATS_OFFSET = 0x44CB9
RATES_OFFSET = 0x4451D
STAT_COLUMNS = 12

# (row, hp) pairs from the unmodified USA disc; used to detect modified or foreign discs.
ANCHORS = ((1, 58), (5, 649), (60, 3194), (370, 100))


@dataclass
class EnemyRow:
    row: int
    hp: int
    strength: int
    defense: int
    wisdom: int
    spirit: int
    speed: int
    exp: int
    unmapped: list[int]  # stats[5..10]
    crit_rate: int
    paralysis_rate: int
    rarity: int

    @property
    def is_empty(self) -> bool:
        return self.hp == 0


def read_table(entry: bytes) -> list[EnemyRow]:
    need = max(
        HP_OFFSET + 4 * ROWS, STATS_OFFSET + 2 * STAT_COLUMNS * ROWS, RATES_OFFSET + 3 * ROWS
    )
    if len(entry) < need:
        raise ValueError(f"AREA.AFS entry {STAT_ENTRY} is {len(entry)} bytes; stat table needs {need}")
    rows = []
    for r in range(ROWS):
        hp = struct.unpack_from("<i", entry, HP_OFFSET + 4 * r)[0]
        s = struct.unpack_from("<12h", entry, STATS_OFFSET + 24 * r)
        crit, para, rarity = entry[RATES_OFFSET + 3 * r : RATES_OFFSET + 3 * r + 3]
        rows.append(
            EnemyRow(r, hp, s[0], s[1], s[2], s[3], s[4], s[11], list(s[5:11]), crit, para, rarity)
        )
    return rows


def anchors_match(rows: list[EnemyRow]) -> bool:
    return all(rows[r].hp == hp for r, hp in ANCHORS)

"""Enemy stat table: the ``enemy`` database (649 rows) of the game's data pack.

Column meanings (engine names): TSUYOSA strength, MAMORI defense, KASHIKOSA wisdom, SEISHIN
spirit, SUBAYASA speed, RES_* elemental/status resistances, EXP experience, HPMAX hit points,
CHIMEIRITSU critical rate, MAHIRITSU paralysis rate, RARITY crown rank.
"""
from __future__ import annotations

from dataclasses import dataclass

# (row, hp) pairs from the unmodified USA disc; used to detect modified or foreign discs.
ANCHORS = ((1, 58), (5, 649), (60, 3194), (370, 100))

RESISTS = {
    "RES_FIRE": "fire", "RES_ICE": "ice", "RES_THUNDER": "thunder", "RES_DARK": "dark",
    "RES_STUN": "stun", "RES_POISON": "poison",
}


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
    resist: dict[str, int]
    crit_rate: int
    paralysis_rate: int
    rarity: int

    @property
    def is_empty(self) -> bool:
        return self.hp == 0


def from_database(rows: list[dict]) -> list[EnemyRow]:
    return [
        EnemyRow(
            row=i,
            hp=r["HPMAX"],
            strength=r["TSUYOSA"],
            defense=r["MAMORI"],
            wisdom=r["KASHIKOSA"],
            spirit=r["SEISHIN"],
            speed=r["SUBAYASA"],
            exp=r["EXP"],
            resist={name: r[col] for col, name in RESISTS.items()},
            crit_rate=r["CHIMEIRITSU"],
            paralysis_rate=r["MAHIRITSU"],
            rarity=r["RARITY"],
        )
        for i, r in enumerate(rows)
    ]


def anchors_match(rows: list[EnemyRow]) -> bool:
    return all(r < len(rows) and rows[r].hp == hp for r, hp in ANCHORS)

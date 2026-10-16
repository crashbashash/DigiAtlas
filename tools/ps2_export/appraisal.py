"""What the Central appraiser turns an unidentified weapon, core or board into.

The service (``beNDMWShopCtrl40``) charges 300 BIT and picks a level tier from the player's level.
The result tables ``coweapon``, ``coarmor1`` and ``coarmor2`` live in the Central hub's database pack.
Row ``tier * 100`` holds the number of results in its ``ID`` column; the rows after it hold a result's
item ``ID`` and its ``RATE`` out of 10000 (``RANK`` is read and discarded by the game). The game draws
a number from 0 to 9999 and takes the first result whose running total reaches it.
"""
from __future__ import annotations

from . import database
from .afs import Afs

COST = 300
# A tier applies while the level is below its bound; the last tier has no bound.
LEVEL_BOUNDS = (41, 101, 201, 301, 401)
TABLES = {"weapon": "coweapon", "armor1": "coarmor1", "armor2": "coarmor2"}


def tier_levels() -> list[tuple[int, int, int | None]]:
    """(tier, lowest level, highest level or None) for tiers 1 to 6."""
    lows = (0,) + LEVEL_BOUNDS
    return [(n + 1, lows[n], LEVEL_BOUNDS[n] - 1 if n < len(LEVEL_BOUNDS) else None) for n in range(len(lows))]


def results(rows: list[dict], tier: int) -> list[dict]:
    """The possible results of one tier in one table, in the game's order."""
    base = tier * 100
    if base >= len(rows):
        return []
    count = rows[base]["ID"]
    return [{"id": r["ID"], "rate": r["RATE"]} for r in rows[base + 1 : base + 1 + count]]


def find_tables(ndmw: Afs, packs: list[int]) -> dict[str, list[dict]] | None:
    """The result tables from whichever of ``packs`` carries them."""
    for pack in packs:
        data = ndmw.entry(pack)
        if b"coweapon" not in data:
            continue
        tables = database.read_tables(data)
        if all(name in tables for name in TABLES.values()):
            return tables
    return None


def build(tables: dict[str, list[dict]]) -> dict:
    """The appraiser's rules as JSON."""
    tiers = []
    for tier, low, high in tier_levels():
        tiers.append({
            "tier": tier,
            "minLevel": low,
            "maxLevel": high,
            "results": {
                category: [{"category": category, **r} for r in results(tables[name], tier)]
                for category, name in TABLES.items()
            },
        })
    return {"cost": COST, "tiers": tiers}

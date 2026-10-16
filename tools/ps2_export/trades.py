"""Item trades offered by the Digimon in a shop room (Trader Hall).

Each trader's dialogue script is a chain of "if you hold item X, offer item Y" branches. A branch sets
``g_SItemDB/g_SItemID`` (what you hand over) and ``g_TItemDB/g_TItemID`` (what you get). The first branch
of every table takes an Offering (important item 11) in place of a piece of equipment.
"""
from __future__ import annotations

import re
import struct
from dataclasses import dataclass, field

from . import igbpack, luadec

OFFER = re.compile(r'g_SItemDB = "(\w+)"\s+g_SItemID = (\d+)\s+g_TItemDB = "(\w+)"\s+g_TItemID = (\d+)')
SPEAKER = re.compile(r'funcOpenMessage\("talk", "n_(\w+)"')
# Trader models that are not playable Digimon (those are named from the game's evolution table).
EXTRA_NAMES = {"prmame": "Mamemon"}
# The stage script puts each Digimon in the room: model, which of that model it is, position, then rotation.
PLACE = re.compile(
    r'be:sd\("MODELCTRL", "n_(\w+)", (\d+), "GENERATE", "V<(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)>/V<-?[\d.]+,(-?[\d.]+),-?[\d.]+>"\)'
)
# A trader's table is a script per difficulty (n, h, v) and per instance: ``n_<model>_<instance><letter>.lua``,
# or ``n_<model>_<instance>.lua`` when every difficulty shares one.
DIFFICULTY_LETTERS = {"normal": "n", "hard": "h", "veryhard": "v"}


@dataclass(frozen=True)
class Offer:
    give: tuple[str, int]  # (item database, id)
    get: tuple[str, int]


@dataclass(frozen=True)
class Trader:
    name: str
    offers: tuple[Offer, ...]


@dataclass(frozen=True)
class Placed:
    """A trader standing in a room, with the table it uses on each difficulty."""

    name: str
    instance: int
    position: tuple[float, float, float]
    facing: float  # degrees of rotation about the vertical axis
    tables: dict[str, tuple[Offer, ...]] = field(default_factory=dict)  # difficulty -> offers


def parse(source: str, digimon: dict[str, str] | None = None) -> Trader | None:
    """The trade table in one decompiled script, or None when it is not a trader's."""
    speaker = SPEAKER.search(source)
    offers = tuple(Offer((a, int(b)), (c, int(d))) for a, b, c, d in OFFER.findall(source))
    if not speaker or not offers:
        return None
    model = speaker[1]
    return Trader(_names(digimon).get(model, model.capitalize()), offers)


def _names(digimon: dict[str, str] | None) -> dict[str, str]:
    return {**{k[2:]: v for k, v in (digimon or {}).items() if k.startswith("p_")}, **EXTRA_NAMES}


def placements(source: str) -> list[tuple[str, int, tuple[float, float, float], float]]:
    """(model, instance, position, facing) for every Digimon a stage script puts in the room."""
    return [
        (m[1], int(m[2]), (float(m[3]), float(m[4]), float(m[5])), float(m[6]))
        for m in PLACE.finditer(source)
    ]


def scripts(data: bytes) -> dict[str, str]:
    """The decompiled Lua scripts of a pack, by file name (``n_agumon_00h.lua``)."""
    try:
        g = igbpack.Graph(data)
    except (ValueError, struct.error, IndexError, KeyError):
        return {}  # not an object pack
    out: dict[str, str] = {}
    for k, rec in enumerate(g.s2):
        name = rec.get("name")
        if rec["class"] != "beLuaData" or not isinstance(name, str) or not name.endswith(".lua"):
            continue
        obj = g.ref(g.vals(k)[1])
        if obj is None:
            continue
        size, memory = g.vals(obj)[:2]
        try:
            main, _size = luadec.parse_chunk(g.block(memory, size), 0)
            out[name] = luadec.decompile_function_source(main)
        except Exception:  # a shape the decompiler does not know
            continue
    return out


def extract(packs: list[bytes], digimon: dict[str, str] | None = None) -> list[Placed]:
    """The traders standing in a stage, in a fixed order (by name, then by which one they are)."""
    names = _names(digimon)
    placed: dict[tuple[str, int], tuple[tuple[float, float, float], float]] = {}
    files: dict[str, str] = {}
    for data in packs:
        if b"g_TItemID" not in data:
            continue
        files.update(scripts(data))
        for _id, source in luadec.decompile_chunks(data):
            for model, instance, position, facing in placements(source):
                placed.setdefault((model, instance), (position, facing))
    out: list[Placed] = []
    for (model, instance), (position, facing) in sorted(placed.items()):
        tables: dict[str, tuple[Offer, ...]] = {}
        for difficulty, letter in DIFFICULTY_LETTERS.items():
            for file in (f"n_{model}_{instance:02d}{letter}.lua", f"n_{model}_{instance:02d}.lua"):
                trader = parse(files[file], digimon) if file in files else None
                if trader:
                    tables[difficulty] = trader.offers
                    break
        if tables:
            out.append(Placed(names.get(model, model.capitalize()), instance, position, facing, tables))
    return sorted(out, key=lambda t: (t.name, t.instance))

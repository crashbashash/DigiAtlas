"""Item trades offered by the Digimon in a shop room (Trader Hall).

Each trader's dialogue script is a chain of "if you hold item X, offer item Y" branches. A branch sets
``g_SItemDB/g_SItemID`` (what you hand over) and ``g_TItemDB/g_TItemID`` (what you get). The first branch
of every table takes an Offering (important item 11) in place of a piece of equipment.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import luadec

OFFER = re.compile(r'g_SItemDB = "(\w+)"\s+g_SItemID = (\d+)\s+g_TItemDB = "(\w+)"\s+g_TItemID = (\d+)')
SPEAKER = re.compile(r'funcOpenMessage\("talk", "n_(\w+)"')
# Trader models that are not playable Digimon (those are named from the game's evolution table).
EXTRA_NAMES = {"prmame": "Mamemon"}


@dataclass(frozen=True)
class Offer:
    give: tuple[str, int]  # (item database, id)
    get: tuple[str, int]


@dataclass(frozen=True)
class Trader:
    name: str
    offers: tuple[Offer, ...]


def parse(source: str, digimon: dict[str, str] | None = None) -> Trader | None:
    """The trade table in one decompiled script, or None when it is not a trader's."""
    speaker = SPEAKER.search(source)
    offers = tuple(Offer((a, int(b)), (c, int(d))) for a, b, c, d in OFFER.findall(source))
    if not speaker or not offers:
        return None
    model = speaker[1]
    names = {**{k[2:]: v for k, v in (digimon or {}).items() if k.startswith("p_")}, **EXTRA_NAMES}
    return Trader(names.get(model, model.capitalize()), offers)


def extract(packs: list[bytes], digimon: dict[str, str] | None = None) -> list[Trader]:
    """Every trader in a stage's packs, in a fixed order (by name, then by what they offer)."""
    found: list[Trader] = []
    for data in packs:
        if b"g_TItemID" not in data:
            continue
        for _id, source in luadec.decompile_chunks(data):
            trader = parse(source, digimon)
            if trader:
                found.append(trader)
    return sorted(found, key=lambda t: (t.name, [(o.give, o.get) for o in t.offers]))

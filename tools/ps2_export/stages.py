"""Enumerate stages from the NDMW.AFS stage manifests (entries 80-177)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import generators
from .afs import Afs

MANIFEST_RANGE = range(80, 178)
PACK_REF = re.compile(rb"\[0\.(\d+)\]")
STAGE_ID = re.compile(rb"^(stag[0-9A-Za-z]+|dng[0-9a-z]+)$")
# Three consecutive generator packs follow a stage's data packs, in this order (generatorH/N/V.igb).
GENERATOR_DIFFICULTIES = ("hard", "normal", "veryhard")


_FLOOR = re.compile(r"^dng(?:\d{3}|q\d)(?P<kind>[bf])(?P<n>\d+)(?P<variant>[ehv])?$")


def describe(stage_id: str) -> dict:
    """Floor, variant and kind derived from the engine id (``dng101b2`` -> floor B2)."""
    info: dict = {"kind": "field", "floor": None, "variant": None}
    if stage_id.startswith("dng"):
        info["kind"] = "dungeon"
        m = _FLOOR.match(stage_id)
        if m:
            info["floor"] = f"{m['kind'].upper()}{int(m['n'])}"
            info["variant"] = m["variant"]
    elif stage_id.startswith("stagBS"):
        info["kind"] = "boss"
    elif stage_id.startswith("stagML") or stage_id in ("stagIS11", "stagIS12", "stagIS13"):
        info["kind"] = "hub"  # Home Server lobby areas
    elif stage_id.startswith("stagIS"):
        info["kind"] = "system"  # logo, opening, title and other non-area scenes
    return info


@dataclass
class Stage:
    id: str
    manifest_entry: int
    packs: list[int]
    generator_packs: dict[str, int] = field(default_factory=dict)  # difficulty -> AFS entry


def parse_manifest(data: bytes) -> tuple[str | None, list[int]]:
    packs = [int(m) for m in PACK_REF.findall(data)]
    ids = [t for t in re.findall(rb"[ -~]{4,}", data) if STAGE_ID.match(t)]
    return (ids[-1].decode() if ids else None), packs


def list_stages(ndmw: Afs) -> list[Stage]:
    stages: list[Stage] = []
    for entry in MANIFEST_RANGE:
        if entry >= ndmw.count:
            break
        stage_id, packs = parse_manifest(ndmw.entry(entry))
        if not stage_id or not packs:
            continue
        stages.append(Stage(stage_id, entry, sorted(set(packs))))
    starts = sorted({p for st in stages for p in st.packs})
    for stage in stages:
        first = max(stage.packs) + 1
        # The generator packs sit between this stage's own packs and the next stage's first pack. Looking
        # further would borrow the next stage's (a shop room has none of its own).
        later = [p for p in starts if p > max(stage.packs)]
        stop = min([first + 12, ndmw.count] + later[:1])
        found = [idx for idx in range(first, stop) if generators.has_generators(ndmw.entry(idx)[:0x4000])]
        if len(found) >= 3 and found[1] == found[0] + 1 and found[2] == found[0] + 2:
            stage.generator_packs = dict(zip(GENERATOR_DIFFICULTIES, found[:3]))
    return stages

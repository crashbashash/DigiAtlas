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
        stage = Stage(stage_id, entry, sorted(set(packs)))
        first = max(packs) + 1
        window = range(first, min(first + 12, ndmw.count))
        found = [idx for idx in window if generators.has_generators(ndmw.entry(idx)[:0x4000])]
        if len(found) >= 3 and found[1] == found[0] + 1 and found[2] == found[0] + 2:
            stage.generator_packs = dict(zip(GENERATOR_DIFFICULTIES, found[:3]))
        stages.append(stage)
    return stages

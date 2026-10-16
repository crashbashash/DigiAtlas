"""Archive entry names from NDMW.IGB, the root manifest (the game's virtual filesystem).

Adapted from DW4_Decomp scripts/afs_manifest_names.py. Records of class ``igAdxAfsFile`` carry a
name, the archive (0 = NDMW.AFS, 1 = AREA.AFS) and the entry index inside it.
"""
from __future__ import annotations

from . import igbpack

ARCHIVES = {0: "NDMW.AFS", 1: "AREA.AFS"}
SLOT_NAME, SLOT_ARCHIVE, SLOT_ENTRY = 2, 4, 5


def read_names(manifest: bytes) -> dict[str, list[tuple[str, int]]]:
    """file name -> every (archive, entry) carrying it, in manifest order."""
    dirs, _ = igbpack.parse_directory(manifest)
    chain = igbpack.find_chains(manifest, dirs)[0]
    out: dict[str, list[tuple[str, int]]] = {}
    for rec in chain:
        if rec["class"] != "igAdxAfsFile":
            continue
        trips = dirs[rec["classIndex"]]["trips"]
        by_slot = {t[1]: rec["fields"][i][1] for i, t in enumerate(trips)}
        name = (by_slot.get(SLOT_NAME) or "").rstrip("\x00")
        archive, entry = by_slot.get(SLOT_ARCHIVE), by_slot.get(SLOT_ENTRY)
        if name and archive in ARCHIVES and entry is not None:
            out.setdefault(name, []).append((ARCHIVES[archive], entry))
    return out

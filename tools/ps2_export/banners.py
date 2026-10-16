"""Loading-screen banners: one 256x256 picture per stage, with the area and room name baked in.

``ld*.igb`` packs in AREA.AFS hold them, one set per language; the USA set is the highest entry of
each name. ``ldag<id>`` belongs to ``stag<id>`` and ``ldg<id>`` to ``dng<id>``. The area name is
drawn above the room name in the bottom-left corner.
"""
from __future__ import annotations

from . import igbpack, textures
from .afs import Afs

NAME_BAND = (0, 188, 168, 256)  # x0, y0, x1, y1: the area and room text, without the "Loading" sprite


def pack_name(stage_id: str) -> str:
    if stage_id.startswith("stag"):
        return "ldag" + stage_id[4:].lower() + ".igb"
    if stage_id.startswith("dng"):
        return "ldg" + stage_id[3:] + ".igb"
    raise ValueError(f"unknown stage id {stage_id!r}")


def load(area: Afs, names: dict[str, list[tuple[str, int]]], stage_id: str) -> textures.Texture | None:
    """Decode a stage's banner, or None when it has no loading-pack entry or only a tiny placeholder."""
    entries = names.get(pack_name(stage_id))
    if not entries:
        return None
    entry = max(e for archive, e in entries if archive == "AREA.AFS")
    tex = textures.decode_all(igbpack.Graph(area.entry(entry)))[0]
    return tex if (tex.width, tex.height) == (256, 256) else None


def fingerprint(tex: textures.Texture) -> str:
    return textures.region_sha1(tex, *NAME_BAND)

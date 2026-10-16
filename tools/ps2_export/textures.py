"""Decode 8-bit indexed textures (igImage + igClut) from a pack.

The pixel block is ``width * height`` palette indices, stored bottom row first. The 256-colour
palette is 1024 bytes of RGBA (alpha 0-128, where 128 is opaque) in the PS2's CSM1 order, which
swaps bits 3 and 4 of the index.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import igbpack

IMAGE_W, IMAGE_H, IMAGE_PIXELS = 0, 1, 11  # positions in an igImage record
CLUT_COLORS, CLUT_DATA = 1, 3  # positions in an igClut record
PALETTE_BYTES = 1024


@dataclass
class Texture:
    name: str
    width: int
    height: int
    rgba: bytes  # top row first


def _csm1(index: int) -> int:
    return (index & ~0x18) | ((index & 0x08) << 1) | ((index & 0x10) >> 1)


def decode(graph: igbpack.Graph, image: int, clut: int) -> Texture:
    iv, cv = graph.vals(image), graph.vals(clut)
    w, h = iv[IMAGE_W], iv[IMAGE_H]
    if cv[CLUT_COLORS] != 256:
        raise ValueError(f"unsupported palette of {cv[CLUT_COLORS]} colours")
    pixels = graph.block(iv[IMAGE_PIXELS], w * h)
    palette = graph.block(cv[CLUT_DATA], PALETTE_BYTES)
    out = bytearray(w * h * 4)
    for y in range(h):
        src = (h - 1 - y) * w
        for x in range(w):
            e = 4 * _csm1(pixels[src + x])
            o = (y * w + x) * 4
            r, g, b, a = palette[e : e + 4]
            out[o : o + 4] = bytes((r, g, b, min(255, a * 2)))
    return Texture(graph.s2[image]["name"], w, h, bytes(out))


def decode_all(graph: igbpack.Graph) -> list[Texture]:
    """Every igImage paired with the igClut that follows its texture attribute (single-image packs)."""
    images = [k for k, r in enumerate(graph.s2) if r["class"] == "igImage"]
    cluts = [k for k, r in enumerate(graph.s2) if r["class"] == "igClut"]
    if len(images) != len(cluts):
        raise ValueError(f"{len(images)} images but {len(cluts)} palettes")
    return [decode(graph, i, c) for i, c in zip(images, cluts)]


def region_sha1(texture: Texture, x0: int, y0: int, x1: int, y1: int) -> str:
    """SHA-1 of a rectangle of RGBA pixels; used to pin a transcription to its source image."""
    import hashlib

    h = hashlib.sha1()
    for y in range(y0, y1):
        h.update(texture.rgba[(y * texture.width + x0) * 4 : (y * texture.width + x1) * 4])
    return h.hexdigest()

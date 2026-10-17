"""Top-down stage maps built from each stage's own terrain geometry.

A stage pack holds several scenes (terrain, props, interface, characters). The terrain scene is
the large one that actually covers the places generators spawn things, so it is chosen by how many
spawn points fall inside its footprint. The map is cropped to the spawn area plus a margin.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import igbpack, png, render, scene
from .afs import Afs

MIN_TRIANGLES = 200
SKIP_PREFIXES = ("i_", "x_", "g_", "e_", "f_", "m_", "n_", "q_", "s_")  # interface, effects, models
MARGIN = 150.0
MIN_GROUND_TILES = 4  # flat two-triangle meshes at one height that make up a ground plane
MIN_PART_SPAN = 60.0  # meshes narrower than this (trees, pillars, ornaments) are props, not terrain


@dataclass
class StageMap:
    pack: int
    scene: str
    bounds: tuple[float, float, float, float]  # min x, max x, min z, max z (world)
    raster: render.Raster
    coverage: float  # share of spawn points that land on drawn geometry

    def png(self) -> bytes:
        return png.encode_rgba(self.raster.width, self.raster.height, bytes(self.raster.rgba))


def _bbox(tris) -> tuple[float, float, float, float]:
    xs = [p[0] for t in tris for p in t]
    zs = [p[2] for t in tris for p in t]
    return min(xs), max(xs), min(zs), max(zs)


def _inside(box, x: float, z: float) -> bool:
    return box[0] <= x <= box[1] and box[2] <= z <= box[3]


def _span(part) -> float:
    xs = [p[0] for t in part for p in t]
    zs = [p[2] for t in part for p in t]
    return max(max(xs) - min(xs), max(zs) - min(zs))


def _flat_tile_key(part) -> tuple[float, float] | None:
    """(height, size) of a part that is one flat quad (at most two triangles), else None."""
    if len(part) > 2:
        return None
    ys = [p[1] for t in part for p in t]
    return (round(ys[0], 1), round(_span(part), 1)) if max(ys) - min(ys) < 0.5 else None


def ground_tiles(parts) -> set[int]:
    """Indexes of the flat quads that tile a ground or void plane under the stage.

    Such a plane is a grid of equal two-triangle tiles at one height with gaps between them. It is not
    somewhere to walk, and the gaps show as holes in the map. A lone flat quad (an arena floor) stays.
    """
    by_height: dict[tuple[float, float], list[int]] = {}
    for i, part in enumerate(parts):
        key = _flat_tile_key(part)
        if key is not None:
            by_height.setdefault(key, []).append(i)
    return {i for ids in by_height.values() if len(ids) >= MIN_GROUND_TILES for i in ids}


def terrain_parts(s: scene.Scene, min_span: float = MIN_PART_SPAN):
    """The scene's meshes without its props and ground-plane tiles."""
    tiles = ground_tiles(s.parts)
    return [p for i, p in enumerate(s.parts) if i not in tiles and _span(p) >= min_span]


def terrain_triangles(s: scene.Scene, min_span: float = MIN_PART_SPAN):
    """The scene's triangles without its small prop meshes and its ground plane."""
    return [t for part in terrain_parts(s, min_span) for t in part]


def choose_scene(scenes: list[scene.Scene], points: list[tuple[float, float]]) -> scene.Scene | None:
    """The terrain scene: most spawn points inside its footprint, then most triangles."""
    best, best_key = None, None
    for s in scenes:
        if len(s.triangles) < MIN_TRIANGLES or s.name.startswith(SKIP_PREFIXES):
            continue
        box = _bbox(s.triangles)
        hit = sum(_inside(box, x, z) for x, z in points) / len(points) if points else 0.0
        key = (round(hit, 2), len(s.triangles))
        if best_key is None or key > best_key:
            best, best_key = s, key
    return best


def build(
    ndmw: Afs, packs: list[int], spawns: list[tuple[float, float, float]], extra: list[tuple[float, float]] | None = None
) -> StageMap | None:
    """Render the map for one stage, or None when no terrain scene covers its spawn points.

    A stage without spawn points (a shop or lobby) gets its largest terrain scene, cropped to the terrain and
    widened to hold the ``extra`` (x, z) points, such as the Digimon standing in it.
    """
    if not spawns:
        return _build_empty(ndmw, packs, extra or [])
    points = [(x, z) for x, _y, z in spawns]
    ys = sorted(y for _x, y, _z in spawns)
    best: tuple[tuple, int, scene.Scene] | None = None
    for pack in packs:
        data = ndmw.entry(pack)
        try:
            scenes = scene.scenes(igbpack.Graph(data))
        except ValueError:
            continue  # not an object pack (textures, scripts)
        s = choose_scene(scenes, points)
        if s is None:
            continue
        box = _bbox(s.triangles)
        key = (round(sum(_inside(box, x, z) for x, z in points) / len(points), 2), len(s.triangles))
        if best is None or key > best[0]:
            best = (key, pack, s)
    if best is None or best[0][0] < 0.5:
        return None
    _key, pack, s = best
    xs, zs = [x for x, _ in points], [z for _, z in points]
    pad = max(MARGIN, 0.25 * max(max(xs) - min(xs), max(zs) - min(zs)))
    roi = (min(xs) - pad, max(xs) + pad, min(zs) - pad, max(zs) + pad)
    raster = render.render(terrain_triangles(s), roi, focus_y=ys[len(ys) // 2])
    coverage = sum(raster.covered(x, z) for x, z in points) / len(points)
    return StageMap(pack, s.name, roi, raster, coverage)


def _build_empty(ndmw: Afs, packs: list[int], extra: list[tuple[float, float]]) -> StageMap | None:
    """Map of the biggest terrain scene in a stage that has nothing spawning in it."""
    best: tuple[int, int, scene.Scene] | None = None
    for pack in packs:
        try:
            scenes = scene.scenes(igbpack.Graph(ndmw.entry(pack)))
        except ValueError:
            continue
        for s in scenes:
            if len(s.triangles) < MIN_TRIANGLES or s.name.startswith(SKIP_PREFIXES):
                continue
            if best is None or len(s.triangles) > best[0]:
                best = (len(s.triangles), pack, s)
    if best is None:
        return None
    _n, pack, s = best
    tris = terrain_triangles(s)
    if not tris:
        return None
    parts = terrain_parts(s)
    # A backdrop plane spanning the whole scene would make the crop far bigger than the rooms in it, so
    # the crop first leaves out the biggest meshes. They come back when someone stands on one of them.
    overall = max(_span(pt) for pt in parts)
    inner = [pt for pt in parts if _span(pt) < 0.85 * overall] or parts
    for chosen in (inner, parts):
        tris = [t for pt in chosen for t in pt]
        x0, x1, z0, z1 = _bbox(tris)
        ys = sorted(p[1] for t in tris for p in t)
        x0, x1 = min([x0] + [x for x, _ in extra]), max([x1] + [x for x, _ in extra])
        z0, z1 = min([z0] + [z for _, z in extra]), max([z1] + [z for _, z in extra])
        roi = (x0 - MARGIN / 3, x1 + MARGIN / 3, z0 - MARGIN / 3, z1 + MARGIN / 3)
        raster = render.render(tris, roi, focus_y=ys[len(ys) // 2])
        if all(raster.covered(x, z) for x, z in extra):
            break
    return StageMap(pack, s.name, roi, raster, 1.0) if raster.fill >= 0.02 else None

"""Top-down rasteriser for stage geometry (pure Python, standard library only).

Floors (triangles facing up) are filled with a colour ramp by height, drawn lowest first so higher
surfaces cover lower ones. Steep triangles (walls) are drawn as thin edge lines on top. The
background stays transparent so the app can place the map on its own theme. Image x is world x and
image y is world z (z grows downward).
"""
from __future__ import annotations

from dataclasses import dataclass

from .scene import Triangle

WALL_NORMAL_Y = 0.35  # |normal.y| below this counts as a wall
LOW, HIGH = (46, 82, 118), (196, 218, 232)
WALL = (16, 28, 50, 255)


@dataclass
class Raster:
    width: int
    height: int
    pixels_per_unit: float
    rgba: bytearray
    min_x: float
    min_z: float

    @property
    def fill(self) -> float:
        """Share of the image that has geometry. Near 1.0 means a flat floor with no outline."""
        return 1.0 - self.rgba[3::4].count(0) / (self.width * self.height)

    def covered(self, x: float, z: float) -> bool:
        px, py = int((x - self.min_x) * self.pixels_per_unit), int((z - self.min_z) * self.pixels_per_unit)
        return 0 <= px < self.width and 0 <= py < self.height and self.rgba[(py * self.width + px) * 4 + 3] > 0


def _normal_y(t: Triangle) -> float:
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = t
    ux, uy, uz, vx, vy, vz = bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = (nx * nx + ny * ny + nz * nz) ** 0.5
    return ny / length if length > 1e-9 else 0.0


def render(
    triangles: list[Triangle],
    roi: tuple[float, float, float, float],
    max_side: int = 2000,
    max_ppu: float = 4.0,
) -> Raster:
    min_x, max_x, min_z, max_z = roi
    span = max(max_x - min_x, max_z - min_z)
    ppu = min(max_ppu, max_side / span)
    width, height = int((max_x - min_x) * ppu) + 1, int((max_z - min_z) * ppu) + 1
    rgba = bytearray(width * height * 4)

    floors: list[tuple[float, Triangle]] = []
    walls: list[Triangle] = []
    for t in triangles:
        xs = [p[0] for p in t]
        zs = [p[2] for p in t]
        if max(xs) < min_x or min(xs) > max_x or max(zs) < min_z or min(zs) > max_z:
            continue
        if abs(_normal_y(t)) < WALL_NORMAL_Y:
            walls.append(t)
        else:
            floors.append(((t[0][1] + t[1][1] + t[2][1]) / 3, t))
    floors.sort(key=lambda e: e[0])
    if floors:
        heights = sorted(h for h, _ in floors)
        lo, hi = heights[int(len(heights) * 0.02)], heights[int(len(heights) * 0.98)]
    else:
        lo = hi = 0.0

    for h, t in floors:
        f = min(1.0, max(0.0, (h - lo) / (hi - lo))) if hi > lo else 0.5
        color = bytes(int(LOW[i] + (HIGH[i] - LOW[i]) * f) for i in range(3)) + b"\xff"
        _fill(rgba, width, height, [((p[0] - min_x) * ppu, (p[2] - min_z) * ppu) for p in t], color)
    for t in walls:
        q = [((p[0] - min_x) * ppu, (p[2] - min_z) * ppu) for p in t]
        for a, b in ((0, 1), (1, 2), (2, 0)):
            _line(rgba, width, height, q[a], q[b])
    return Raster(width, height, ppu, rgba, min_x, min_z)


def _fill(img: bytearray, w: int, h: int, pts: list[tuple[float, float]], color: bytes) -> None:
    (x0, y0), (x1, y1), (x2, y2) = sorted(pts, key=lambda p: p[1])
    top, bottom = max(0, int(y0 + 0.5)), min(h - 1, int(y2 - 0.5))
    for y in range(top, bottom + 1):
        yc = y + 0.5
        if yc < y0 or yc > y2:
            continue
        xa = x0 + (x2 - x0) * (yc - y0) / (y2 - y0) if y2 > y0 else x0
        if yc < y1:
            xb = x0 + (x1 - x0) * (yc - y0) / (y1 - y0) if y1 > y0 else x1
        else:
            xb = x1 + (x2 - x1) * (yc - y1) / (y2 - y1) if y2 > y1 else x1
        left, right = (xa, xb) if xa <= xb else (xb, xa)
        left, right = max(0, int(left + 0.5)), min(w - 1, int(right - 0.5))
        if right >= left:
            o = (y * w + left) * 4
            img[o : o + (right - left + 1) * 4] = color * (right - left + 1)


def _line(img: bytearray, w: int, h: int, a: tuple[float, float], b: tuple[float, float]) -> None:
    steps = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    for i in range(steps + 1):
        x = int(a[0] + (b[0] - a[0]) * i / steps)
        y = int(a[1] + (b[1] - a[1]) * i / steps)
        if 0 <= x < w and 0 <= y < h:
            o = (y * w + x) * 4
            img[o : o + 4] = bytes(WALL)

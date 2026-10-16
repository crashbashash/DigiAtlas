"""Scene graphs and geometry from a stage pack.

A pack holds several scenes (terrain, props, characters), each an ``igSceneInfo`` pointing at a root
node. Nodes form a tree through ``igNodeList`` child lists; an ``igTransform`` carries a 4x4 row-major
matrix (row vectors, translation in the last row). Geometry hangs off ``igGeometry`` nodes as
``igGeometryAttr1_5`` attributes: a vertex array whose position stream is ``12 * numVerts`` bytes,
drawn as triangle lists (type 3) or strips (type 4, with a primitive-length array).

Field positions are indices into a record's decoded fields (see ``igbpack``).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

from . import igbpack

NODE_CHILDREN = 3  # child igNodeList on igGroup, igTransform, igAttrSet, igSwitch, igGeometry
TRANSFORM_MATRIX = 4
GEOMETRY_ATTRS = 4  # igAttrList on an igGeometry
SCENE_ROOT = 2  # igSceneInfo._sceneGraph (an igNode reference)
ATTR_VERTEX_ARRAY, ATTR_PRIM_TYPE, ATTR_NUM_PRIMS, ATTR_STRIP_LENGTHS = 1, 3, 4, 10
LIST_PRIM_TYPE, STRIP_PRIM_TYPE = 3, 4
IDENTITY = (1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0)

Vec3 = tuple[float, float, float]
Triangle = tuple[Vec3, Vec3, Vec3]


def multiply(a: list[float] | tuple, b: list[float] | tuple) -> tuple:
    """Row-vector composition: apply ``a`` first, then ``b``."""
    return tuple(sum(a[4 * r + k] * b[4 * k + c] for k in range(4)) for r in range(4) for c in range(4))


def transform_point(m, p: Vec3) -> Vec3:
    x, y, z = p
    return (
        x * m[0] + y * m[4] + z * m[8] + m[12],
        x * m[1] + y * m[5] + z * m[9] + m[13],
        x * m[2] + y * m[6] + z * m[10] + m[14],
    )


@dataclass
class Scene:
    index: int  # igSceneInfo record
    name: str
    triangles: list[Triangle] = field(default_factory=list)


class Geometry:
    """Reads and caches meshes (local-space triangles) from one pack's graph."""

    def __init__(self, graph: igbpack.Graph):
        self.g = graph
        self._cache: dict[int, list[Triangle]] = {}

    def _positions(self, attr: int) -> list[Vec3] | None:
        g = self.g
        va = g.ref(g.vals(attr)[ATTR_VERTEX_ARRAY])
        if va is None or g.s2[va]["class"] != "igVertexArray1_1":
            return None
        stream_list, count = g.vals(va)[0], g.vals(va)[1]
        if stream_list not in g._block:
            return None
        ids = struct.unpack_from(f"<{g.block_size(stream_list) // 4}I", g.b, g._block[stream_list])
        for sid in ids:
            if sid in g._block and g.block_size(sid) == 12 * count:
                return [struct.unpack_from("<3f", g.b, g._block[sid] + 12 * j) for j in range(count)]
        return None

    def mesh(self, attr: int) -> list[Triangle]:
        if attr in self._cache:
            return self._cache[attr]
        g, tris = self.g, []
        pos = self._positions(attr)
        if pos is not None:
            v = g.vals(attr)
            ptype, nprims = v[ATTR_PRIM_TYPE], v[ATTR_NUM_PRIMS]
            idx: list[tuple[int, int, int]] = []
            if ptype == LIST_PRIM_TYPE and len(pos) >= 3 * nprims:
                idx = [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(nprims)]
            elif ptype == STRIP_PRIM_TYPE:
                pl = g.ref(v[ATTR_STRIP_LENGTHS])
                if pl is not None and g.s2[pl]["class"] == "igPrimLengthArray1_1":
                    block, count = g.vals(pl)[0], g.vals(pl)[1]
                    if block in g._block:
                        lengths = struct.unpack_from(f"<{count}I", g.b, g._block[block])
                        if sum(lengths) == len(pos):
                            off = 0
                            for length in lengths:
                                for j in range(length - 2):
                                    t = (off + j, off + j + 1, off + j + 2)
                                    idx.append(t if j % 2 == 0 else (t[1], t[0], t[2]))
                                off += length
            tris = [(pos[a], pos[b], pos[c]) for a, b, c in idx]
        self._cache[attr] = tris
        return tris


def scenes(graph: igbpack.Graph) -> list[Scene]:
    """Every scene in the pack with its geometry in scene space (transforms applied)."""
    geometry = Geometry(graph)
    out: list[Scene] = []
    for k, rec in enumerate(graph.s2):
        if rec["class"] != "igSceneInfo":
            continue
        scene = Scene(k, rec["name"])
        root = graph.ref(graph.vals(k)[SCENE_ROOT])
        if root is not None:
            _walk(graph, geometry, root, IDENTITY, scene, set())
        out.append(scene)
    return out


def _walk(graph: igbpack.Graph, geometry: Geometry, node: int, matrix, scene: Scene, seen: set) -> None:
    rec = graph.s2[node]
    vals = graph.vals(node)
    if rec["class"] == "igTransform":
        matrix = multiply(vals[TRANSFORM_MATRIX], matrix)
    if rec["class"] == "igGeometry":
        attrs = graph.ref(vals[GEOMETRY_ATTRS])
        if attrs is not None and graph.s2[attrs]["class"] == "igAttrList":
            for gid in graph.list_values(attrs):
                a = graph.ref(gid)
                if a is not None and graph.s2[a]["class"] == "igGeometryAttr1_5":
                    for t in geometry.mesh(a):
                        scene.triangles.append(tuple(transform_point(matrix, p) for p in t))  # type: ignore[arg-type]
    if node in seen:  # shared subtrees are instanced; guard against cycles
        pass
    children = graph.ref(vals[NODE_CHILDREN]) if len(vals) > NODE_CHILDREN else None
    if children is not None and graph.s2[children]["class"] == "igNodeList":
        for gid in graph.list_values(children):
            c = graph.ref(gid)
            if c is not None and c != node:
                _walk(graph, geometry, c, matrix, scene, seen)

"""Game databases (item names, descriptions, enemy models) from AREA.AFS entry 9.

Entry 9 is the English copy of the database pack (entry 3 holds the same databases with
Japanese text; stat tables are identical). Each ``beDBManagerInfo`` names a database and points at
its ``beDataBase``; the database's last column (index 11) is one flat string list holding a fixed
number of strings per row. Text is CP932 (Shift-JIS).
"""
from __future__ import annotations

from dataclasses import dataclass

from . import igbpack

DATABASE_ENTRY = 9
STRING_COLUMN = 11

# Strings per row, in order. ``stat`` and ``model`` are engine keys that are not shown to players.
ITEM_LAYOUT: dict[str, tuple[str, ...]] = {
    "weapon": ("name", "model", "stat", "description"),
    "armor1": ("name", "description"),
    "armor2": ("name", "stat", "description"),
    "conItem": ("name", "description", "model"),
    "insItem": ("name", "model", "slot"),
    "impItem": ("name", "description"),
    "abChip": ("name", "model", "description"),
}
# Leading glyphs that mark the equipment slot rather than being part of the name.
SLOT_GLYPHS = {"weapon": "∈", "armor1": "∋", "armor2": "∨", "abChip": "∧"}


@dataclass
class ItemText:
    category: str
    id: int
    name: str
    description: str | None


def _decode(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.encode("latin1").decode("cp932", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    # CP932 0x81F7 renders as a pilcrow, but the pickup is the X-Data item (see DW4_Decomp
    # docs/systems/drop-tables.md 5b), so show it the way players know it.
    return text.replace("\u00b6 ", "X-").replace("\u00b6", "X-")


def read_string_columns(entry: bytes) -> dict[str, list[str | None]]:
    """database name -> its decoded string column."""
    g = igbpack.Graph(entry)
    out: dict[str, list[str | None]] = {}
    for k, rec in enumerate(g.s2):
        if rec["class"] != "beDBManagerInfo":
            continue
        v = g.vals(k)
        db = g.ref(v[4])
        if db is None or g.s2[db]["class"] != "beDataBase":
            continue
        column = g.ref(g.vals(db)[STRING_COLUMN])
        out[v[0]] = [_decode(s) for s in g.names(column)] if column is not None else []
    return out


def parse_items(columns: dict[str, list[str | None]]) -> list[ItemText]:
    items: list[ItemText] = []
    for category, layout in ITEM_LAYOUT.items():
        strings = columns.get(category)
        if strings is None:
            raise ValueError(f"database {category!r} missing")
        stride = len(layout)
        if len(strings) % stride:
            raise ValueError(f"{category}: {len(strings)} strings is not a multiple of {stride}")
        glyph = SLOT_GLYPHS.get(category)
        for i in range(len(strings) // stride):
            row = dict(zip(layout, strings[i * stride : (i + 1) * stride]))
            name = row["name"] or ""
            if glyph and name.startswith(glyph):
                name = name[len(glyph) :]
            items.append(ItemText(category, i, name.strip(), row.get("description") or None))
    return items


def enemy_models(columns: dict[str, list[str | None]]) -> dict[int, str]:
    """stat-table row -> internal model name, for rows that exist."""
    return {row: m for row, m in enumerate(columns.get("enemy", [])) if m}

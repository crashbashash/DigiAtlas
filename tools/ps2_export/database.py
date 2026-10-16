"""Game databases (items, enemies) from AREA.AFS entry 9.

Entry 9 is the English copy of the database pack (entry 3 holds the same databases with Japanese
text; the numbers are identical). Each ``beDBManagerInfo`` names a database and points at its
``beDataBase``. A database holds up to six (names, values) column pairs: a list of column names
followed by one flat list of values with a run of ``len(names)`` values per row. The pairs are
bytes, shorts, ints, floats, bools and strings. Text is CP932 (Shift-JIS).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import igbpack

DATABASE_ENTRY = 9

# (names column, values column) in a beDataBase, for each value type.
TYPED_COLUMNS = ((0, 1), (2, 3), (4, 5), (6, 7), (8, 9))
STRING_NAMES, STRING_VALUES = 10, 11

ITEM_DATABASES = ("weapon", "armor1", "armor2", "abChip", "conItem", "insItem", "impItem")
# Leading glyphs that mark the equipment slot rather than being part of the name.
SLOT_GLYPHS = {"weapon": "∈", "armor1": "∋", "armor2": "∨", "abChip": "∧"}
SKILL_TYPES = ("Blunt", "Slash", "Stab", "Bash", "Shot", "Crush")

# Engine column -> exported stat key. Only columns whose meaning is confirmed against the in-game
# description text (see tests) or is unambiguous are exported; the rest (attack delay, flags,
# upgrade costs) are left out rather than guessed. Zero values are omitted from items.
STAT_KEYS = {
    "TSUYOSA": "strength", "MAMORI": "defense", "KASHIKOSA": "wisdom", "SEISHIN": "spirit",
    "SUBAYASA": "speed", "MAXHP": "maxHp", "MAXMP": "maxMp",
    "RES_FIRE": "resistFire", "RES_ICE": "resistIce", "RES_THUNDER": "resistThunder",
    "RES_DARK": "resistDark", "RES_STUN": "resistStun", "RES_POISON": "resistPoison",
    "CHIMEIRITSU": "critRate", "MAHIRITSU": "paralysisRate", "MEICHURITSU": "hitRate",
    "BOUGYORITSU": "defenseRate", "MAHITEIKOU": "paralysisResist", "DOKUTEIKOU": "poisonResist",
    "BITRITSU": "bitRate", "EXPRITSU": "expRate", "LUCKRITSU": "luckRate",
    "HPDRAIN": "hpDrain", "MPDRAIN": "mpDrain", "CHOHATURITSU": "provokeRate",
    "LVPOINT": "equipLevel", "SKILLPOINT": "requiredSkill",
    "HANBAI": "buyPrice", "KAITORI": "sellPrice",
    "HP": "restoreHp", "MP": "restoreMp",
}


# Placeholder items (name is all question marks) are unidentified drops: they are taken to a
# Digimon in the central area, which rolls the real weapon / core / board.
UNIDENTIFIED = {"weapon": "Weapon", "armor1": "Core", "armor2": "Board"}


@dataclass
class Item:
    category: str
    id: int
    name: str
    description: str | None
    stats: dict[str, int] = field(default_factory=dict)
    skill_type: str | None = None
    unidentified: bool = False


def _decode(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.encode("latin1").decode("cp932", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    # CP932 0x81F7 renders as a pilcrow, but the pickup is the X-Data item (see DW4_Decomp
    # docs/systems/drop-tables.md 5b), so show it the way players know it.
    return text.replace("¶ ", "X-").replace("¶", "X-")


def read_tables(entry: bytes) -> dict[str, list[dict]]:
    """database name -> one dict per row, keyed by the engine's column names."""
    g = igbpack.Graph(entry)
    out: dict[str, list[dict]] = {}
    for k, rec in enumerate(g.s2):
        if rec["class"] != "beDBManagerInfo":
            continue
        v = g.vals(k)
        db = g.ref(v[4])
        if db is None or g.s2[db]["class"] != "beDataBase":
            continue
        cols = g.vals(db)
        series: list[tuple[list[str], list]] = []
        for names_at, values_at in TYPED_COLUMNS:
            names = g.names(g.ref(cols[names_at]))
            if names:
                series.append((names, g.list_values(g.ref(cols[values_at]))))
        names = g.names(g.ref(cols[STRING_NAMES]))
        if names:
            series.append((names, [_decode(s) for s in g.names(g.ref(cols[STRING_VALUES]))]))
        row_count = max((len(vals) // len(n) for n, vals in series), default=0)
        rows: list[dict] = [{} for _ in range(row_count)]
        for names, vals in series:
            stride = len(names)
            if len(vals) != stride * row_count:
                raise ValueError(f"{v[0]}: {len(vals)} values for {stride} columns x {row_count} rows")
            for r in range(row_count):
                for c, name in enumerate(names):
                    rows[r][name] = vals[r * stride + c]
        out[v[0]] = rows
    return out


def enemy_models(tables: dict[str, list[dict]]) -> dict[int, str]:
    """stat-table row -> internal model name, for rows that exist."""
    return {i: r["MODEL"] for i, r in enumerate(tables["enemy"]) if r.get("MODEL")}


def parse_items(tables: dict[str, list[dict]]) -> list[Item]:
    items: list[Item] = []
    for category in ITEM_DATABASES:
        if category not in tables:
            raise ValueError(f"database {category!r} missing")
        glyph = SLOT_GLYPHS.get(category)
        for i, row in enumerate(tables[category]):
            name = row.get("NAME") or ""
            if glyph and name.startswith(glyph):
                name = name[len(glyph) :]
            stats = {
                key: row[col] for col, key in STAT_KEYS.items() if row.get(col)
            }
            skill = None
            if category == "weapon" and 0 <= row.get("SKILL", -1) < len(SKILL_TYPES):
                skill = SKILL_TYPES[row["SKILL"]]
            name, text = name.strip(), row.get("TXT") or None
            unidentified = bool(name) and set(name) == {"?"} and category in UNIDENTIFIED
            if unidentified:
                kind = UNIDENTIFIED[category]
                name = f"Unidentified {kind}"
                text = f"Take this to a Digimon in the central area to identify it as a random {kind.lower()}."
                stats.pop("equipLevel", None)  # the game stores 999 as a placeholder
            items.append(Item(category, i, name, text, stats, skill, unidentified))
    return items

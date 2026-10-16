"""Build DigiAtlas JSON from a Digimon World 4 USA PS2 disc image.

    python3 -m ps2_export.export "Digimon World 4 (USA).iso" --out data/generated/ps2

Writes manifest.json, enemies.json, stages.json, drops.json and items.json (schema v1, see
docs/schema.md). Nothing is cached between runs; the whole export takes a few seconds.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import banners, database, generators, iso, maps, png, scripts, stages, stats
from . import manifest as archive_manifest
from .afs import Afs

SCHEMA_VERSION = 1
EXPORTER = {"name": "digiatlas-ps2-export", "version": "0.1.0"}
DIFFICULTIES = ("normal", "hard", "veryhard")
POOL_NAME = re.compile(r"^(?P<d>[nhv])(?P<zone>Z\d+)(?P<family>[A-Za-z]+?)(?P<variant>\d*)$")
KNOWN_GAPS = [
    "enemies[].name: Machinedramon, Devimon/Lucemon form and object names are not in the game text",
    "items[].stats: attack delay, upgrade costs and item flags are not exported (meaning unconfirmed)",
    "stages[]: stage names for 3 system scenes (stagIS07, stagIS08, stagIS20) are unknown",
    "maps: top-down footprints only (floors and walls from the terrain mesh); no room names or icons",
    "trigger-placed item spawns (scripted pickups) are not extracted yet",
]
ENEMY_NAMES = json.loads((Path(__file__).parent / "names" / "enemies.json").read_text())
STAGE_NAMES = json.loads((Path(__file__).parent / "names" / "stages.json").read_text())
KINDS = {"e": "enemy", "f": "boss", "g": "object"}


def _serial(system_cnf: bytes) -> str | None:
    m = re.search(rb"BOOT2\s*=\s*cdrom0:\\?([A-Z]{4}_\d{3}\.\d{2})", system_cnf)
    if not m:
        return None
    raw = m.group(1).decode()
    return f"{raw[:4]}-{raw[5:8]}{raw[9:]}"


def _pool_record(pool: generators.DropPool) -> dict:
    entries = [
        {"category": e.category, "id": e.id, "rank": e.rank, "rate": e.rate} for e in pool.entries
    ]
    rec: dict = {"entries": entries, "totalRate": sum(e["rate"] for e in entries)}
    m = POOL_NAME.match(pool.name)
    if m:
        rec.update(
            difficulty={"n": "normal", "h": "hard", "v": "veryhard"}[m["d"]],
            zone=m["zone"],
            family=m["family"],
            variant=m["variant"] or None,
        )
    return rec


def _drop_map(pools: list[generators.DropPool]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i, pool in enumerate(pools):
        out[pool.difficulty or f"slot{i}"] = pool.name
    return out


def _script_info(g_name: str, stage_scripts: scripts.StageScripts | None) -> dict | None:
    """What the stage's scripts say about a spawner (see ``scripts.StageScripts.status``)."""
    if stage_scripts is None:
        return None
    status, refs = stage_scripts.status(g_name)
    info: dict = {"status": status}
    seen, out = set(), []
    for r in refs:
        key = (r.verb, tuple(r.when))
        if key in seen:
            continue
        seen.add(key)
        out.append({"verb": r.verb, "when": r.when})
    if out:
        info["refs"] = out[:8]
    return info


def _generator_record(g: generators.Generator, stage_scripts: scripts.StageScripts | None = None) -> dict:
    rec: dict = {
        "name": g.name,
        "row": g.row,
        "count": g.gene_count,
        "maxCount": g.gene_max_count,
        "spawns": [[round(v, 3) for v in p] for p in g.spawns()],
        "rotations": g.rotations,
        "startMode": g.start_mode,
        "fillMode": g.fill_mode,
    }
    trigger = g.trigger()
    if trigger:
        center, radius = trigger
        rec["trigger"] = {"center": [round(v, 3) for v in center], "radius": radius}
    if g.lua:
        rec["lua"] = g.lua
    if g.pools:
        rec["drops"] = _drop_map(g.pools)
    if g.last_pools:
        rec["lastDrops"] = _drop_map(g.last_pools)
    players = _player_slots(g)
    if players:
        rec["players"] = players
    info = _script_info(g.name, stage_scripts)
    if info:
        rec["script"] = info
    return rec


def _player_slots(g: generators.Generator) -> list[dict] | None:
    """Per-player-count numbers, only when they differ from the one-player case.

    The game keeps four entries per spawner (one to four players); most are identical, in which case
    the single set of fields on the generator applies to every player count.
    """
    if not g.slots:
        return None
    first = g.slots[0]
    if all(
        (sl.count, sl.max_count, _drop_map(sl.pools), _drop_map(sl.last_pools))
        == (first.count, first.max_count, _drop_map(first.pools), _drop_map(first.last_pools))
        for sl in g.slots
    ):
        return None
    out = []
    for sl in g.slots:
        entry: dict = {"count": sl.count, "maxCount": sl.max_count}
        if sl.pools:
            entry["drops"] = _drop_map(sl.pools)
        if sl.last_pools:
            entry["lastDrops"] = _drop_map(sl.last_pools)
        out.append(entry)
    return out


def export(iso_path: str, out_dir: Path, with_maps: bool = False) -> dict:
    files = iso.list_files(iso_path)
    for needed in ("/SYSTEM.CNF", "/AREA.AFS", "/NDMW.AFS", "/NDMW.IGB", "/SLUS_208.36"):
        if needed not in files:
            raise SystemExit(f"{iso_path} does not look like the USA PS2 disc: missing {needed}")

    def src(name: str) -> iso.Source:
        f = files["/" + name]
        return iso.Source(iso_path, f.offset, f.size)

    area, ndmw = Afs(src("AREA.AFS")), Afs(src("NDMW.AFS"))

    # --- text databases (English copy) -----------------------------------------------
    tables = database.read_tables(area.entry(database.DATABASE_ENTRY))
    models = database.enemy_models(tables)
    flag_names = scripts.load_flag_names()
    player_digimon = {r["MODEL_NAME"]: r["NAME"] for r in tables.get("shinka", []) if r.get("MODEL_NAME") and r.get("NAME")}

    # --- enemies -----------------------------------------------------------------------
    table = stats.from_database(tables["enemy"])
    anchors_ok = stats.anchors_match(table)
    unnamed = sorted({m for m in models.values() if m not in ENEMY_NAMES})
    if unnamed:
        raise SystemExit(f"no display name for models {unnamed}; add them to names/enemies.json")
    enemies = {
        "rowCount": len(table),
        "rows": [
            {
                "row": r.row,
                "name": ENEMY_NAMES[models[r.row]]["name"],
                "kind": KINDS[models[r.row][0]],
                "model": models[r.row],
                "hp": r.hp,
                "stats": {
                    "strength": r.strength,
                    "defense": r.defense,
                    "wisdom": r.wisdom,
                    "spirit": r.spirit,
                    "speed": r.speed,
                    "exp": r.exp,
                },
                "resist": r.resist,
                "rates": {"crit": r.crit_rate, "paralysis": r.paralysis_rate},
                "rarity": r.rarity,
            }
            for r in table
            if not r.is_empty and r.row in models
        ],
    }

    # --- stages, generators, drop pools -----------------------------------------------
    stage_records, pools = [], {}
    names = archive_manifest.read_names(src("NDMW.IGB").read(0, files["/NDMW.IGB"].size))
    map_dir = out_dir / "maps"
    banner_dir = out_dir / "banners"
    banner_dir.mkdir(parents=True, exist_ok=True)
    all_stages = stages.list_stages(ndmw)
    unnamed = sorted(st.id for st in all_stages if st.id not in STAGE_NAMES)
    if unnamed:
        raise SystemExit(f"no name entry for stages {unnamed}; add them to names/stages.json")
    for st in all_stages:
        label = STAGE_NAMES[st.id]
        tex = banners.load(area, names, st.id)
        if tex is not None:
            (banner_dir / f"{st.id}.png").write_bytes(png.encode_rgba(tex.width, tex.height, tex.rgba))
        rec: dict = {
            "id": st.id,
            "area": label["area"],
            "room": label["room"],
            **stages.describe(st.id),
            "banner": f"banners/{st.id}.png" if tex is not None else None,
            "manifestEntry": st.manifest_entry,
            "packs": st.packs,
            "generatorPacks": st.generator_packs or None,
            "difficulties": {},
        }
        map_points: list[tuple[float, float, float]] = []
        stage_scripts = scripts.analyse([ndmw.entry(pk) for pk in st.packs], player_digimon, flag_names) if st.generator_packs else None
        for difficulty in DIFFICULTIES:
            idx = st.generator_packs.get(difficulty)
            if idx is None:
                continue
            gens = generators.Pack(ndmw.entry(idx)).generators()
            map_points.extend(p for g in gens for p in g.spawns())
            for g in gens:
                for slot in g.slots or [generators.PlayerSlot(0, 0, g.pools, g.last_pools)]:
                    for pool in slot.pools + slot.last_pools:
                        pools.setdefault(pool.name, _pool_record(pool))
            rec["difficulties"][difficulty] = {"generators": [_generator_record(g, stage_scripts) for g in gens]}
        rec["map"] = None
        if with_maps:
            built = maps.build(ndmw, st.packs, map_points)
            if built is not None:
                map_dir.mkdir(parents=True, exist_ok=True)
                (map_dir / f"{st.id}.png").write_bytes(built.png())
                min_x, max_x, min_z, max_z = built.bounds
                rec["map"] = {
                    "image": f"maps/{st.id}.png",
                    "bounds": {"minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z},
                    "width": built.raster.width,
                    "height": built.raster.height,
                    "pixelsPerUnit": round(built.raster.pixels_per_unit, 4),
                    "coverage": round(built.coverage, 3),
                    "fill": round(built.raster.fill, 3),
                }
        stage_records.append(rec)

    # --- items (every item in the game database) ---------------------------------------
    items = []
    for i in database.parse_items(tables):
        rec = {"category": i.category, "id": i.id, "name": i.name, "description": i.description}
        if i.unidentified:
            rec["unidentified"] = True
        if i.skill_type:
            rec["skillType"] = i.skill_type
        if i.stats:
            rec["stats"] = i.stats
        items.append(rec)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "platform": "ps2",
        "region": "usa",
        "serial": _serial(src("SYSTEM.CNF").read(0, files["/SYSTEM.CNF"].size)),
        "source": {
            "kind": "iso",
            "name": Path(iso_path).name,
            "executableSha1": hashlib.sha1(
                src("SLUS_208.36").read(0, files["/SLUS_208.36"].size)
            ).hexdigest(),
            "statTableVerified": anchors_ok,
        },
        "exporter": EXPORTER,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "counts": {
            "enemyRows": len(enemies["rows"]),
            "stages": len(stage_records),
            "stagesWithGenerators": sum(1 for s in stage_records if s["difficulties"]),
            "stageMaps": sum(1 for s in stage_records if s["map"]),
            "generators": sum(
                len(d["generators"]) for s in stage_records for d in s["difficulties"].values()
            ),
            "dropPools": len(pools),
            "items": len(items),
        },
        "files": ["enemies.json", "stages.json", "drops.json", "items.json"],
        "assets": ["banners/"] + (["maps/"] if with_maps else []),
        "knownGaps": KNOWN_GAPS,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    payloads = {
        "manifest.json": manifest,
        "enemies.json": enemies,
        "stages.json": {"stages": stage_records},
        "drops.json": {"pools": pools},
        "items.json": {"items": items},
    }
    for name, payload in payloads.items():
        (out_dir / name).write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("iso", help="Digimon World 4 (USA) PS2 disc image")
    ap.add_argument("--out", default="data/generated/ps2", help="output directory")
    ap.add_argument("--maps", action="store_true", help="also render top-down stage maps (a few minutes)")
    args = ap.parse_args(argv)
    manifest = export(args.iso, Path(args.out), args.maps)
    print(json.dumps(manifest["counts"], indent=1))
    if not manifest["source"]["statTableVerified"]:
        print("warning: stat table anchors did not match; disc may be modified or not vanilla USA",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

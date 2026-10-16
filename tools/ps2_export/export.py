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

from . import generators, iso, stages, stats
from .afs import Afs

SCHEMA_VERSION = 1
EXPORTER = {"name": "digiatlas-ps2-export", "version": "0.1.0"}
DIFFICULTIES = ("normal", "hard", "veryhard")
POOL_NAME = re.compile(r"^(?P<d>[nhv])(?P<zone>Z\d+)(?P<family>[A-Za-z]+?)(?P<variant>\d*)$")
KNOWN_GAPS = [
    "enemies[].model: the row-to-model-name column is not decoded from the disc yet",
    "enemies[].unmapped: stat columns 5-10 are exported raw",
    "items[].name: display names need an overlay (--item-names); not yet read from the disc",
    "stages[].name and maps: stage ids only; floor maps are not extracted yet",
]


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


def _generator_record(g: generators.Generator) -> dict:
    rec: dict = {
        "name": g.name,
        "row": g.row,
        "count": g.gene_count,
        "maxCount": g.gene_max_count,
        "position": list(g.position),
        "positions": [list(p) for p in g.positions],
        "rotations": g.rotations,
        "positionIsGlobal": g.is_global,
        "startMode": g.start_mode,
        "fillMode": g.fill_mode,
    }
    if g.lua:
        rec["lua"] = g.lua
    if g.pools:
        rec["drops"] = _drop_map(g.pools)
    if g.last_pools:
        rec["lastDrops"] = _drop_map(g.last_pools)
    return rec


def export(iso_path: str, out_dir: Path, item_names: dict | None = None) -> dict:
    files = iso.list_files(iso_path)
    for needed in ("/SYSTEM.CNF", "/AREA.AFS", "/NDMW.AFS", "/SLUS_208.36"):
        if needed not in files:
            raise SystemExit(f"{iso_path} does not look like the USA PS2 disc: missing {needed}")

    def src(name: str) -> iso.Source:
        f = files["/" + name]
        return iso.Source(iso_path, f.offset, f.size)

    area, ndmw = Afs(src("AREA.AFS")), Afs(src("NDMW.AFS"))

    # --- enemies -----------------------------------------------------------------------
    table = stats.read_table(area.entry(stats.STAT_ENTRY))
    anchors_ok = stats.anchors_match(table)
    enemies = {
        "rowCount": stats.ROWS,
        "rows": [
            {
                "row": r.row,
                "model": None,
                "hp": r.hp,
                "stats": {
                    "strength": r.strength,
                    "defense": r.defense,
                    "wisdom": r.wisdom,
                    "spirit": r.spirit,
                    "speed": r.speed,
                    "exp": r.exp,
                },
                "unmapped": r.unmapped,
                "rates": {"crit": r.crit_rate, "paralysis": r.paralysis_rate},
                "rarity": r.rarity,
            }
            for r in table
            if not r.is_empty
        ],
    }

    # --- stages, generators, drop pools -----------------------------------------------
    stage_records, pools = [], {}
    for st in stages.list_stages(ndmw):
        rec: dict = {
            "id": st.id,
            "manifestEntry": st.manifest_entry,
            "packs": st.packs,
            "generatorPacks": st.generator_packs or None,
            "difficulties": {},
        }
        for difficulty in DIFFICULTIES:
            idx = st.generator_packs.get(difficulty)
            if idx is None:
                continue
            gens = generators.Pack(ndmw.entry(idx)).generators()
            for g in gens:
                for pool in g.pools + g.last_pools:
                    pools.setdefault(pool.name, _pool_record(pool))
            rec["difficulties"][difficulty] = {"generators": [_generator_record(g) for g in gens]}
        stage_records.append(rec)

    # --- items (every id that appears in a pool) ------------------------------------
    names = item_names or {}
    seen = sorted({(e["category"], e["id"]) for p in pools.values() for e in p["entries"]})
    items = [
        {
            "category": c,
            "id": i,
            "name": names.get(c, {}).get(str(i)),
        }
        for c, i in seen
    ]

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
            "generators": sum(
                len(d["generators"]) for s in stage_records for d in s["difficulties"].values()
            ),
            "dropPools": len(pools),
            "items": len(items),
        },
        "files": ["enemies.json", "stages.json", "drops.json", "items.json"],
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
    ap.add_argument(
        "--item-names",
        help='optional JSON overlay: {"weapon": {"0": "Battle Hawk α"}, "conItem": {...}}',
    )
    args = ap.parse_args(argv)
    names = json.loads(Path(args.item_names).read_text()) if args.item_names else None
    manifest = export(args.iso, Path(args.out), names)
    print(json.dumps(manifest["counts"], indent=1))
    if not manifest["source"]["statTableVerified"]:
        print("warning: stat table anchors did not match; disc may be modified or not vanilla USA",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

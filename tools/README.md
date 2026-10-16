# Tools

## PS2 exporter (`ps2_export`)

Reads a Digimon World 4 (USA) PS2 disc image and writes DigiAtlas JSON ([schema](../docs/schema.md)).
Python 3.10+, standard library only.

```sh
cd tools
python3 -m ps2_export.export "/path/to/Digimon World 4 (USA).iso" --out ../data/generated/ps2
```

It takes a few seconds. Output stays out of git (`data/generated/` is ignored).

| Module | Reads |
|---|---|
| `iso.py`, `afs.py` | ISO9660 files and CRI AFS archive entries |
| `igbpack.py` | igBinary stage packs: type directory, record chains, id remap table, list pool |
| `generators.py` | Spawn generators and drop pools from a generator pack |
| `stages.py` | Stage manifests (`NDMW.AFS` entries 80-177) and their generator packs |
| `stats.py` | The 649-row enemy stat table (`AREA.AFS` entry 3) |
| `database.py` | Item names/descriptions and the stat-row to model column (`AREA.AFS` entry 9, English) |
| `names/enemies.json` | Curated enemy display names, by internal model |

`igbpack.py` and `generators.py` are adapted from the DW4 decompilation tooling (`igb_inst.py`,
`igb_ids.py`, `igb_generators.py`).

## Tests

```sh
python3 -m unittest discover -s tests
DIGIATLAS_PS2_ISO="/path/to/Digimon World 4 (USA).iso" python3 -m unittest discover -s tests
```

The second form also exports the disc and checks documented pool totals, per-difficulty spawn
rows, that every dropped item has a name, that disc-sourced enemy names appear in the game text, and
the output against the JSON schemas (needs `jsonschema` for that last check).

# Importer

Reads a Digimon World 4 disc image (PS2: USA, Europe or Japan; GameCube: USA or Japan) and writes DigiAtlas data ([schema](../docs/schema.md)).
The desktop app runs it when you choose a disc image; the command line is for development:

```sh
cargo run --release -- "/path/to/Digimon World 4 (USA).iso" --out ../data/generated/ps2 --maps
```

A full import with maps takes about 20 seconds and up to about 2 GB of memory. Output stays out of
git (`data/generated/` is ignored). Pure Rust, so it builds the same on Linux, Windows and macOS.

| Module                                | Reads                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `iso.rs`, `afs.rs`                    | ISO9660 files and CRI AFS archive entries                                                                                |
| `igb.rs`                              | igBinary stage packs: type directory, record chains, id remap table, list pool                                           |
| `generators.rs`                       | Spawn generators and drop pools from a generator pack                                                                    |
| `stages.rs`                           | Stage manifests (`NDMW.AFS` entries 80-177) and their generator packs                                                    |
| `database.rs`                         | The game's databases from `AREA.AFS` entry 9 (English): named columns for items and enemies                              |
| `stats.rs`                            | Enemy stat rows built from the `enemy` database                                                                          |
| `appraisal.rs`                        | What the Central appraiser turns unidentified items into                                                                 |
| `manifest.rs`                         | Archive entry names from `NDMW.IGB` (finds each stage's banner pack)                                                 |
| `textures.rs`, `banners.rs`, `png.rs` | 8-bit paletted texture decode, loading banners, PNG writer                                                               |
| `scene.rs`                            | Scene graphs: transforms, `igGeometry` nodes, vertex and primitive streams to triangles                                  |
| `luadec.rs`, `scripts.rs`             | Lua 4.0.1 decompiler and the analysis of spawner START/RESTART/STOP calls with their conditions                          |
| `trades.rs`                           | Item trades offered in shop rooms                                                                                        |
| `render.rs`, `maps.rs`                | Top-down raster of the terrain scene (floors shaded by height, walls as lines) and the choice of terrain scene per stage |
| `export.rs`                           | Puts it all together and writes the folder                                                                               |

Built-in name tables, edited by hand:

| File                 | Holds                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `names/enemies.json` | Enemy display names, by internal model                                                    |
| `names/flags.json`   | Story and quest flag meanings (from the decomp's flag table, high/medium confidence only) |
| `names/stages.json`  | Stage area/room names transcribed from the loading banners, with banner fingerprints      |

`IMPORTER_VERSION` in `export.rs` is recorded in each import. Raise it whenever the output changes,
so the app imports the disc again instead of showing data from the older importer.

## Tests

```sh
cargo test
DIGIATLAS_PS2_ISO="/path/to/Digimon World 4 (USA).iso" cargo test --release
```

The second form also imports the disc and checks documented pool totals, per-difficulty spawn
rows, script conditions, trades, maps, that every dropped item has a name, that disc-sourced enemy
names appear in the game text, and the output against the JSON schemas.

To check that a change leaves the output alone, import before and after it and compare:

```sh
cargo run --release --example compare_exports -- before/ after/
```

Release detection follows `SYSTEM.CNF` and its actual boot executable. The manifest
records `region`, `serial` and `framesPerSecond` (50 for Europe, 60 for USA/Japan).
Optional regional integration tests import complete maps and validate all JSON schemas:

```sh
DIGIATLAS_PS2_EUROPE_ISO="/path/to/europe.iso" DIGIATLAS_PS2_JAPAN_ISO="/path/to/japan.iso" cargo test --test regions
```

GameCube imports use the disc header, FST and boot DOL. ISO/GCM and NKit ISO are
read directly; RVZ, WIA, GCZ and CISO are streamed through [nod](https://docs.rs/nod/1.4.4/nod/)
without a whole-disc temporary extraction. The pinned reader has a small
[local compatibility patch](vendor/nod/DIGIATLAS.md) for extended mod images whose
last processing sector is shorter than 32 KiB. The partial range must end exactly
at the declared logical EOF; missing data and misaligned interior ranges still
fail. Logical disc size and source bytes are preserved. Synthetic `tests/rvz.rs`
checks compressed/uncompressed tails, backward seeks, footer reads and failures.
Authored AFS/IGB/Lua data is decoded by
the same importer as PS2. Set `DIGIATLAS_GC_USA_ISO` and/or
`DIGIATLAS_GC_JAPAN_ISO` to run the regional map/schema tests against those discs.

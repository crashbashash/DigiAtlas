# DigiAtlas data schema (v1)

Every platform reader writes the same five files into `data/generated/<platform>/`. The app only
reads this format, so platform differences live in the readers and never in the UI. JSON Schema
files are in [`schema/v1/`](../schema/v1).

| File | Contents |
|---|---|
| `manifest.json` | Platform, region, serial, source fingerprint, counts, and `knownGaps` |
| `enemies.json` | Live rows of the platform's enemy stat table |
| `stages.json` | Stages and, per difficulty, their spawn generators |
| `drops.json` | Drop pools keyed by name |
| `items.json` | Every `(category, id)` that appears in a pool, with an optional display name |

## How the pieces link

```
stages[].difficulties.<d>.generators[]  --row-->  enemies.rows[].row
                                        --drops.<d>--> drops.pools.<name>
drops.pools.*.entries[] (category, id)  ------------> items[] (category, id)
```

- **Rows are platform-specific.** A `row` is an index into that platform's stat table. Keep
  `manifest.platform` alongside any row you store.
- **Difficulty is a first-class axis.** A stage's generator pack exists once per difficulty and
  usually points the same spawner at a stronger row (Guard Room goblins: rows 2 / 6 / 10 on
  Normal / Hard / Very Hard). Five stages even differ in which generators exist, so the
  difficulties are stored separately and are not merged.
- **Pools are shared by name.** Pool names never conflict across stages (checked on all 344), so
  `drops.json` stores each once. Names read `<n|h|v><zone><family><variant>`, e.g. `nZ1gobr3` =
  Normal / zone Z1 / goblins / variant 3. A generator's `drops` map holds one pool per difficulty,
  because the engine indexes the list by the player's difficulty.
- **Drop rates** are out of 10000 (`RNG() % 10000`), so `P(nothing) = 1 - totalRate / 10000`.
  Boss pools often total exactly 10000.

## Nullable and unresolved fields

The exporter never invents values. Anything it cannot read from the disc is `null` or listed in
`manifest.knownGaps`:

- `enemies.rows[].model` is `null` until the row-to-model-name column is decoded.
- `enemies.rows[].unmapped` holds stat columns 5-10, unnamed so far.
- `items[].name` is `null` unless supplied by an overlay (`--item-names`).
- Stages carry only their engine id (`stagGF01`, `dng101b1`); there are no display names or floor
  maps yet.

## Verification

`manifest.source.statTableVerified` is `false` when known anchor values (HP of rows 1, 5, 60, 370)
differ, which means a modified or non-vanilla disc. The opt-in disc test also checks pool totals
and per-difficulty rows against figures documented in the decompilation, and a Hard-difficulty
export matched an independent live capture for all 72 generators of Abyss of Grief (`stag0102`).

## Adding a platform

Write a reader that emits these five files with its own `platform` value. Fields that differ
between versions (for example a drop rate changed on another platform) are separate exports, so
two platforms can be compared by loading both.

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

## Names and text

Players see `name`, never the internal ids.

- **Items** (`items.json`): all 590 items with their in-game English `name` and `description`, read
  from the disc's text database (AREA.AFS entry 9, Shift-JIS). `id` is the index within its category
  and matches drop-pool entries. Slot glyphs (`∈ ∋ ∨ ∧`) are stripped from names; the X-Data item
  (stored as a pilcrow) is written `X-Data`. The three X-Data rows share one name.
- **Enemies** (`enemies.json`): `name` comes from a small curated table (`names/enemies.json`).
  `kind` is `enemy`, `boss`, or `object` (a destructible box, barrel or case). `model` is the engine's
  internal name, kept only for debugging and icon lookup. Names marked `disc` in the table appear in
  the game's own card album and are checked by the disc test; the rest follow the decompilation
  roster (Machinedramon variants, boss forms and object names are not in the game text).
- **Enemy stats**: `hp`, `stats` (strength, defense, wisdom, spirit, speed, exp), `resist` (fire, ice,
  thunder, dark, stun, poison), `rates` (crit, paralysis) and `rarity` (crown rank). Values are as
  stored by the game; units for resistances and rates are not confirmed.
- **Item stats**: `items[].stats` holds only non-zero values (absent means 0): strength, defense,
  wisdom, spirit, speed, maxHp, maxMp, the resistances, critRate, hitRate, paralysisRate, equipLevel,
  requiredSkill, buyPrice, sellPrice, restoreHp, restoreMp and a few rates. Weapons also carry
  `skillType` (Blunt, Slash, Stab, Bash, Shot, Crush). Each label was checked against the in-game
  description text by the disc tests (consumable HP/MP, armor equip level, chip stat bonuses,
  weapon skill type and requirement). Columns whose meaning is unconfirmed (attack delay, upgrade
  costs, item flags) are not exported.

## Not extracted yet

Anything the exporter cannot read is absent or listed in `manifest.knownGaps`, never invented:

- Stages carry only their engine id (`stagGF01`, `dng101b1`); no display names or floor maps yet.
- Scripted pickups placed by triggers are not extracted; destructibles are (as generators).

## Data quirks

- Three Kokatorimon spawners in `stag0104` reference stat row 90, which is an empty slot in the game
  data. They are exported as found; treat them as inert.
- Dbl Axe, Rage Hammer, Hekatoncheir, Fang Smasher and Meteor Force (ids 100-124) are described as
  "Bash Skill" in game but stored with the Blunt skill index. `skillType` follows the stored value.
- The unique weapons (ids 266-275) display "Skill 1" but store a requirement of 0.
- Placeholder entries (`???????`) are real items in the game's data (unknown weapon, core and board).

## Verification

`manifest.source.statTableVerified` is `false` when known anchor values (HP of rows 1, 5, 60, 370)
differ, which means a modified or non-vanilla disc. The opt-in disc test also checks pool totals
and per-difficulty rows against figures documented in the decompilation, and a Hard-difficulty
export matched an independent live capture for all 72 generators of Abyss of Grief (`stag0102`).

## Adding a platform

Write a reader that emits these five files with its own `platform` value. Fields that differ
between versions (for example a drop rate changed on another platform) are separate exports, so
two platforms can be compared by loading both.

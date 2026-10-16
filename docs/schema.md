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

- **Stages** (`stages.json`): `area` and `room` are the names printed on the game's own loading
  banner (for example Death Valley / Abyss of Grief). The banner is a 256x256 picture in the disc's
  loading packs, so the names were read from the images and each transcription is pinned to a
  fingerprint of its banner text, which the disc test re-checks. The banner pictures are exported
  to `banners/<id>.png` and linked from `stages[].banner` (92 of the 98 stages have one).
  `floor` comes from the id (`dng101b2` is floor B2; `b` and `f` are the game's letters) and `kind` is
  `field`, `dungeon`, `boss`, `hub` or `system`. Floors of one dungeon share a banner. The side
  dungeons (`dngq*`) carry a trailing `variant` letter (e, h or v) whose meaning is not confirmed;
  the three variants share the same spawn rows and drop pools, so it is not a difficulty setting.
  Notes: the area on the Goblin Fortress banners reads "Fortress", and `stag0000` is the Japanese-text
  debug stage.

- **Spawn positions** (`generators[].spawns`): world positions `[x, y, z]`. The game stores either world
  coordinates (global generators) or offsets from a room anchor (dungeon rooms); the exporter resolves
  both, so `spawns` is always world space. Every spawn lands on the stage's terrain (checked on map
  coverage below).
- **Scripts** (`generators[].script`): the exporter decompiles every Lua script in a stage's packs and
  records what they do to each spawner. `status` is `referenced` (a script names it; `refs` lists each
  START/RESTART/STOP with the conditions it sits under, in words), `dynamic` (a script builds names in
  a loop, such as the box spawners, and this one fits the pattern), `unknown` (the stage starts
  spawners by a name that cannot be read) or `none` (no script mentions it). Radar spawners start by
  themselves, so `none` is normal for them (the decomp saw Abyss of Grief's radar goblins spawn live with
  no script). A script-started spawner that is `none` is most likely never used; the app leaves those out
  by default. Checks behind that: all 4,838 script chunks decompile, no spawner name appears in a script
  outside a spawner command, dungeons come out 5% unused and boss arenas 0%, Humid Cave B2 gives exactly the
  20 enemies of the original dungeon map, and Goblin Pass gives the two goblins seen in the game at the
  bridge. Field stages are 67% unused, which is where the authored extras sit.
  Conditions are written in words. Story and quest flags are named from the decomp's flag table (only its
  high and medium confidence entries; per-stage scratch flags are not named): "events 598-610 done (600: Boss 1
  story scene done; ...; 610: Final boss story scene done)". A flag a script tests as "not done yet" and
  sets itself in the same script is a once-only latch and reads "this is the first time (event 339)".
  The Digimon you play is named from the game's own evolution table.
- **Player count** (`generators[].players`): every spawner has four entries in the game, one per number of
  players, and in 13% of them the count, the alive-at-once cap or the drop pools differ (counts never fall
  as players are added, in 99.5% of cases they rise). The fields on the generator are the one-player case;
  `players` is present only when an entry differs, entry 0 meaning one player and entry 3 four. That the
  entry index is the number of players (and not a player's own slot) is read from the data, where counts
  rise by about one per entry, and is not confirmed in the code.
- **Which spots are used.** A spawner's `spawns` list is the list the game steps through: each enemy goes to
  the next spot and the cursor wraps around the list, with no randomness (read from the spawn function's
  code). So a spawner that places `count` enemies among more spots uses the first `count` of them, and a
  spawner that spawns more than it has spots (respawn waves) cycles through all of them. The code never
  sets the starting cursor, so a start at the first spot is an assumption; it can shift an enemy to a free
  spot nearby if the exact one is occupied.
- **Triggers** (`generators[].trigger`): a radar spawner starts when a player is within `radius` units of
  `center` (the game stores the squared radius; 20 to 150 units, one arena at 450). Only radar spawners have
  one. Script-started (`direct`) spawners start when a game script says so, which is not extracted yet.
- **Maps** (`stages[].map`, export option `--maps`): a top-down footprint of each stage's terrain mesh,
  written to `maps/<id>.png` (transparent where there is no geometry) with its world `bounds` and
  `pixelsPerUnit`, so `pixel = (world - min) * pixelsPerUnit`. Image x is world x and image y is world
  z (z grows downward); the in-game compass direction has not been checked. Floors are shaded by
  closeness to the height where things spawn, and walls are drawn as lines. Small meshes (trees, pillars and
  other ornaments, under 60 units across) and ground or sky planes larger than the crop are left out. The map is cropped to the spawn area plus a margin and is
  shared by all three difficulties. `coverage` is the share of spawn points on drawn geometry (1.0 for
  all but one stage). `fill` is the share of the image that has geometry: boss arenas, the debug and
  practice stages and two dungeon floors are above 0.97, meaning a flat floor with little to show.

## Not extracted yet

Anything the exporter cannot read is absent or listed in `manifest.knownGaps`, never invented:

- Stage names for `stagIS07`, `stagIS08` and `stagIS20`: system scenes with no banner (`stagIS09` and
  `stagIS10` are the Bandai logo and the opening, from the decomp's loading-screen tour, as is
  `stagML14`, which has no banner image of its own).
- Trader Hall (`dngq5b1e/h/v`) has no map: its rooms are assembled by script at load, so the static
  terrain does not cover its spawn points. Hubs and system scenes have no spawns and no map.
- Room names, doors and icons on the maps; the maps are geometry only.
- Scripted pickups placed by triggers are not extracted; destructibles are (as generators).

## Data quirks

- Three Kokatorimon spawners in `stag0104` reference stat row 90, which is an empty slot in the game
  data. They are exported as found; treat them as inert.
- Dbl Axe, Rage Hammer, Hekatoncheir, Fang Smasher and Meteor Force (ids 100-124) are described as
  "Bash Skill" in game but stored with the Blunt skill index. `skillType` follows the stored value.
- The unique weapons (ids 266-275) display "Skill 1" but store a requirement of 0.
- Three "??????" items (weapon 276, core 31, board 44) are unidentified drops. Per the game, they are
  taken to a Digimon in the central area, which rolls a random weapon, core or board. They are flagged
  `unidentified`, named "Unidentified Weapon/Core/Board", and appear in 66 drop pools. What the roll
  can produce is not extracted.

## Verification

`manifest.source.statTableVerified` is `false` when known anchor values (HP of rows 1, 5, 60, 370)
differ, which means a modified or non-vanilla disc. The opt-in disc test also checks pool totals
and per-difficulty rows against figures documented in the decompilation, and a Hard-difficulty
export matched an independent live capture for all 72 generators of Abyss of Grief (`stag0102`).

## Adding a platform

Write a reader that emits these five files with its own `platform` value. Fields that differ
between versions (for example a drop rate changed on another platform) are separate exports, so
two platforms can be compared by loading both.

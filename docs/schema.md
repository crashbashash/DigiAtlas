# DigiAtlas data schema (v1)

Every platform reader writes the same five files into one folder: the desktop app's import cache
(`<app data>/data/ps2-usa/`, see the README) or, for the command-line importer and the browser dev
mode, `data/generated/<platform>/`. The app only reads this format, so platform differences live in
the readers and never in the UI. JSON Schema files are in [`schema/v1/`](../schema/v1).

`manifest.exporter` names the reader and its version. The desktop app shows a cached import only
when they are `digiatlas-importer` and the version built into the app (`IMPORTER_VERSION`, bumped
whenever the data changes); otherwise it asks for the disc again.

| File | Contents |
|---|---|
| `manifest.json` | Platform, region, serial, frame rate, source fingerprint, counts, and `knownGaps` |
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
  (stored as a pilcrow) is written `X-Data`. The three X-Data rows share one name. Immediate pickups also export `pickup.attribute`
  and `pickup.amount` from the `insItem` database’s `NOURYOKU` and `UP` columns. The interface
  uses these values to distinguish X-Data amounts and permanent stat buffs, preserving the original
  name on the item page and in search. BIT’s pickup amount is determined separately by the game.
- **Enemies** (`enemies.json`): `name` comes from a small curated table (`names/enemies.json`).
  `kind` is `enemy`, `boss`, or `object` (a destructible box, barrel or case). `model` is the engine's
  internal name, kept only for debugging and icon lookup. Each name in the table records its source:
  `disc` names appear in the game's own card album and are checked by the disc test; `wiki` names
  (the Mecha Rogue family and Mecha Rogue X's forms) follow the English Wikipedia and Wikimon, since
  the US disc does not print them; `player` names describe something the game never names (Lucemon's
  orbs); `decomp` names follow the decompilation roster (object names).
- **Forms and boss parts**: optional `form` tells apart rows that share a name (Mecha Rogue X's
  `Form 1`–`Form 3`). `role: "part"` with `partOf` marks a boss's parts and minions (Lucemon's three
  orbs, Mecha Rogue X's summoned Mecha Rogue 04s); viewers list them with that boss rather than as
  enemies of their own. `kind` normally follows the model prefix (`e_` enemy, `f_` boss, `g_` object);
  the names table can override it.
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
- **Boss fights** (`generators[].bossHealthBar`): `true` when the stage's scripts bind the boss health
  bar to this spawner's enemy model (`METERCTRL ... SETMODELHP "<model>/I<n>"`). The game has no other
  boss flag; the app also counts a kill that always gives a key item (a dungeon boss's ID), which covers
  the Vine Tunnel Mecha Rogue 04, the one key-item boss without a bar.
- **Maps** (`stages[].map`, export option `--maps`): a top-down navigation footprint,
  written to `maps/<id>.png` (transparent outside the floor) with its world `bounds` and
  `pixelsPerUnit`, so `pixel = (world - min) * pixelsPerUnit`. Image x is world x and image y is
  world z (z grows downward); the in-game compass direction has not been checked.
  When an unnamed collision scene covers at least 97% of the stage's points of interest,
  its floor triangles are drawn directly, without wall or decorative outlines. A light blue palette
  represents relative height within the floor: higher surfaces are brighter, ramps interpolate
  continuously, and the upper surface wins where floors overlap in the top-down projection.
  Abyss of Grief's known low surface beneath its stepping stones is transparent, so gaps
  match the app background while raised platforms retain their height shading. This is scoped
  to that section and disabled if it would hide a spawn point from a modified disc.
  Candidate scenes are ranked by actual floor coverage, then triangle count; choosing only
  the largest can select an unrelated scene (Electro Mine B4). The full collision floor bounds
  retain empty corridors and dead ends. A one-pixel edge stamp closes raster seams.
  Stages without a suitable collision floor retain the terrain fallback: height shading,
  wall lines, filtering of small props/ground planes and a crop around the points of interest.
  Maps are shared by all difficulties. `coverage` is the share of spawn points actually on
  the rendered map, and `fill` is the share of the image containing drawn pixels.

## Not extracted yet

Anything the exporter cannot read is absent or listed in `manifest.knownGaps`, never invented:

- Stage names for `stagIS07`, `stagIS08` and `stagIS20`: system scenes with no banner (`stagIS09` and
  `stagIS10` are the Bandai logo and the opening, from the decomp's loading-screen tour, as is
  `stagML14`, which has no banner image of its own).
- Trades: `stages[].trades` lists each trader Digimon standing in a shop room: `position` (world x/y/z, the
  same space as spawn points), `facing` (degrees) and `tables`, the offers it uses on each difficulty
  (hand over `give`, get `get`, both `{category, id}` keys into `items.json`). Both come from the stage
  script that places the Digimon (`GENERATE` with a model, an instance number, position and rotation) and
  the per-difficulty trade scripts (`n_<model>_<instance><n|h|v>.lua`) it selects by instance number and
  game difficulty. Trader Hall's three variants differ in who stands there (BK WarGreymon and a second
  Mamemon in the annex only appear in `e` and `v`). The first offer of the Agumon,
  Guilmon, Dorumon and Veemon tables takes an "Offering" (important item 11) for equipment. A Digimon with no table (chatter only) is left out; same-species
  traders are numbered by instance.
- Appraisal: `items.json` `appraisal` says what the Central appraiser turns an unidentified weapon, core or
  board into (300 BIT; the decomp's `beNDMWShopCtrl40` notes). The player's level picks a tier (1: up to
  40, 2: 41-100, 3: 101-200, 4: 201-300, 5: 301-400, 6: 401+); each tier lists results per kind with a
  weight out of 10000 that adds up to 10000, so a roll cannot miss. The tables are `coweapon`, `coarmor1`
  and `coarmor2` in the Central hub's database pack. The game draws 0-9999 and takes the first result whose
  running total reaches it, so the first result of a tier is 0.01 points likelier and the last 0.01 less
  than its weight says; the app shows the weights as they are.
- Stage variants: a trailing `e`, `h` or `v` on a dungeon id is the copy the game enters on Normal, Hard and
  Very Hard. The entrance scripts branch on the game difficulty (0, 1, else) and call `funcStageChange`
  with `<id>e`, `<id>h` or `<id>v` (seen for `dngq4b1`, `dngq5b1` and `dngq2b2`; the app labels every
  variant this way).
- Trader Hall (`dngq5b1e/h/v`) and the Home Server lobbies have no spawners. Their maps are the largest
  terrain scene cropped to the rooms (no markers). System scenes (logo, opening) have no map.
  Stage packs are followed on disc by their own generator packs only; Trader Hall's neighbours' packs
  are not borrowed.
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

## Power calculators

Importer 1.2.0 adds two blocks to `items.json`:

- `powerSpells`: ten `{kind, grade, row, baseFrames}` records from `pcTech` rows 80–89.
- `mpTechs`: one hundred records for all twenty MP Tech families, five grades each.
  Each has `kind`, `grade`, `row`, `skill` (`force`/`blast`/`heal`), `element`, `mpCost`,
  positive damage `power`, `healBase`, `baseFrames`, `criticalRate`, and `boosts`
  (`maxHp`, `strength`, `defense`, `speed`, `hitRate`, `evasion` and the four elements).
  Raise also includes `revive` (`hp`, `experiencePercent`) read from executable tables. Values are read from the disc's `pcTech` table; negative boosts are
  enemy stat reductions. `powerSpells` is retained for existing data consumers.
  `kind` is `up` or `down`; `baseFrames` comes from `TIME`. Convert frames using
`manifest.framesPerSecond`: 50 for European PS2 discs, 60 for USA and Japan.
- `saveStats`: sixteen `shinka` forms with `{species, name, model, wisdomInitial, wisdomGrowth}`,
  plus `wisdomBoards` (armor2 ids whose `SHUSEINOURYOKU` is `KASHIKOSA`). Together with item
  stats these allow a loaded save's Wisdom to be recalculated without shipping game data.

Older desktop caches require re-import. Browser data without these fields still opens, with a
re-import notice in the duration calculator.

## Crown Mod identification

Importer 1.3.0 reads the Crown Mod format-1 metadata footer before importing game data.
`manifest.mod` is the checksummed metadata object for a recognized PS2 or GameCube image, or null
when no marker is present. It includes `id`, `formatVersion`, `version`, `platform`, `release`
and `options`. Unknown/corrupt signature formats are reported rather than guessed.
An unsigned modified image is still read normally; its failed vanilla anchors do not
establish a particular mod version. For signed random-colour builds, enemy rows with the
cosmetic marker 127 carry `crownStyle: "random"`; original `rarity` is retained as raw data.

The format is specified in Crown Mod's `docs/image-signature.md`.

## Weapon calculation inputs

Importer 1.4.0 adds `saveStats.forms[].strengthInitial`/`strengthGrowth` from
`STR_INI`/`STR_GROW`, `saveStats.strengthBoards` (board ids whose main upgrade
attribute is `TSUYOSA`), and `items[].element` for recognized fire, ice, thunder
and dark `ZOKUSEI` strings. These are used to rebuild saved weapon Strength,
critical chance and attack element. See [weapon damage](weapon-damage.md).

Importer 1.5.0 adds optional `saveStats.forms[].speedInitial`/`speedGrowth` from
`DEX_INI`/`DEX_GROW`, plus `saveStats.speedBoards` for sub boards with SUBAYASA as
their main attribute. Attack damage uses them to reconstruct equipped Speed for
the hit-chance roll. These are separate from the saved Strength upgrade counter.

Importer 1.6.0 adds optional `items[].normalHits` (integer 1–16). It is the
verified number of ordinary damage-bearing phases per normal attack input,
resolved from the weapon's sequence mapping and agreeing across all 16 character
models. It is omitted for unverified/projectile profiles. It never multiplies
the item's base stats or the calculator's individual normal/critical hit ranges.

PS2 release metadata is detected from `SYSTEM.CNF` and its matching executable:
`SLUS-20836` → `usa` / 60 fps; `SLES-53405` → `europe` / 50 fps;
`SLPS-25453` → `japan` / 60 fps. `framesPerSecond` is optional for older exports;
the viewer falls back to the region when it is absent.

GameCube manifests use platform `gc`, serial/game ID `GDJEB2` (USA) or `GDJJB2`
(Japan), and 60 frames per second. `source.executableSha1` fingerprints the boot DOL.
The desktop app adds `exporter.appVersion` after a successful import and requires
that version to match the installed app before opening cached data.

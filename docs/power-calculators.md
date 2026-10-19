# Power Up and Power Down

`#/calculators` lists available calculators as clickable tiles, with planned calculators marked
Coming soon. Power Up (`#/calculators/power-up`) shows durations; Power Down
(`#/calculators/power-down`) shows durations and application chance. Both use the shared
character setup: Digimon, level, equipment and XData power determine Wisdom; learned Force
skill is editable. Load a local, read-only PS2 save or choose from the last three opened
saves. Extracted saves are 81,920 bytes (version 4). Memory cards support flat/ECC-less and
ECC-included layouts, with FAT chains followed for fragmented files. The Save character
picker lists used slots from USA, European and Japanese saves. Choosing a form populates its
saved level, skills and XData upgrades. Emulator savestates are not accepted. Equipment is
shared across saved forms; temporary effects are not saved. Character and equipment edits
allow comparison of casting loadouts.

The importer reads spell base frames from `pcTech`; no game table is bundled. For nonnegative
ordinary stat/skill inputs (0–9999):

- Power Up frames = base frames + Wisdom.
- Power Down frames = base frames + floor(Wisdom / 2).
- Seconds = frames / imported frame rate: 50 for Europe, 60 for USA and Japan.
  The formula, explanatory text and base/Wisdom breakdown use the same rate.
- Power Down application uses Force skill F and positive enemy Spirit S:
  A = 550 + floor(F / 4) through 1000;
  A = 800 + floor((F - 1000) / 5) through 2000;
  otherwise A = 1000 + floor((F - 2000) / 10).
  Chance percent = clamp(floor(100 * A / S) / 10, 0, 100).

The application roll is independent of Wisdom and spell grade. Enemy selection uses the chosen
difficulty's stat variants with the same fallback as the enemy page. The row, crown/form, HP and
Spirit distinguish variants. Spirit always comes from the selected enemy. Application is conditional on the
hit and any immunity/script gates; it does not promise every boss accepts the effect.

The formulas and stored-duration behavior are recovered statically from USA PS2 retail code;
live spell timing and board-swap validation remain open. This feature calculates duration and
the application roll, not the buffs' effect magnitudes.

Evidence: the decomp's `docs/systems/combat-damage.md`, `port/docs/player-stats.md`,
`port/docs/save-image.md` and original instructions for GAMERAM `0x003fca10`, status setters
`0x00445d10` and timer update `0x00443bd0`. A standalone Power Up/Down mechanics reference
and worked spreadsheet live in the development workspace's duration-calculator outputs.

Validation: formula boundary/worked-example tests, save checksums and equipment tests, and
opt-in real-disc assertions for all ten base durations, species data and JSON Schema compliance.

## Wisdom plugs and save persistence

Wisdom plugs contribute to the permanent-upgrade counter already read by the calculator.
The retail `insItem` database has Wisdom plug rows 12 (`UP = 1`) and 13 (`UP = 2`),
both with `NOURYOKU = kashikosa`. The actual application routine dispatches on row number:
`beNDMWItemInstant::vfunc_22` (`0x00448ae0`) routes both rows through the table at
`0x0051d6a0` to `0x00448dd0`, selecting upgrade index 4. Instructions at
`0x00448e08..0x00448e68` add `UP` to the player's `UPCNT[4]`, and the following
messenger call requests `RECALCPLAYER`.

`CURRENT2BASE` (`0x003f8760`, matched `src/game/beNDMWGameRam_SaveBase.c` in the decomp)
copies this value into `BASE_UPCNT[species * 11 + 4]`. The save serializer persists
the array at file offset `0xa3c` per character record; `BASE2CURRENT` (`0x003f82a0`,
upgrade loop `0x003f8530..0x003f85bc`) restores the species' eleven values into `UPCNT`.
The stat-growth helper (`0x003fa850`) adds that counter to species/level-derived Wisdom;
equipment bonuses and the final clamp follow during recalculation.

The save therefore holds a combined permanent Wisdom bonus, including both collected plugs
and X-Data upgrades, rather than a separate plug inventory or a final Wisdom total. It does
not distinguish how much came from each source. No calculator arithmetic change is needed.
Save-reader tests cover +1 and +2 increments and isolation between character boxes. This
conclusion comes from retail instructions and disc data, not a new live pickup measurement.

`DIGIATLAS_PS2_CARD` enables the optional real-card test; `DIGIATLAS_TEST_ITEMS` can additionally
point at imported `items.json` to verify box selection and stat derivation with that card.

Regional save/card support recognizes `BASLUS-20836`, `BESLES-53405` and
`BISLPS-25453` directories. Each uses the same 80 KB version-4 mirrored save
layout; checksums, equipment references and stat ranges are still validated.

GameCube saves: GCI files contain an 0x40-byte directory entry and 0x2000-byte
banner/icon block before the 80 KB save. The same four-character layout is read
with big-endian words and UTF-16, and both version-4 mirror checksums are validated.
Complete raw GameCube cards validate header, directory and allocation checksums,
follow fragmented chains, and reject cycles and shared blocks. A single damaged
metadata copy can recover from its valid mirror. Disc support covers USA and Japan.

# MP Tech calculator

`#/calculators/mp-tech` contains all twenty retail MP Tech families and all five grades. The old
`#/calculators/power-up` and `#/calculators/power-down` links open the corresponding
technique in the unified calculator. Character setup stays mounted when switching
techniques or grade: Digimon, level, equipment, XData and all learned skill slots
remain intact. Force uses save skill slot 8, Blast uses slot 6, and Heal uses slot 7. Enemy stats come
only from the existing difficulty and enemy-variant selectors.

The importer reads all five grades of all twenty families from the loaded
disc's `pcTech` table into `items.mpTechs`. No spell tables are bundled. Importer
1.10.0 requires disc data to be reloaded so those fields are available. Both PS2
regions and GameCube releases use the same data schema. MP costs and effect
amounts come from the actual disc, including modified tables.

Friendly techniques have no target panel; results appear beside character setup.
Enemy-targeting techniques show the shared difficulty buttons, enemy picker, variant
picker and relevant read-only stats. The selected technique is named only in its picker. Each result has a formula popover with input
definitions, grade data, rounding/cap rules, function definitions and a live
Current example. Duration calculations use the imported 50/60 FPS value. Help
states only "The loaded game is 50 fps." or "The loaded game is 60 fps."

## Calculation contracts

For ordinary nonnegative Wisdom/skill values (0–9999):

- Pwr Up frames = grade base frames + Wisdom. Each flat stat bonus is its grade
  base + floor(Force / 5). Max HP, Strength and Defense are separate parameters;
  target stat caps can limit their final displayed increase.
- Pwr Down frames = grade base frames + floor(Wisdom / 2). Application uses
  Force-derived A: 550 + floor(F / 4) through 1000, 800 + floor((F − 1000) / 5)
  through 2000, then 1000 + floor((F − 2000) / 10).
  Threshold = floor(100 × A / enemy Spirit); nominal chance is the threshold
  divided by 10%, limited to 0–100%. Each positive stat reduction is the smaller
  of (negative grade change with its sign reversed + floor(Force / 20)) and
  truncate(80 × original enemy stat / 100). Strength and Defense are calculated
  independently. No other temporary enemy effects are assumed.
- Venom poison uses Blast-derived A: 750 + floor(S / 4) through 1000,
  1000 + floor((S − 1000) / 5) through 2000, then
  1200 + floor((S − 2000) / 10). Threshold = truncate(A × (1000 − poison
  resistance) / 1000); chance = threshold / 10%, limited to 0–100%.
  Poison frames = grade base + floor(Wisdom / 2). Poison tick damage =
  truncate(positive technique power / 5), separate from the initial hit.
  Tick cadence and total poison damage are not calculated.
- A damaging Blast technique first computes
  Base = clamp(truncate((20 × power + 10 × Wisdom + 5 × Blast) / enemy Spirit),
  0, 99999), then D = clamp(truncate(Base × (1000 − resistance) / 1000),
  0, 99999). The first cap is **before** resistance. Signed 32-bit elemental
  multiplication and the EE zero-divisor result are retained.
- For an elemental technique, critical chance uses the grade critical rate C, not weapon/chip
  critical stats: K = truncate(10000 / (truncate(12 × resistance / 10) + 50));
  threshold = truncate((C + 100) × K / 100). Chance = threshold / 10%, limited
  to 0–100%. This is separate from the poison application roll.
- Critical damage uses the existing three skill bands (Blast for MP Techs),
  followed by the same retail random spread and final 99,999 cap as weapon
  damage. Direct damage describes one landed hit, not a whole cast or all
  projectiles. MP Techs bypass the weapon accuracy roll; collision and enemy
  script/immunity gates are outside the calculation.

- Non-elemental Impact and Cutter use their technique critical rate directly as a
  percentage, with a 0–99 strict-less-than roll. No resistance scaling applies.
- Heal Lt and Aura restore grade base HP + caster Wisdom + caster Heal skill,
  up to each affected Digimon's missing HP. Aura applies the same computed amount
  to each nearby ally and the caster.
- Speed's duration is base frames + Wisdom. Its Speed bonus is the grade Speed
  value + floor(Force / 5); critical, hit and evasion rate changes are grade values.
- Freeze, Sleep and Bind use the same Force-versus-Spirit application bands and
  half-Wisdom duration rule as Pwr Down. Freeze's Speed reduction is the grade
  reduction + floor(Force / 20), limited to truncate(80% of original enemy Speed).
  Its other rate reductions are the grade values directly.
- Resist uses its base duration **without** Wisdom, and its four resistance
  bonuses directly from the selected grade. Force adds no extra bonus.
- Cure Lt and Cure remove poison using roll 0–9 <= (grade index + 5 − poison
  strength). Chance = clamp((grade index + 6 − poison strength) × 10, 0, 100).
  The UI shows all poison strengths 0–9 and the 10+ zero-chance category instead
  of inventing a live poison state that is absent from saves.
- Raise's HP and recovered EXP percentage come from adjacent arrays in the
  executable, not the unused pcTech HP values. The importer identifies the
  recovery arrays and uses the correct PS2 alignment / GameCube byte order.
  `beNDMWMdlPlayer2::vfunc_47`, `0x003d5438..0x003d5750`, reads the flat HP
  amount and adds truncate(Backup Chip EXP × recovery percent / 100) to current
  EXP. Both arrays are validated on all five supported discs. Wisdom and Heal
  skill do not change these selected-grade entries.

The application/critical rolls compare an integer in 0–999 **strictly below**
the threshold. All displayed Current examples use current inputs and the same
result functions as the cards. Invalid inputs show guidance rather than NaN.

Evidence: retail USA PS2 GAMERAM `0x003fca10` / FightCom cases 1, 2, 5, 15,
19 and 20; original instructions for P2EPOISONTIME `0x003ffef0..0x004003a0`;
`src/lua/combat.c`'s matched poison helper; status setters at `0x00445d10` and
stored-duration updater at `0x00443bd0`. The decomp's
`docs/systems/combat-damage.md` describes the direct technique branch;
`docs/systems/combat-lua-api.md` records the status helper guards. These are
static recovery contracts; no new live spell measurement is claimed.

Validation covers all skill-band boundaries, distinct poison rolls/damage/duration,
critical/resistance calculations, damage caps, invalid inputs and Pwr Down's
80% limit. The optional real-disc region test imports all supported discs,
checks all 100 technique records and validates the complete JSON schemas.

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

### Calculator shortcuts

Character setup offers **Equipment minimum** for level, **Weapon minimum** for the
active weapon skill, and **Maximum at this level** for the displayed weapon or MP
skill. Each action changes only its own input. Level uses the highest exported
`equipLevel` among equipped items; weapon skill uses `requiredSkill` independently.
Unmet equipment requirements and skills above the trainable cap are shown without
silently changing a loaded or manually entered setup.

The shared trainable cap is `30*level` through level 36, `360+20*level` through 107,
`1430+10*level` through 227, then `1884+8*level`. Verified in USA PS2 retail
instructions at `0x3ff268–0x3ff2c8` (skill growth gate, compared at `0x3ff410`,
followed by an increment of one at `0x3ff638`) and `0x41f92c–0x41f98c` (skill display).
The formula also agrees with the independent GameCube analysis in
[Mateon1’s TASVideos research](https://tasvideos.org/Forum/Posts/User/Mateon1).
This is a training limit, so manual entry and save loading remain available above it.

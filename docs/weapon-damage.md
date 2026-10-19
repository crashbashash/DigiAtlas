# Attack damage calculator

`#/calculators/attack-damage` (old weapon-damage links remain supported) calculates
weapon attack hit chance, normal/critical damage ranges, elemental bonus rolls,
average damage per landed hit, and average per normal attack input including misses.
The home card and calculator index link to it.

Character Strength and Speed are derived from Digimon, level, XData power and
equipment. Learned weapon skill is editable; accuracy, critical chance and attack
element come from equipment. Target stats always come from the enemy list and
selected variant. Defense, Speed and all four elemental resistances are shown
as read-only values, with the active medal’s resistance highlighted. An elemental
PWR result shows bonus chance and extra damage; all ranges and averages include it.
Enemy selection uses exact stat variants on the selected difficulty; View spawns
lists only that row. Imported enemy stats assume no temporary defense/Speed debuff.
The hit roll assumes attack geometry reaches the target. Move-specific script
multipliers are not included.

Save/card loading uses the existing checksummed, mirrored USA PS2 save reader.
Strength is recalculated using species/level growth, BASE_UPCNT[species*11+2]
(permanent upgrades, including Strength plugs), the first weapon's Strength and
revision, equipped weapon-pocket chips, and the board's Strength plus its revision
only when SHUSEINOURYOKU is TSUYOSA. Core and armor-pocket Strength values are not
applied: retail's field-specific consumers exclude them. The base stat is capped
before equipment; the final stat clamps to 1–9999, matching the recovered calculator.
Only equipment references contribute; inventory, bank and spare weapon sockets do
not. The equipment editor uses Weapon, Core and Sub board tabs and offers all
identified weapons, cores, sub boards and compatible chips, regardless of whether
their stats affect the calculator. Rarity can be selected for each equipment type.
Weapon chips can contribute Strength, critical rate, element and Speed. Core
chips and cores contribute Speed to attack calculations. Sub boards can contribute
Strength and Speed; rarity adds to the matching main attribute. The full saved
loadout stays intact when switching tabs or changing another slot.

Speed is reconstructed from DEX_INI/DEX_GROW, BASE_UPCNT[species*11+6], all five
equipped groups' Speed attributes and matching sub-board rarity. It clamps to
1–9999 after equipment. Weapon accuracy is MEICHURITSU from the first equipped
weapon alone, zero when no weapon is equipped.

Rarity colours cover bonus ranges (white 0, blue 1–15, green 16–127, yellow
128–511, orange 512–1023, pink 1024–2047). Loaded saves retain the exact bonus;
new colour selections use that band's minimum. Swaps recalculate Strength,
critical chance and element; the weapon determines the skill type and selects
the saved Digimon's corresponding skill counter. With no saved Digimon, skill
level stays manual. Strength without equipment is editable in the popover;
the main Strength and Speed fields accept totals directly while preserving the
selected equipment. Attack element is derived from the equipped elemental PWR chip. Only one
elemental PWR chip can occupy the weapon pockets; Resist chips are excluded from
weapon pockets using the imported AB-only restriction. Critical chance is always derived from the current weapon
and weapon chips; it has no editable input. Skill controls the critical damage
bonus rather than the critical chance.
Equipment changes never write the save. The weapon chip picker excludes AB-only chips using imported equip descriptions.
Material Symbols accompany elemental chip names; they are bundled locally with
their license in public/third-party/material-symbols.


Saved critical chance is the first weapon and equipped weapon-pocket CHIMEIRITSU
sum, minimum one, capped to a 100% roll chance: raw / 200. Temporary UPDATA/DOWNDATA
are not stored. Attack element is the first recognized fire/ice/thunder/dark entry
in equipped weapon-pocket chips. Equipment skill type follows the stored weapon
SKILL value, including the known Bash/Blunt description mismatch.

## Hit chance

FIGHTCALC case 1, `P2EISHITCHECK` (`0x003fdeb8..0x003fe130`), uses a roll
from 0 to 9999. A weapon attack succeeds when the roll is below:

`truncate(weaponAccuracy * (30*Speed + 20*weaponSkill + 6000) / enemySpeed)`

The chance is the threshold divided by 100 percent, clamped to 0–100%. The
multiply preserves signed 32-bit wrapping. EE signed DIV by zero returns -1 for
a nonnegative numerator, so ordinary zero-Speed targets have zero roll chance.
Retail uses `truncate(enemySpeed * (100 - target.DOWNDATA[3]) / 100)` as effective
Speed; default enemy rows use DOWNDATA[3] = 0, while manual inputs can supply an
effective Speed. Techniques take a separate always-hit branch and are outside
this calculator. The ordinary critical and elemental rolls follow separately.

Average per attack = average per landed hit * hit chance / 100. This excludes
geometry misses and move-specific scripts, as does the standalone accuracy roll.

## Retail calculation order

Source of truth: the now-matched decomp callback
`src/unmatched/Gap__Bec__beNDMWGameRam__vfunc_34.cpp`, FIGHTCALC case 5, and
retail instructions `0x003fe550..0x003ff030`. The earlier combat-damage prose is
incomplete for elemental **weapons**; the technique branch has different rules.

1. Base = truncate((6 * Strength + 4 * weapon skill) / effective defense), clamp
   to 0–99999. Retail reads `_downDataList[5]` from the supplied InfoWork object
   and subtracts it from database MAMORI. The default calculator uses zero for
   this transient reduction; it is not inferred from a save. EE DIV by zero with
   this nonnegative numerator produces -1, then the clamp produces zero.
2. For an elemental weapon only, draw a roll 0–999. When resistance R is
   **strictly less** than that roll, add truncate(base * (1000 - R) / 1000).
   Nominal proc chance is clamp((999 - R) / 1000, 0, 1). This adds a probabilistic
   bonus; it does not always multiply physical damage by a resistance factor.
3. Clamp again to 0–99999.
4. On a critical, add truncate(damage * bonusPercent / 100), using skill S:
   S<=1000: truncate(S/20)+30; S<=2000: truncate((S-1000)/50)+80;
   otherwise truncate((S-2000)/100)+100.
5. Random spread: choose a band 950/975/1000/1025 and integer r in [0,25*damage),
   then truncate((band*damage+r)/1000). Clamp to 0–99999.

The four equally likely bands concatenate into a uniform integer interval
[950*damage,1050*damage). Exact sums of truncated, capped outcomes produce the
reported conditional means without sampling or enumerating millions of rolls.
The final mean weights those means by elemental and critical chance, assuming
nominal uniform RNG draws. Ranges include all outcomes of any nonzero-probability
branch, so a rare non-proc can widen the elemental weapon range.

Arithmetic preserves the retail signed-word product for unusual negative
resistances. Ordinary Strength/skill inputs are restricted to 0–9999. Critical
chance inputs are percentages; imported CHIMEIRITSU is converted on save load.

## Export and verification

Importer 1.4.0 added shinka STR_INI/STR_GROW as strengthInitial/strengthGrowth in
saveStats forms, strengthBoards (armor2 main-attribute matches), and recognized
item element strings. Importer 1.5.0 adds DEX_INI/DEX_GROW as speedInitial/speedGrowth
and speedBoards. Desktop caches require re-import. No game table is bundled.

Tests cover physical/critical examples, all critical-band boundaries, strict
resistance thresholds, independent enumeration of spread/capping outcomes,
zero defense/damage, and saved equipment reference/field ownership. The shared
save/card tests continue to validate checksums, mirrored blocks and box isolation.
The per-hit calculation and static normal-melee profiles are covered; this does
not constitute a new live combat or charged/combo-move validation.

## Normal multi-hit attacks

Importer 1.6.0 exports `items[].normalHits` for verified normal melee attacks.
It reads each weapon model's actual `beWeaponSeqData` entry for `SQ_ATCK1`, then
counts damage-bearing actions before the `Atck01` wait in all sixteen playable
character packs. Only counts that agree across all sixteen forms are exported.
The initial kind-60000 talk/contact probe is excluded, as are overlapping shapes
within one damage phase. Missing, nonstandard, incomplete and projectile-only
branches are left unknown rather than assigned a guessed count.

Normal hit, critical hit and average per hit remain per-hit results. Accuracy and
critical chance tiles also apply per hit. Average per attack is
`normalHits * hitChance/100 * averagePerLandedHit`, without capping the sum to the
per-hit 99,999 damage limit. For a weapon without a verified profile (or manual
stats without a selected weapon), the last tile is labelled **Average per hit
attempt** instead. Charged/combo and projectile totals are not inferred from a
normal melee profile.

Static analysis established these cases:

- Dbl Rapier rows 150–154 all load `w_saber01` (NDMW entry 958). Its
  `beWeaponSeqData` for `SQ_ATCK1` explicitly selects the `saber` label. Its charged
  and other sequences select `dual`; the model name alone is not the dispatch rule.
- Crush Arm row 274 loads `w_common03` (NDMW entry 913). Its `SQ_ATCK1` selects `arm`.
- All sixteen playable character packs (NDMW entries 849–864) have two distinct
  damage-bearing actions in each of those normal branches, before the `Atck01`
  input wait. Saber uses `VATCR1`/`VATCR2`; arm uses `VATCA2`/`VATCA3`. Every hitbox
  in those phases has ordinary attack kind 10000. Overlapping hitboxes within one
  action represent geometry coverage, not a hit multiplier.
- The standard enemy hit callback (NDMW entry 179, Lua chunk offset 0x192160)
  calls `BLTisHitCheck` at bytecode PCs 10–12; on success it calls `BLTisCritical`
  at 20–22 and passes that result to `BLTgetDamageValue` at 23–26. These locals
  are computed on every invocation. The existing text decompiler drops the
  critical/damage local declarations; the original bytecode is authoritative.
- Matched wrappers `src/lua/combat.c` / `src/lua/api.c` dispatch those calls to
  FIGHTCALC cases 1, 2 and 5. The recovered dispatcher draws new RNG values for
  accuracy, critical, applicable elemental bonus and spread on each call.
  Attack kind 10000 uses the ordinary weapon-damage branch, with no phase-based
  half-damage or other extra multiplier.

The user independently confirmed that both hits can damage the same enemy.
Combined with the static path, these should be modelled as two ordinary hit
attempts, each with its own roll sequence. For fixed stats and a target that
remains available for both phases, their expected damage is the sum of the two
per-hit expectations. Separate RNG calls do not by themselves prove statistical
independence of the PRNG.

The normal melee phase audit also found `dual` and `maul` have two damage-bearing
actions; `slash`, `axe` and `dagger` have one, consistently across all sixteen
forms. Each weapon's actual `beWeaponSeqData` label must be read before applying
these profiles. Gun/projectile and charged/combo behavior still require their own
analysis; this is not a claim of complete attack coverage. The hitbox scheduler
helpers are `FUN_00394fa0` (HITBOX command), `FUN_0039a500` (schedule a box) and
`0x003993e0` (active-box dispatch). Diagnostic translations were inspected without
modifying or claiming newly matched decompilation code.

## Picker UI

Equipment, chips, rarity, save boxes, Digimon, weapon skills, targets, enemy
variants and player counts use the shared `SearchPicker`. Long lists provide a
text filter; short lists retain the same menu styling. Arrow keys navigate
options, buttons support ordinary keyboard activation, and Escape/light-dismiss
use the browser popover behavior. Selection always calls the existing state
handlers, including the one-PWR-element restriction and equipped weapon's skill.

The chip picker offers all identified, equippable chips regardless of whether their
stats affect this calculator. Weapon/core restrictions and the one-elemental-PWR
rule still apply.

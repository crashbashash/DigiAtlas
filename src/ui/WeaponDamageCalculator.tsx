import { useMemo, useState } from 'preact/hooks';
import { routes } from '../app/route';
import { attackHitChance } from '../data/attack-hit';
import { readPowerBoxes, type SaveBox } from '../data/power-save-file';
import type { SavedDigimon } from '../data/power-save';
import { emptyEquipment, equipmentStats, type WeaponEquipment } from '../data/weapon-equipment';
import { SearchPicker } from './SearchPicker';
import { WeaponEquipmentEditor } from './WeaponEquipmentEditor';
import {
  ELEMENTS,
  WEAPON_SKILLS,
  weaponDamage,
  averageAttackDamage,
  type DamageRange,
} from '../data/weapon-damage';
import { Link, SettingsBar } from './common';
import { useApp } from './context';
import { FormulaHelp } from './FormulaHelp';
import { VariantSpawns } from './VariantSpawns';
import { variantLabel } from './pieces';

const number = (s: string) => (s.trim() ? Number(s) : NaN);
const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
const rangeText = (r: DamageRange | undefined) =>
  !r ? '—' : r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;

export function WeaponDamageCalculator() {
  const { model, settings, scope } = useApp();
  const [strength, setStrength] = useState('2000');
  const [skill, setSkill] = useState('1500');
  const [speed, setSpeed] = useState('1000');
  const [accuracy, setAccuracy] = useState('78');
  const [enemySpeed, setEnemySpeed] = useState('128');
  const [baseSpeed, setBaseSpeed] = useState(1000);
  const [skillType, setSkillType] = useState(0);
  const [defense, setDefense] = useState('128');
  const [resistance, setResistance] = useState('500');
  const [name, setName] = useState('');
  const [row, setRow] = useState(-1);
  const [boxes, setBoxes] = useState<SaveBox[]>([]);
  const [box, setBox] = useState('');
  const [character, setCharacter] = useState('');
  const [loaded, setLoaded] = useState<SavedDigimon | null>(null);
  const [error, setError] = useState('');
  const [equipment, setEquipment] = useState<WeaponEquipment | null>(null);
  const [baseStrength, setBaseStrength] = useState(2000);
  const { critChance, element } = equipmentStats(
    0,
    equipment ?? emptyEquipment(),
    model.items,
    model.raw.items.saveStats,
  );
  const saved = boxes.find((b) => b.id === box)?.digimon ?? [];
  const names = useMemo(
    () =>
      [
        ...new Set(
          [...model.enemies.values()].filter((e) => e.kind !== 'object').map((e) => e.name),
        ),
      ].sort(),
    [model],
  );
  const variants = name ? model.variantsOn(name, settings.difficulty, scope) : [];
  const target = variants.find((e) => e.row === row) ?? variants[0];
  const effectiveDefense = name ? (target?.stats.defense ?? NaN) : number(defense);
  const effectiveResist =
    element === 'none' ? 0 : name ? (target?.resist[element] ?? NaN) : number(resistance);
  const effectiveSpeed = name ? (target?.stats.speed ?? NaN) : number(enemySpeed);
  const hitChance = attackHitChance(number(speed), number(skill), number(accuracy), effectiveSpeed);
  const result = weaponDamage({
    strength: number(strength),
    skill: number(skill),
    defense: effectiveDefense,
    critChance,
    element,
    resistance: effectiveResist,
  });
  const normalHits = equipment?.weapon
    ? model.items.get(equipment.weapon.key)?.normalHits
    : undefined;
  const attackAverage =
    result && hitChance !== null
      ? averageAttackDamage(result.average, hitChance, normalHits ?? 1)
      : null;
  const manual = () => {
    setCharacter('');
    setLoaded(null);
    setEquipment(null);
  };
  function selectDigimon(d: SavedDigimon, index: string) {
    if (d.strength === undefined || d.speed === undefined) {
      setError('Re-import your disc to load attack stats.');
      return;
    }
    setLoaded(d);
    setSpeed(String(d.speed));
    setBaseSpeed(d.baseSpeed ?? d.speed);
    setAccuracy(String(d.hitRate));
    setEquipment(d.equipment);
    setBaseStrength(d.baseStrength ?? d.strength);
    setCharacter(index);
    setStrength(String(d.strength));
    setSkillType(d.weaponSkill);
    setSkill(String(d.skills[d.weaponSkill]));
  }
  function changeEquipment(base: number, gear: WeaponEquipment, speedBase: number) {
    const next = equipmentStats(base, gear, model.items, model.raw.items.saveStats, speedBase);
    setEquipment(gear);
    setSpeed(String(next.speed));
    setBaseSpeed(speedBase);
    setAccuracy(String(next.hitRate));
    setBaseStrength(base);
    setStrength(String(next.strength));
    setSkillType(next.weaponSkill);
    if (loaded && (next.weaponSkill !== skillType || gear.weapon?.key !== equipment?.weapon?.key))
      setSkill(String(loaded.skills[next.weaponSkill]));
  }
  function chooseBox(id: string, list = boxes) {
    const b = list.find((b) => b.id === id);
    if (!b) return;
    setBox(id);
    selectDigimon(b.digimon[0], '0');
  }
  async function loadSave(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const stats = model.raw.items.saveStats;
      if (
        !stats?.strengthBoards ||
        !stats.speedBoards ||
        stats.forms.some(
          (f) =>
            f.strengthInitial === undefined ||
            f.strengthGrowth === undefined ||
            f.speedInitial === undefined ||
            f.speedGrowth === undefined,
        )
      )
        throw Error('Re-import your disc to load attack stats.');
      const list = readPowerBoxes(await file.arrayBuffer(), stats, model.items);
      setBoxes(list);
      chooseBox(list[0].id, list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div class="page power-page weapon-damage-page">
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          <Link to={routes.calculators()}>Calculators</Link>
        </nav>
        <h1>Attack damage</h1>
        <p class="muted">Calculate damage for your character and equipment.</p>
      </header>
      <div class="power-grid">
        <section class="section-card">
          <h2>Your character</h2>
          <details class="attack-save-loader">
            <summary>Load a save</summary>
            <label class="power-field">
              Save file
              <input
                type="file"
                onChange={(e) => {
                  void loadSave(e.currentTarget.files?.[0]);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            {boxes.length > 0 && (
              <SearchPicker
                label="Save box"
                value={box}
                searchLabel={boxes.length > 8 ? 'Search saves' : undefined}
                onChange={chooseBox}
                options={boxes.map((b) => ({ value: b.id, label: b.label }))}
              />
            )}
            {saved.length > 0 && (
              <SearchPicker
                label="Digimon"
                value={character}
                searchLabel="Search Digimon"
                onChange={(value) =>
                  value === '' ? manual() : selectDigimon(saved[Number(value)], value)
                }
                options={[
                  { value: '', label: 'Manual stats' },
                  ...saved.map((d, i) => ({
                    value: String(i),
                    label: `${d.name} · Lv ${d.level}`,
                  })),
                ]}
              />
            )}
          </details>
          <div class="equipment-summary">
            {equipment && (
              <p class="muted">
                Weapon:{' '}
                {equipment.weapon ? (
                  <Link to={routes.item(equipment.weapon.key)}>
                    {model.itemLabel(equipment.weapon.key)}
                  </Link>
                ) : (
                  'None'
                )}
              </p>
            )}
            {equipment && (
              <p class="equipment-chip-summary muted">
                {equipment.weaponChips.filter(Boolean).length} weapon chips
                {equipment.subBoard ? ` · ${model.itemLabel(equipment.subBoard.key)}` : ''}
              </p>
            )}
            <WeaponEquipmentEditor
              equipment={equipment ?? emptyEquipment()}
              baseStrength={
                equipment ? baseStrength : Number.isFinite(number(strength)) ? number(strength) : 0
              }
              baseSpeed={equipment ? baseSpeed : Number.isFinite(number(speed)) ? number(speed) : 0}
              onChange={changeEquipment}
            />
          </div>
          <div class="power-inputs">
            <label class="power-field">
              Strength
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={strength}
                onInput={(e) => {
                  setStrength(e.currentTarget.value);
                }}
              />
            </label>
            <label class="power-field">
              Speed
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={speed}
                onInput={(e) => {
                  setSpeed(e.currentTarget.value);
                }}
              />
            </label>
            <label class="power-field">
              Weapon accuracy
              <input
                type="number"
                min="0"
                max="32767"
                step="1"
                value={accuracy}
                onInput={(e) => setAccuracy(e.currentTarget.value)}
              />
            </label>
            <SearchPicker
              label="Weapon skill"
              value={String(skillType)}
              disabled={!!equipment?.weapon}
              onChange={(value) => {
                const n = Number(value);
                setSkillType(n);
                if (loaded) setSkill(String(loaded.skills[n]));
              }}
              options={WEAPON_SKILLS.map((label, i) => ({ value: String(i), label }))}
            />
            <label class="power-field">
              Skill level
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={skill}
                onInput={(e) => {
                  setSkill(e.currentTarget.value);
                }}
              />
            </label>
          </div>
          <p class="muted">
            Attack element:{' '}
            <strong class="attack-element">
              {ELEMENTS.find((e) => e.value === element)!.label}
            </strong>
          </p>
        </section>
        <section class="section-card">
          <h2>Target enemy</h2>
          <SettingsBar players={false} />
          <SearchPicker
            label="Target enemy"
            value={name}
            searchLabel="Search enemies"
            onChange={(value) => {
              setName(value);
              setRow(-1);
            }}
            options={[
              { value: '', label: 'Enter stats manually' },
              ...names.map((n) => ({ value: n, label: n })),
            ]}
          />
          {name ? (
            <>
              <SearchPicker
                label="Enemy variant"
                value={String(target?.row ?? -1)}
                searchLabel="Search variants"
                onChange={(value) => setRow(Number(value))}
                options={variants.map((e) => ({
                  value: String(e.row),
                  label: `${variantLabel(e)} · HP ${fmt(e.hp)} · Defense ${fmt(e.stats.defense)} · Speed ${fmt(e.stats.speed)}${element !== 'none' ? ` · ${ELEMENTS.find((x) => x.value === element)!.label} ${e.resist[element]}` : ''}`,
                }))}
              />
              <div class="power-target-links">
                <Link to={routes.enemy(name)}>View {name}</Link>
                {target && (
                  <VariantSpawns key={`${target.row}:${settings.difficulty}`} enemy={target} />
                )}
              </div>
            </>
          ) : (
            <>
              <label class="power-field">
                Enemy defense
                <input
                  type="number"
                  min="0"
                  max="32767"
                  step="1"
                  value={defense}
                  onInput={(e) => setDefense(e.currentTarget.value)}
                />
              </label>
              <label class="power-field">
                Enemy Speed
                <input
                  type="number"
                  min="0"
                  max="32767"
                  step="1"
                  value={enemySpeed}
                  onInput={(e) => setEnemySpeed(e.currentTarget.value)}
                />
              </label>
              {element !== 'none' && (
                <label class="power-field">
                  Element resistance
                  <input
                    type="number"
                    min="-32768"
                    max="32767"
                    step="1"
                    value={resistance}
                    onInput={(e) => setResistance(e.currentTarget.value)}
                  />
                </label>
              )}
            </>
          )}
          {element !== 'none' && result && (
            <p class="muted">Elemental bonus chance: {fmt(result.elementChance, 1)}%</p>
          )}
          {(!result || hitChance === null) && (
            <p role="alert">
              Enter whole-number Strength, Speed and skill from 0 to 9999, and valid accuracy and
              enemy stats.
            </p>
          )}
        </section>
      </div>
      <div class="formula-heading">
        <h2>Damage</h2>
        <FormulaHelp title="Attack damage formula">
          <p class="formula-equation">Base = floor((6 × Strength + 4 × Weapon skill) / Defense)</p>
          <p>
            Strength is your total with equipped gear. Defense is the enemy’s effective defense.
            Values are rounded down for ordinary positive stats.
          </p>
          <p>
            Critical chance is calculated from your equipped weapon and weapon chips: their
            critical-rate total divided by 2 gives the percentage, with a minimum of 0.5% and a
            maximum of 100%.
          </p>
          <p>
            Normal and critical damage ranges describe one landed hit. Average per attack includes
            all verified hit attempts for a normal attack input, each with its own accuracy,
            critical, elemental and spread rolls. Chances shown apply per hit.
          </p>
          <p>Critical hits add a skill-based bonus:</p>
          <table class="formula-bands">
            <thead>
              <tr>
                <th scope="col">Weapon skill S</th>
                <th scope="col">Bonus (%)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>0–1000</td>
                <td>floor(S / 20) + 30</td>
              </tr>
              <tr>
                <td>1001–2000</td>
                <td>floor((S − 1000) / 50) + 80</td>
              </tr>
              <tr>
                <td>2001+</td>
                <td>floor((S − 2000) / 100) + 100</td>
              </tr>
            </tbody>
          </table>
          <p>
            Damage varies from 95% to just under 105%, rounded down. Damage is capped at 99,999.
          </p>
          <p>
            For an elemental weapon, let R be the target’s resistance. The bonus triggers when a
            roll from 0 to 999 is greater than R. It adds floor(Base × (1000 − R) / 1000) before the
            critical bonus and random spread.
          </p>
          <p class="muted">
            The average accounts for critical and elemental chances, integer rounding and the damage
            cap, assuming uniform random rolls. Attack totals assume the target remains in reach and
            survives all hits. Charged/combo script multipliers are not included. Hit chance uses
            the game’s accuracy roll and assumes the attack reaches the target. Saved stats include
            permanent upgrades and equipped gear; temporary combat effects are not stored.
          </p>
        </FormulaHelp>
      </div>
      <div class="damage-results">
        <section class="section-card">
          <h2>Normal hit</h2>
          <p class="power-result">{rangeText(result?.normal)}</p>
        </section>
        <section class="section-card">
          <h2>Critical hit</h2>
          <p class="power-result">{rangeText(result?.critical)}</p>
        </section>
        <section class="section-card">
          <div class="formula-heading">
            <h2>Hit chance</h2>
            <FormulaHelp title="Hit chance formula">
              <p class="formula-equation">
                Threshold = truncate(Accuracy × (30 × Speed + 20 × Weapon skill + 6000) / Enemy
                Speed)
              </p>
              <p>
                A roll from 0 to 9999 must be below the threshold. Chance = threshold / 100%,
                limited to 0–100%. Each division rounds towards zero.
              </p>
              <p>
                Accuracy is the weapon’s hit-rate stat. Enemy Speed uses the selected variant,
                without temporary debuffs. This roll assumes the attack reaches the enemy.
              </p>
            </FormulaHelp>
          </div>
          <p class="power-result">{hitChance === null ? '—' : `${fmt(hitChance, 2)}%`}</p>
          <small class="muted">Per hit</small>
        </section>
        <section class="section-card">
          <h2>Critical chance</h2>
          <p class="power-result">{`${fmt(critChance, 1)}%`}</p>
          <small class="muted">Per hit</small>
        </section>
        <section class="section-card">
          <h2>Average per hit</h2>
          <p class="power-result">{result ? fmt(result.average, 1) : '—'}</p>
          <small class="muted">With {fmt(critChance, 1)}% critical chance</small>
        </section>
        <section class="section-card">
          <h2>{normalHits ? 'Average per attack' : 'Average per hit attempt'}</h2>
          <p class="power-result">{attackAverage === null ? '—' : fmt(attackAverage, 1)}</p>
          <small class="muted">
            {normalHits
              ? `${normalHits} hit ${normalHits === 1 ? 'attempt' : 'attempts'} · Including misses`
              : 'Including misses'}
          </small>
        </section>
      </div>
    </div>
  );
}

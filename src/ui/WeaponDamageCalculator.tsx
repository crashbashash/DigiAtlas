import { useMemo, useState } from 'preact/hooks';
import { routes } from '../app/route';
import { attackHitChance } from '../data/attack-hit';
import { CharacterSetup, type CharacterValues } from './CharacterSetup';
import { emptyEquipment } from '../data/weapon-equipment';
import { SearchPicker } from './SearchPicker';
import {
  ELEMENTS,
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
  const [character, setCharacter] = useState<CharacterValues | null>(null);
  const strength = String(character?.strength ?? NaN);
  const speed = String(character?.speed ?? NaN);
  const skill = String(character?.skill ?? NaN);
  const accuracy = String(character?.hitRate ?? NaN);
  const equipment = character?.equipment ?? emptyEquipment();
  const critChance = character?.critChance ?? 0.5;
  const element = character?.element ?? 'none';
  const [selectedName, setName] = useState('');
  const [row, setRow] = useState(-1);
  const names = useMemo(
    () =>
      [
        ...new Set(
          [...model.enemies.values()].filter((e) => e.kind !== 'object').map((e) => e.name),
        ),
      ].sort(),
    [model],
  );
  const name = selectedName || names[0] || '';
  const variants = name ? model.variantsOn(name, settings.difficulty, scope) : [];
  const target = variants.find((e) => e.row === row) ?? variants[0];
  const effectiveDefense = target?.stats.defense ?? NaN;
  const effectiveResist = element === 'none' ? 0 : (target?.resist[element] ?? NaN);
  const effectiveSpeed = target?.stats.speed ?? NaN;
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
  const currentInputs = (
    <p>
      Strength {strength} · Weapon skill {skill} · Enemy Defense {effectiveDefense}
    </p>
  );
  const unavailableExample = (
    <p>Choose valid character stats and an enemy to see the current example.</p>
  );
  const baseExample = result && (
    <>
      {currentInputs}
      <p class="formula-equation">
        {effectiveDefense === 0
          ? 'Enemy Defense is 0: the retail division result is clamped to 0 base damage.'
          : `Base = clamp(truncate((6 × ${strength} + 4 × ${skill}) / ${effectiveDefense}), 0, 99999) = ${fmt(result.base)}`}
      </p>
    </>
  );
  const criticalRate = [equipment.weapon, ...equipment.weaponChips].reduce(
    (sum, entry) => sum + (entry ? (model.items.get(entry.key)?.stats?.critRate ?? 0) : 0),
    0,
  );
  const criticalBonusExample =
    number(skill) <= 1000
      ? `truncate(${skill} / 20) + 30`
      : number(skill) <= 2000
        ? `truncate((${skill} − 1000) / 50) + 80`
        : `truncate((${skill} − 2000) / 100) + 100`;
  const hitProduct = Math.imul(number(accuracy), 30 * number(speed) + 20 * number(skill) + 6000);
  const hitThreshold =
    effectiveSpeed === 0 ? (hitProduct < 0 ? 1 : -1) : Math.trunc(hitProduct / effectiveSpeed) | 0;
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
          <CharacterSetup attack onChange={setCharacter} />
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
            options={names.map((n) => ({ value: n, label: n }))}
          />
          {name && (
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
          )}
          {target ? (
            <dl class="target-stat-summary">
              <div>
                <dt>Defense</dt>
                <dd>{fmt(target.stats.defense)}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>{fmt(target.stats.speed)}</dd>
              </div>
              {(['fire', 'ice', 'thunder', 'dark'] as const).map((key) => (
                <div key={key} class={element === key ? 'active-resistance' : undefined}>
                  <dt>
                    {ELEMENTS.find((e) => e.value === key)!.label} resistance
                    {element === key ? ' · Active' : ''}
                  </dt>
                  <dd>{fmt(target.resist[key])}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p role="status">No enemy variants are available for these settings.</p>
          )}
          {(!result || hitChance === null) && (
            <p role="alert">
              Choose an enemy variant and equipment, and use whole-number character stats and skill
              from 0 to 9999.
            </p>
          )}
        </section>
      </div>
      <h2>Damage</h2>
      <div class="damage-results">
        <section class="section-card">
          <div class="formula-heading">
            <h2>Elemental bonus</h2>
            <FormulaHelp
              title="Elemental PWR medal damage"
              terms={['truncate', 'clamp']}
              example={
                result ? (
                  element === 'none' ? (
                    <p>
                      Your current loadout has no elemental PWR medal: extra damage and trigger
                      chance are both 0.
                    </p>
                  ) : (
                    <>
                      {baseExample}
                      <p>
                        {ELEMENTS.find((e) => e.value === element)!.label} resistance R ={' '}
                        {effectiveResist}
                      </p>
                      <p class="formula-equation">
                        Bonus chance = clamp((999 − {effectiveResist}) / 10, 0, 100) ={' '}
                        {fmt(result.elementChance, 1)}%<br />
                        Extra before cap = truncate({fmt(result.base)} × (1000 − {effectiveResist})
                        / 1000) ={' '}
                        {fmt(Math.trunc(Math.imul(result.base, 1000 - effectiveResist) / 1000))}
                      </p>
                      <p>
                        {result.elementChance === 0
                          ? 'The medal cannot trigger against this resistance, so its applied bonus is 0.'
                          : `After the 99,999 damage cap, the applied bonus is +${fmt(result.elementBonus)} when the medal triggers.`}
                      </p>
                    </>
                  )
                ) : (
                  unavailableExample
                )
              }
            >
              <p>
                Your PWR medal gives each landed hit a chance to deal extra damage. Higher enemy
                resistance lowers both the chance and the bonus.
              </p>
              <p>
                Base is the weapon hit’s damage before elemental bonuses, criticals and random
                variation.
              </p>
              <p class="formula-equation">
                Base = truncate((6 × Strength + 4 × Weapon skill) / Enemy Defense)
              </p>
              <p>Base is limited to 0–99,999.</p>
              <p>R is the selected enemy’s resistance to your medal’s element.</p>
              <p class="formula-equation">Bonus chance (%) = clamp((999 − R) / 10, 0, 100)</p>
              <p class="formula-equation">Extra damage = truncate(Base × (1000 − R) / 1000)</p>
              <p>
                The bonus is added before criticals and random variation. All damage results already
                include it.
              </p>
            </FormulaHelp>
          </div>
          {element === 'none' ? (
            <p class="muted">Equip a PWR medal to add elemental damage.</p>
          ) : (
            <>
              <p class="power-result">{result ? `+${fmt(result.elementBonus)}` : '—'}</p>
              <p>
                {ELEMENTS.find((e) => e.value === element)!.label} damage ·{' '}
                {result ? `${fmt(result.elementChance, 1)}%` : '—'} chance per hit
              </p>
              <small class="muted">
                {result?.elementChance === 0
                  ? 'Blocked by enemy resistance.'
                  : 'Included in damage totals.'}
              </small>
            </>
          )}
        </section>
        <section class="section-card">
          <div class="formula-heading">
            <h2>Normal hit</h2>
            <FormulaHelp
              title="Normal hit formula"
              terms={['truncate', 'clamp']}
              example={
                result ? (
                  <>
                    {baseExample}
                    {result.elementChance > 0 && (
                      <p>
                        Elemental bonus +{fmt(result.elementBonus)} · {fmt(result.elementChance, 1)}
                        % chance
                      </p>
                    )}
                    <p class="formula-equation">
                      After elemental outcomes, random spread, rounding and the damage cap:
                      <br />
                      Normal hit = {rangeText(result.normal)}
                    </p>
                  </>
                ) : (
                  unavailableExample
                )
              }
            >
              <p class="formula-equation">
                Base = truncate((6 × Strength + 4 × Weapon skill) / Defense)
              </p>
              <p>
                Defense comes from the selected enemy variant. Base damage is limited to 0–99,999.
              </p>
              <p class="formula-equation">
                Normal damage = truncate((Base + elemental bonus) × random spread)
              </p>
              <p>
                The elemental bonus applies only when the PWR medal triggers. Random spread runs
                from 95% to just under 105%; final damage is capped at 99,999.
              </p>
              <p>
                The displayed range includes outcomes with and without the elemental bonus. It
                describes one landed hit.
              </p>
            </FormulaHelp>
          </div>
          <p class="power-result">{rangeText(result?.normal)}</p>
        </section>
        <section class="section-card">
          <div class="formula-heading">
            <h2>Critical hit</h2>
            <FormulaHelp
              title="Critical hit formula"
              terms={['truncate', 'clamp']}
              example={
                result ? (
                  <>
                    {baseExample}
                    <p class="formula-equation">
                      Bonus = {criticalBonusExample} = {result.criticalBonus}%
                    </p>
                    {[
                      ...(result.elementChance < 100
                        ? [{ label: 'Without elemental trigger', d: result.base }]
                        : []),
                      ...(result.elementChance > 0
                        ? [
                            {
                              label: 'With elemental trigger',
                              d: result.base + result.elementBonus,
                            },
                          ]
                        : []),
                    ].map(({ label, d }) => (
                      <p class="formula-equation" key={label}>
                        {label}:<br />
                        {fmt(d)} + truncate({fmt(d)} × {result.criticalBonus} / 100) ={' '}
                        {fmt(d + Math.trunc((d * result.criticalBonus) / 100))} before random spread
                      </p>
                    ))}
                    <p>
                      After random spread, rounding and the damage cap: {rangeText(result.critical)}
                      .
                    </p>
                  </>
                ) : (
                  unavailableExample
                )
              }
            >
              <p class="formula-equation">D = Base + elemental bonus, capped at 99,999</p>
              <p class="formula-equation">Critical = D + truncate(D × bonus / 100)</p>
              <p>With weapon skill S, the critical bonus percentage is:</p>
              <table class="formula-bands">
                <thead>
                  <tr>
                    <th scope="col">Weapon skill</th>
                    <th scope="col">Bonus (%)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>0–1000</td>
                    <td>truncate(S / 20) + 30</td>
                  </tr>
                  <tr>
                    <td>1001–2000</td>
                    <td>truncate((S − 1000) / 50) + 80</td>
                  </tr>
                  <tr>
                    <td>2001+</td>
                    <td>truncate((S − 2000) / 100) + 100</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Apply random spread from 95% to just under 105%, truncate, then cap at 99,999.
                Elemental bonus is included before the critical calculation when the medal triggers.
              </p>
              <p>
                The range describes one landed critical hit, including both possible elemental
                outcomes.
              </p>
            </FormulaHelp>
          </div>
          <p class="power-result">{rangeText(result?.critical)}</p>
        </section>
        <section class="section-card">
          <div class="formula-heading">
            <h2>Hit chance</h2>
            <FormulaHelp
              title="Hit chance formula"
              terms={['truncate', 'clamp']}
              example={
                hitChance !== null ? (
                  <>
                    <p>
                      Speed {speed} · Weapon skill {skill} · Accuracy {accuracy} · Enemy Speed{' '}
                      {effectiveSpeed}
                    </p>
                    {effectiveSpeed === 0 ? (
                      <p>The retail zero-divisor rule produces a threshold of {hitThreshold}.</p>
                    ) : (
                      <p class="formula-equation">
                        Threshold = truncate({accuracy} × (30 × {speed} + 20 × {skill} + 6000) /{' '}
                        {effectiveSpeed}) = {fmt(hitThreshold)}
                      </p>
                    )}
                    {hitProduct !==
                      number(accuracy) * (30 * number(speed) + 20 * number(skill) + 6000) && (
                      <p>
                        The retail signed 32-bit product wraps to {fmt(hitProduct)} before division.
                      </p>
                    )}
                    <p class="formula-equation">
                      Chance = clamp({fmt(hitThreshold)} / 100, 0, 100) = {fmt(hitChance, 2)}%
                    </p>
                  </>
                ) : (
                  unavailableExample
                )
              }
            >
              <p class="formula-equation">
                Threshold = truncate(Accuracy × (30 × Speed + 20 × Weapon skill + 6000) / Enemy
                Speed)
              </p>
              <p>
                A roll from 0 to 9999 must be below the threshold. Chance = threshold / 100%,
                limited to 0–100%. The game truncates each division.
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
          <div class="formula-heading">
            <h2>Critical chance</h2>
            <FormulaHelp
              title="Critical chance formula"
              terms={['clamp', 'max']}
              example={
                character ? (
                  <>
                    <p>Current weapon and weapon-chip critical-rate total C = {criticalRate}.</p>
                    <p class="formula-equation">
                      Chance = clamp(max(1, {criticalRate}) / 2, 0, 100) = {fmt(critChance, 1)}%
                    </p>
                  </>
                ) : (
                  unavailableExample
                )
              }
            >
              <p class="formula-equation">Critical chance (%) = clamp(max(1, C) / 2, 0, 100)</p>
              <p>
                C is the equipped weapon’s critical-rate stat plus the critical-rate stats of its
                weapon chips. The minimum chance is 0.5%.
              </p>
              <p>This roll applies per landed hit and is separate from the elemental bonus roll.</p>
            </FormulaHelp>
          </div>
          <p class="power-result">{`${fmt(critChance, 1)}%`}</p>
          <small class="muted">Per hit</small>
        </section>
        <section class="section-card">
          <div class="formula-heading">
            <h2>Average per hit</h2>
            <FormulaHelp
              title="Average damage per hit formula"
              example={
                result ? (
                  <>
                    <p>
                      Normal mean {fmt(result.normal.mean, 4)} · Critical mean{' '}
                      {fmt(result.critical.mean, 4)} · Critical chance {fmt(critChance, 1)}%
                    </p>
                    <p class="formula-equation">
                      C = {fmt(critChance, 1)} / 100 = {fmt(critChance / 100, 6)}
                      <br />
                      Average = (1 − {fmt(critChance / 100, 6)}) × {fmt(result.normal.mean, 4)} +{' '}
                      {fmt(critChance / 100, 6)} × {fmt(result.critical.mean, 4)} ={' '}
                      {fmt(result.average, 2)}
                    </p>
                    <p>
                      Shown means are rounded for readability; the calculation uses their full
                      precision.
                    </p>
                  </>
                ) : (
                  unavailableExample
                )
              }
            >
              <p class="formula-equation">Average = (1 − C) × normal mean + C × critical mean</p>
              <p>
                C is critical chance as a fraction from 0 to 1. Each mean includes the elemental
                trigger chance, random spread, integer rounding and the damage cap.
              </p>
              <p>This is the expected damage of one landed hit. Misses are excluded.</p>
            </FormulaHelp>
          </div>
          <p class="power-result">{result ? fmt(result.average, 1) : '—'}</p>
          <small class="muted">With {fmt(critChance, 1)}% critical chance</small>
        </section>
        <section class="section-card">
          <div class="formula-heading">
            <h2>{normalHits ? 'Average per attack' : 'Average per hit attempt'}</h2>
            <FormulaHelp
              example={
                result && hitChance !== null && attackAverage !== null ? (
                  <>
                    <p>
                      Average per landed hit {fmt(result.average, 4)} · Hit chance{' '}
                      {fmt(hitChance, 2)}% · {normalHits ?? 1} hit{' '}
                      {(normalHits ?? 1) === 1 ? 'attempt' : 'attempts'}
                    </p>
                    <p class="formula-equation">
                      Average = {fmt(result.average, 4)} × ({fmt(hitChance, 2)} / 100) ×{' '}
                      {normalHits ?? 1} = {fmt(attackAverage, 2)}
                    </p>
                    {!normalHits && (
                      <p>
                        No verified normal attack hit count is available for this weapon, so this
                        example uses one attempt.
                      </p>
                    )}
                    <p>The calculation uses unrounded values before displaying the result.</p>
                  </>
                ) : (
                  unavailableExample
                )
              }
              title={
                normalHits
                  ? 'Average damage per attack formula'
                  : 'Average damage per hit attempt formula'
              }
            >
              <p class="formula-equation">
                Average = average per landed hit × (hit chance / 100) × hit attempts
              </p>
              <p>
                The weapon’s verified normal attack hit count supplies the number of attempts. When
                that count is unavailable, the result uses one attempt.
              </p>
              <p>
                This includes misses, criticals and elemental bonuses. It assumes every attempt
                reaches the target and the enemy survives all hits. Charged attacks and combo script
                multipliers are excluded.
              </p>
            </FormulaHelp>
          </div>
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

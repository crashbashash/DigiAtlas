import type { ComponentChildren } from 'preact';
import type { Enemy, MpTech } from '../data/types';
import {
  applicationValue,
  MP_TECH_NAMES,
  mpDamage,
  mpDuration,
  powerDownReductions,
  powerUpBoosts,
  venomPoison,
} from '../data/mp-tech';
import { powerDownChance } from '../data/power';
import type { CharacterValues } from './CharacterSetup';
import { FormulaHelp } from './FormulaHelp';
import { OtherMpTechFormula, type OtherMpFormulaKind } from './OtherMpTechFormula';

export type MpFormulaKind =
  | OtherMpFormulaKind
  | 'duration'
  | 'application'
  | 'boosts'
  | 'debuff'
  | 'normal'
  | 'critical'
  | 'criticalChance'
  | 'poisonChance'
  | 'poisonDuration'
  | 'poisonDamage';
const fmt = (n: number, digits = 4) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
const Eq = ({ children }: { children: ComponentChildren }) => (
  <p class="formula-equation">{children}</p>
);
const unavailable = (
  <p>Choose valid character stats and an enemy where required to see the current example.</p>
);

export function MpTechFormula({
  kind,
  tech,
  family,
  character,
  target,
  fps,
}: {
  kind: MpFormulaKind;
  tech: MpTech;
  family: MpTech[];
  character: CharacterValues | null;
  target?: Enemy;
  fps: 50 | 60;
}) {
  const w = character?.wisdom ?? NaN,
    f = character?.force ?? NaN,
    s = character?.blast ?? NaN;
  const spirit = target?.stats.spirit ?? NaN;
  const r = tech.element === 'none' ? 0 : (target?.resist[tech.element] ?? NaN);
  const damage = mpDamage(tech, w, s, spirit, r);
  const poison = venomPoison(tech, w, s, r);
  const frames = mpDuration(tech, w);
  const boosts = powerUpBoosts(tech, f);
  const reductions = powerDownReductions(tech, f, target);
  const up = ['power-up', 'speed'].includes(tech.kind);
  const fixedDuration = tech.kind === 'resist';
  const element = tech.element;
  if (['healing', 'reviveHp', 'reviveExp', 'cure', 'speedStats', 'resistStats'].includes(kind))
    return (
      <OtherMpTechFormula
        kind={kind as OtherMpFormulaKind}
        tech={tech}
        family={family}
        character={character}
        target={target}
      />
    );
  const grades = (label: string, value: (t: MpTech) => ComponentChildren) => (
    <table class="formula-bands">
      <thead>
        <tr>
          <th scope="col">Grade</th>
          <th scope="col">{label}</th>
        </tr>
      </thead>
      <tbody>
        {family.map((t) => (
          <tr key={t.row}>
            <th scope="row">{t.grade}</th>
            <td>{value(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const skillBands = (poisonRoll: boolean) => (
    <table class="formula-bands">
      <thead>
        <tr>
          <th scope="col">{poisonRoll ? 'Blast' : 'Force'} skill</th>
          <th scope="col">A</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>0–1000</td>
          <td>{poisonRoll ? 750 : 550} + floor(S / 4)</td>
        </tr>
        <tr>
          <td>1001–2000</td>
          <td>{poisonRoll ? 1000 : 800} + floor((S − 1000) / 5)</td>
        </tr>
        <tr>
          <td>2001+</td>
          <td>{poisonRoll ? 1200 : 1000} + floor((S − 2000) / 10)</td>
        </tr>
      </tbody>
    </table>
  );

  if (kind === 'duration' || kind === 'poisonDuration')
    return (
      <FormulaHelp
        title={
          kind === 'poisonDuration'
            ? 'Poison duration formula'
            : `${MP_TECH_NAMES[tech.kind]} duration formula`
        }
        terms={up || fixedDuration ? [] : ['floor']}
        footer={<>The loaded game is {fps} fps.</>}
        example={
          frames === null ? (
            unavailable
          ) : (
            <>
              <p>
                {tech.grade}
                {!fixedDuration && <> · Wisdom {fmt(w)}</>}
              </p>
              <Eq>
                {tech.baseFrames}
                {!fixedDuration && <> + {up ? fmt(w) : `floor(${fmt(w)} / 2)`}</>} = {fmt(frames)}{' '}
                frames
                <br />
                {fmt(frames)} / {fps} = {fmt(frames / fps)} seconds ≈ {(frames / fps).toFixed(1)}{' '}
                seconds
              </Eq>
            </>
          )
        }
      >
        <p>
          <strong>B</strong> = selected grade’s base duration in frames.
          {!fixedDuration && (
            <>
              <br />
              <strong>W</strong> = caster Wisdom.
            </>
          )}
        </p>
        <Eq>
          Duration frames = B{!fixedDuration && <> + {up ? 'W' : 'floor(W / 2)'}</>}
          <br />
          Duration seconds = duration frames / {fps}
        </Eq>
        {grades('Base frames', (t) => fmt(t.baseFrames))}
        <p>
          {fixedDuration
            ? 'Resist uses its base duration without a Wisdom or Force bonus.'
            : up
              ? `Every ${fps} Wisdom adds one second.`
              : `Half Wisdom is rounded down before it is added to the base duration. Every ${fps * 2} Wisdom adds one second.`}
        </p>
        <p>
          {fixedDuration
            ? ''
            : tech.kind === 'venom'
              ? 'Poison resistance and Blast skill affect the chance to poison, not this duration.'
              : up
                ? 'Force skill affects the boost amount, not its duration.'
                : 'Force skill and enemy Spirit affect application chance, not duration.'}{' '}
        </p>
      </FormulaHelp>
    );

  if (kind === 'application' || kind === 'poisonChance') {
    const isPoison = kind === 'poisonChance',
      skill = isPoison ? s : f;
    const a = applicationValue(skill, isPoison);
    const chance = isPoison ? (poison?.chance ?? null) : powerDownChance(f, spirit);
    const threshold = isPoison
      ? poison?.threshold
      : a === null
        ? undefined
        : Math.floor((100 * a) / spirit);
    const aExpression =
      skill <= 1000
        ? `${isPoison ? 750 : 550} + floor(${fmt(skill)} / 4)`
        : skill <= 2000
          ? `${isPoison ? 1000 : 800} + floor((${fmt(skill)} − 1000) / 5)`
          : `${isPoison ? 1200 : 1000} + floor((${fmt(skill)} − 2000) / 10)`;
    return (
      <FormulaHelp
        title={isPoison ? 'Chance to poison formula' : `${MP_TECH_NAMES[tech.kind]} chance formula`}
        terms={isPoison ? ['floor', 'truncate', 'clamp'] : ['floor', 'clamp']}
        example={
          chance === null || a === null || threshold === undefined ? (
            unavailable
          ) : (
            <>
              <p>
                {isPoison ? 'Blast' : 'Force'} skill {fmt(skill)} · {target?.name}{' '}
                {isPoison ? `poison resistance ${fmt(r)}` : `Spirit ${fmt(spirit)}`}
              </p>
              <Eq>
                A = {aExpression} = {fmt(a)}
                <br />
                {isPoison
                  ? `Threshold = truncate(${fmt(a)} × (1000 − ${fmt(r)}) / 1000)`
                  : `Threshold = floor(100 × ${fmt(a)} / ${fmt(spirit)})`}{' '}
                = {fmt(threshold)}
                <br />
                Chance = clamp({fmt(threshold)} / 10, 0, 100) = {chance.toFixed(1)}%
              </Eq>
            </>
          )
        }
      >
        <p>
          <strong>S</strong> = caster {isPoison ? 'Blast' : 'Force'} skill.
          <br />
          {isPoison ? (
            <>
              <strong>R</strong> = selected enemy’s poison resistance.
            </>
          ) : (
            <>
              <strong>E</strong> = selected enemy’s Spirit.
            </>
          )}
          <br />
          <strong>A</strong> = the skill value from this table.
        </p>
        {skillBands(isPoison)}
        <Eq>
          Threshold = {isPoison ? 'truncate(A × (1000 − R) / 1000)' : 'floor(100 × A / E)'}
          <br />
          Chance (%) = clamp(Threshold / 10, 0, 100)
        </Eq>
        <p>
          A whole-number roll from 0 to 999 must be strictly below the threshold. A threshold of
          1000 or more passes every outcome of this roll.
        </p>
        <p>
          Wisdom and grade do not change this roll. It assumes the spell hits and the enemy accepts
          the effect; immunity or enemy scripts can prevent application.
        </p>
      </FormulaHelp>
    );
  }
  if (kind === 'boosts')
    return (
      <FormulaHelp
        title="Pwr Up stat boost formulas"
        terms={['floor']}
        example={
          !boosts ? (
            unavailable
          ) : (
            <>
              <p>
                {tech.grade} · Force skill {fmt(f)}
              </p>
              <Eq>
                Skill bonus = floor({fmt(f)} / 5) = {fmt(Math.floor(f / 5))}
                <br />
                Max HP: {tech.boosts.maxHp} + {Math.floor(f / 5)} = +{fmt(boosts.maxHp)}
                <br />
                Strength: {tech.boosts.strength} + {Math.floor(f / 5)} = +{fmt(boosts.strength)}
                <br />
                Defense: {tech.boosts.defense} + {Math.floor(f / 5)} = +{fmt(boosts.defense)}
              </Eq>
            </>
          )
        }
      >
        <p>
          <strong>F</strong> = caster Force skill.
          <br />
          <strong>B</strong> = the grade’s base bonus for the stat being increased.
        </p>
        <Eq>
          Skill bonus = floor(F / 5)
          <br />
          Stat increase = B + skill bonus
        </Eq>
        {grades(
          'Base HP / Strength / Defense',
          (t) => `${t.boosts.maxHp} / ${t.boosts.strength} / ${t.boosts.defense}`,
        )}
        <p>
          Apply the calculation separately to Max HP, Strength and Defense. These are flat
          additions, not percentages. Each ally receives the caster’s calculated bonus. A target’s
          stat cap can limit the final displayed increase.
        </p>
        <p>Wisdom changes duration rather than boost amount.</p>
      </FormulaHelp>
    );

  if (kind === 'debuff')
    return (
      <FormulaHelp
        title="Pwr Down stat reduction formulas"
        terms={['floor', 'truncate']}
        example={
          !reductions || !target ? (
            unavailable
          ) : (
            <>
              <p>
                {tech.grade} · Force skill {fmt(f)}
              </p>
              {(['strength', 'defense'] as const).map((stat) => (
                <Eq key={stat}>
                  {stat === 'strength' ? 'Strength' : 'Defense'}:<br />
                  Requested = {-tech.boosts[stat]} + floor({fmt(f)} / 20) ={' '}
                  {fmt(-tech.boosts[stat] + Math.floor(f / 20))}
                  <br />
                  Limit = truncate(80 × {fmt(target.stats[stat])} / 100) ={' '}
                  {fmt(Math.trunc((80 * target.stats[stat]) / 100))}
                  <br />
                  Reduction = {fmt(reductions[stat])}; stat after effect ={' '}
                  {fmt(target.stats[stat] - reductions[stat])}
                </Eq>
              ))}
            </>
          )
        }
      >
        <p>
          <strong>B</strong> = the grade’s base reduction for the stat.
          <br />
          <strong>F</strong> = caster Force skill.
          <br />
          <strong>E</strong> = the enemy’s original Strength or Defense.
        </p>
        <Eq>
          Requested reduction = B + floor(F / 20)
          <br />
          Reduction limit = truncate(80 × E / 100)
          <br />
          Applied reduction = the smaller of requested reduction and limit
        </Eq>
        {grades(
          'Base Strength / Defense reduction',
          (t) => `${-t.boosts.strength} / ${-t.boosts.defense}`,
        )}
        <p>
          The game limits each reduction to 80% of that original enemy stat. Strength and Defense
          are calculated separately. This shows one successful application, using the selected enemy
          without other temporary effects.
        </p>
      </FormulaHelp>
    );

  if (kind === 'poisonDamage')
    return (
      <FormulaHelp
        title="Poison damage formula"
        terms={['truncate']}
        example={
          poison ? (
            <>
              <p>
                {tech.grade} Venom · Technique power {tech.power}
              </p>
              <Eq>
                Poison damage = truncate({tech.power} / 5) = {poison.damage} per tick
              </Eq>
            </>
          ) : (
            unavailable
          )
        }
      >
        <p>
          <strong>P</strong> = the selected Venom grade’s technique power.
        </p>
        <Eq>Poison damage per tick = truncate(P / 5)</Eq>
        {grades('Technique power', (t) => t.power)}
        <p>
          This is separate from the initial hit. Wisdom, Blast skill, enemy Spirit and poison
          resistance do not change this tick-damage calculation. Tick frequency and total poison
          damage are not calculated here.
        </p>
      </FormulaHelp>
    );

  if (kind === 'criticalChance' && tech.element === 'none')
    return (
      <FormulaHelp
        title="MP Tech critical chance formula"
        terms={['clamp']}
        example={
          !damage ? (
            unavailable
          ) : (
            <>
              <p>
                {tech.grade} · Technique critical rate {tech.criticalRate}
              </p>
              <Eq>
                Chance = clamp({tech.criticalRate}, 0, 100) = {damage.criticalChance.toFixed(1)}%
              </Eq>
            </>
          )
        }
      >
        <p>
          <strong>C</strong> = selected technique grade’s critical-rate value.
        </p>
        {grades('Critical rate C', (t) => t.criticalRate)}
        <Eq>Critical chance (%) = clamp(C, 0, 100)</Eq>
        <p>
          Non-elemental MP Techs use a roll from 0 to 99 that must be strictly below C. Enemy
          resistance and the equipped weapon’s critical rate do not affect this roll.
        </p>
      </FormulaHelp>
    );
  if (kind === 'criticalChance')
    return (
      <FormulaHelp
        title="MP Tech critical chance formula"
        terms={['truncate', 'clamp']}
        example={
          !damage ? (
            unavailable
          ) : (
            <>
              <p>
                {tech.grade} · Technique critical rate {tech.criticalRate} · Enemy {element}{' '}
                resistance {r}
              </p>
              <Eq>
                Divisor = truncate(12 × {r} / 10) + 50 = {damage.criticalDivisor}
                <br />K ={' '}
                {damage.criticalDivisor === 0
                  ? 'retail zero-divisor result'
                  : `truncate(10000 / ${damage.criticalDivisor})`}{' '}
                = {damage.criticalScale}
                <br />
                Threshold = truncate(({tech.criticalRate} + 100) × {damage.criticalScale} / 100) ={' '}
                {damage.criticalThreshold}
                <br />
                Chance = clamp({damage.criticalThreshold} / 10, 0, 100) ={' '}
                {damage.criticalChance.toFixed(1)}%
              </Eq>
            </>
          )
        }
      >
        <p>
          <strong>C</strong> = selected technique grade’s critical rate.
          <br />
          <strong>R</strong> = selected enemy’s {element} resistance.
          <br />
          <strong>K</strong> = the resistance scaling factor.
        </p>
        {grades('Technique critical rate C', (t) => t.criticalRate)}
        <Eq>
          K = truncate(10000 / (truncate(12 × R / 10) + 50))
          <br />
          Threshold = truncate((C + 100) × K / 100)
          <br />
          Chance (%) = clamp(Threshold / 10, 0, 100)
        </Eq>
        <p>
          A roll from 0 to 999 must be strictly below the threshold. This roll is per landed hit and
          separate from poison application. It does not use the equipped weapon’s critical rate.
        </p>
      </FormulaHelp>
    );

  const spread = (
    <>
      <p>
        For damage D, roll a whole number r from 0 to (25 × D − 1), and choose Q from 950, 975, 1000
        or 1025.
      </p>
      <Eq>Final damage = clamp(truncate((Q × D + r) / 1000), 0, 99999)</Eq>
      <p>
        This gives approximately 95% to just under 105% of D. Zero damage stays zero. All ranges
        describe one landed hit, excluding misses, extra projectiles and poison ticks.
      </p>
    </>
  );
  if (kind === 'normal')
    return (
      <FormulaHelp
        title="MP Tech normal hit formula"
        terms={['truncate', 'clamp']}
        example={
          !damage ? (
            unavailable
          ) : (
            <>
              <p>
                Power {tech.power} · Wisdom {w} · Blast skill {s} · Enemy Spirit {spirit} ·{' '}
                {element} resistance {r}
              </p>
              <Eq>
                Base ={' '}
                {spirit === 0
                  ? 'retail zero-divisor result'
                  : `truncate((20 × ${tech.power} + 10 × ${w} + 5 × ${s}) / ${spirit})`}{' '}
                = {damage.rawBase}
                <br />
                Capped Base = {damage.base}
                <br />D = clamp(truncate({damage.base} × (1000 − {r}) / 1000), 0, 99999) ={' '}
                {damage.damage}
                <br />
                After spread and the final cap: {damage.normal.min}–{damage.normal.max}
              </Eq>
            </>
          )
        }
      >
        <p>
          <strong>P</strong> = selected technique power.
          <br />
          <strong>W</strong> = caster Wisdom.
          <br />
          <strong>S</strong> = Blast skill.
          <br />
          <strong>E</strong> = enemy Spirit.
          <br />
          <strong>R</strong> ={' '}
          {tech.element === 'none'
            ? '0 for this non-elemental technique'
            : `enemy ${element} resistance`}
          .
        </p>
        {grades('Technique power P', (t) => t.power)}
        <Eq>
          Base = clamp(truncate((20 × P + 10 × W + 5 × S) / E), 0, 99999)
          <br />D = clamp(truncate(Base × (1000 − R) / 1000), 0, 99999)
        </Eq>
        <p>
          Enemy Spirit divides the base calculation. Resistance then scales the entire technique
          hit. The game caps Base before resistance and caps D again before criticals or spread.
          This is different from a weapon PWR medal’s extra damage.
        </p>
        {spread}
      </FormulaHelp>
    );

  return (
    <FormulaHelp
      title="MP Tech critical hit formula"
      terms={['truncate', 'clamp']}
      example={
        !damage ? (
          unavailable
        ) : (
          <>
            <p>
              Blast skill {s} · Damage before spread {damage.damage}
            </p>
            <Eq>
              Bonus ={' '}
              {s <= 1000
                ? `truncate(${s} / 20) + 30`
                : s <= 2000
                  ? `truncate((${s} − 1000) / 50) + 80`
                  : `truncate((${s} − 2000) / 100) + 100`}{' '}
              = {damage.bonus}%<br />
              Critical = {damage.damage} + truncate({damage.damage} × {damage.bonus} / 100) ={' '}
              {damage.criticalDamage}
              <br />
              After spread and the final cap: {damage.critical.min}–{damage.critical.max}
            </Eq>
          </>
        )
      }
    >
      <p>
        <strong>D</strong> = normal technique damage after resistance and the pre-spread cap.
        <br />
        <strong>S</strong> = caster Blast skill.
      </p>
      <table class="formula-bands">
        <thead>
          <tr>
            <th scope="col">Blast skill S</th>
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
      <Eq>Critical = D + truncate(D × bonus / 100)</Eq>
      <p>
        Use Critical in place of D in the spread calculation below. Poison ticks do not receive this
        hit’s critical bonus.
      </p>
      {spread}
    </FormulaHelp>
  );
}

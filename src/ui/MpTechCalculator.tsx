import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { routes } from '../app/route';
import type { MpTechKind } from '../data/types';
import {
  MP_TECH_NAMES,
  ELEMENT_NAMES,
  targetsEnemy,
  isHealing,
  isCure,
  healingAmount,
  speedEffects,
  cureChance,
  mpDamage,
  mpDuration,
  powerDownReductions,
  powerUpBoosts,
  venomPoison,
} from '../data/mp-tech';
import { gameFrameRate, powerDownChance } from '../data/power';
import { CharacterSetup, type CharacterValues } from './CharacterSetup';
import { SearchPicker } from './SearchPicker';
import { SettingsBar, Link } from './common';
import { useApp } from './context';
import { variantLabel } from './pieces';
import { VariantSpawns } from './VariantSpawns';
import { MpTechFormula, type MpFormulaKind } from './MpTechFormula';

const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
export function MpTechCalculator({
  initialTechnique = 'power-down',
}: {
  initialTechnique?: MpTechKind;
}) {
  const { model, settings, scope, reimport } = useApp();
  const [kind, setKind] = useState<MpTechKind>(initialTechnique);
  const [grade, setGrade] = useState('Petty');
  const [character, setCharacter] = useState<CharacterValues | null>(null);
  const [selectedName, setName] = useState('');
  const [row, setRow] = useState(-1);
  useEffect(() => setKind(initialTechnique), [initialTechnique]);
  const spells = model.raw.items.mpTechs ?? [];
  const family = spells.filter((t) => t.kind === kind);
  const tech = family.find((t) => t.grade === grade) ?? family[0];
  const fps = gameFrameRate(model.raw.manifest);
  const names = useMemo(
    () =>
      [
        ...new Set(
          [...model.enemies.values()].filter((e) => e.kind !== 'object').map((e) => e.name),
        ),
      ].sort(),
    [model],
  );
  const name = selectedName || (names.includes('Goburimon') ? 'Goburimon' : names[0]) || '';
  const variants = name ? model.variantsOn(name, settings.difficulty, scope) : [];
  const target = variants.find((e) => e.row === row) ?? variants[0];
  const up = kind === 'power-up',
    blast = tech?.skill === 'blast';
  const friendly = tech ? !targetsEnemy(tech) : false;
  const control = ['power-down', 'freeze', 'sleep', 'bind'].includes(kind);
  const element = tech?.element ?? 'none';
  const w = character?.wisdom ?? NaN,
    f = character?.force ?? NaN,
    s = character?.blast ?? NaN;
  const resistance = element === 'none' ? 0 : (target?.resist[element] ?? NaN);
  const damage = tech && mpDamage(tech, w, s, target?.stats.spirit ?? NaN, resistance);
  const frames = tech && mpDuration(tech, w);
  const boosts = tech && powerUpBoosts(tech, f);
  const reductions = tech && powerDownReductions(tech, f, target);
  const poison = tech && venomPoison(tech, w, s, resistance);
  const healing = tech && healingAmount(tech, w, character?.heal ?? NaN);
  const speed = tech && speedEffects(tech, f, target);
  const chance =
    kind === 'venom' ? (poison?.chance ?? null) : powerDownChance(f, target?.stats.spirit ?? NaN);
  const help = (formula: MpFormulaKind) =>
    tech && (
      <MpTechFormula
        kind={formula}
        tech={tech}
        family={family}
        character={character}
        target={target}
        fps={fps}
      />
    );
  const metric = (
    title: string,
    formula: MpFormulaKind,
    value: ComponentChildren,
    context: string,
  ) => (
    <section class="section-card mp-tech-metric">
      <div class="formula-heading">
        <h3>{title}</h3>
        {help(formula)}
      </div>
      <p class="mp-tech-value">{value ?? '—'}</p>
      <small class="muted">{context}</small>
    </section>
  );
  const chanceMetric = (title: string, formula: MpFormulaKind) => (
    <section class="section-card mp-tech-metric">
      <div class="power-chance-heading">
        <div class="formula-heading">
          <h3>{title}</h3>
          {help(formula)}
        </div>
        <strong class="power-chance-value">
          {chance === null ? '—' : `${chance.toFixed(1)}%`}
        </strong>
      </div>
      <div class="power-chance-track" aria-hidden="true">
        <span style={{ width: `${chance ?? 0}%` }} />
      </div>
      <small class="muted">
        {kind === 'venom' ? 'When Venom hits' : 'Per cast that hits the enemy'}
      </small>
    </section>
  );
  const range = (r: { min: number; max: number } | undefined) =>
    r ? (r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`) : '—';
  const valid = !tech
    ? false
    : blast
      ? !!damage && (kind !== 'venom' || !!poison)
      : up
        ? !!boosts && frames !== null
        : kind === 'power-down'
          ? !!reductions && chance !== null && frames !== null
          : kind === 'speed' || kind === 'freeze'
            ? !!speed && frames !== null && (friendly || chance !== null)
            : kind === 'sleep' || kind === 'bind'
              ? chance !== null && frames !== null
              : kind === 'resist'
                ? frames !== null
                : isHealing(tech)
                  ? healing !== null
                  : kind === 'raise'
                    ? !!tech.revive
                    : isCure(tech);
  return (
    <div class="page power-page mp-tech-page">
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          <Link to={routes.calculators()}>Calculators</Link>
        </nav>
        <h1>MP Tech calculator</h1>
        <p class="muted">Damage, status effects, and buffs for your chosen technique.</p>
      </header>
      {!tech ? (
        <section class="section-card">
          <p>Reload your disc data to read MP Tech stats.</p>
          {reimport && (
            <button class="equipment-edit-button" type="button" onClick={reimport}>
              Reload disc data
            </button>
          )}
        </section>
      ) : (
        <>
          <section class="section-card mp-tech-config" aria-label="Choose an MP Tech">
            <SearchPicker
              label="MP Tech"
              searchLabel="Search MP Techs"
              value={kind}
              onChange={(value) => setKind(value as MpTechKind)}
              options={(Object.keys(MP_TECH_NAMES) as MpTechKind[]).map((value) => ({
                value,
                label: MP_TECH_NAMES[value],
              }))}
            />
            <SearchPicker
              label="Grade"
              value={tech.grade}
              onChange={setGrade}
              options={family.map((t) => ({ value: t.grade, label: t.grade }))}
            />
            <div class="mp-tech-meta">
              <span class="mp-tech-category">
                {tech.skill === 'blast' ? 'Blast' : tech.skill === 'heal' ? 'Heal' : 'Force'} ·{' '}
                {blast
                  ? element === 'none'
                    ? 'Damage'
                    : ELEMENT_NAMES[element]
                  : control
                    ? 'Status'
                    : isHealing(tech)
                      ? 'Healing'
                      : kind === 'raise'
                        ? 'Revival'
                        : isCure(tech)
                          ? 'Cure'
                          : 'Buff'}
              </span>
              <div class="mp-tech-cost">
                <span class="muted">MP cost</span>
                <strong>{fmt(tech.mpCost)} MP</strong>
              </div>
            </div>
          </section>
          <div class={`mp-tech-workspace${friendly ? ' mp-tech-friendly' : ''}`}>
            <section class="section-card">
              <h2>Your character</h2>
              <CharacterSetup mpSkill={tech.skill} onChange={setCharacter} />
            </section>
            {!friendly && (
              <section class="section-card mp-tech-target">
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
                <SearchPicker
                  label="Enemy variant"
                  value={String(target?.row ?? -1)}
                  searchLabel="Search variants"
                  onChange={(value) => setRow(Number(value))}
                  options={variants.map((e) => ({
                    value: String(e.row),
                    label: `${variantLabel(e)} · HP ${fmt(e.hp)} · Spirit ${fmt(e.stats.spirit)}${blast && element !== 'none' ? ` · ${ELEMENT_NAMES[element]} ${e.resist[element]}` : kind === 'power-down' ? ` · Strength ${fmt(e.stats.strength)} · Defense ${fmt(e.stats.defense)}` : kind === 'freeze' ? ` · Speed ${fmt(e.stats.speed)}` : ''}`,
                  }))}
                />
                <div class="power-target-links">
                  <Link to={routes.enemy(name)}>View {name}</Link>
                  {target && (
                    <VariantSpawns key={`${target.row}:${settings.difficulty}`} enemy={target} />
                  )}
                </div>
                {target ? (
                  <dl class="target-stat-summary">
                    <div>
                      <dt>HP</dt>
                      <dd>{fmt(target.hp)}</dd>
                    </div>
                    <div class="active-stat">
                      <dt>Spirit</dt>
                      <dd>{fmt(target.stats.spirit)}</dd>
                    </div>
                    {blast && element !== 'none' && (
                      <div class="active-stat">
                        <dt>{ELEMENT_NAMES[element]} resistance</dt>
                        <dd>{fmt(resistance)}</dd>
                      </div>
                    )}
                    {kind === 'power-down' && (
                      <>
                        <div>
                          <dt>Strength</dt>
                          <dd>{fmt(target.stats.strength)}</dd>
                        </div>
                        <div>
                          <dt>Defense</dt>
                          <dd>{fmt(target.stats.defense)}</dd>
                        </div>
                      </>
                    )}
                    {kind === 'freeze' && (
                      <div class="active-stat">
                        <dt>Speed</dt>
                        <dd>{fmt(target.stats.speed)}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p role="status">No enemy variants are available for these settings.</p>
                )}
              </section>
            )}
            <section class="mp-tech-results" aria-label="Calculation results" aria-live="polite">
              {!valid && character && (
                <p role="alert">
                  Choose valid character stats{!friendly && ' and an available enemy variant'} to
                  calculate results.
                </p>
              )}
              <div class="mp-tech-results-grid">
                {control && chanceMetric('Chance to apply', 'application')}
                {!blast &&
                  tech.baseFrames > 0 &&
                  metric(
                    'Effect duration',
                    'duration',
                    frames == null ? (
                      '—'
                    ) : (
                      <>
                        {(frames / fps).toFixed(1)} <small>seconds</small>
                      </>
                    ),
                    'For the selected grade',
                  )}
                {isHealing(tech) &&
                  metric(
                    'Healing',
                    'healing',
                    healing == null ? (
                      '—'
                    ) : (
                      <>
                        {fmt(healing)} <small>HP</small>
                      </>
                    ),
                    'Up to this amount per target',
                  )}
                {kind === 'raise' && (
                  <>
                    {metric(
                      'Revival HP',
                      'reviveHp',
                      tech.revive ? (
                        <>
                          {fmt(tech.revive.hp)} <small>HP</small>
                        </>
                      ) : (
                        '—'
                      ),
                      'When an ally is revived',
                    )}
                    {metric(
                      'EXP recovered',
                      'reviveExp',
                      tech.revive ? `${tech.revive.experiencePercent}%` : '—',
                      'Of EXP stored in the Backup Chip',
                    )}
                  </>
                )}
                {blast && (
                  <>
                    {metric('Normal hit', 'normal', range(damage?.normal), 'Damage per hit')}
                    {metric(
                      'Critical hit',
                      'critical',
                      range(damage?.critical),
                      'Damage per critical hit',
                    )}
                    {metric(
                      'Critical chance',
                      'criticalChance',
                      damage ? `${damage.criticalChance.toFixed(1)}%` : '—',
                      'For this enemy and grade',
                    )}
                  </>
                )}
              </div>
              {(up || kind === 'power-down') && (
                <section class="section-card mp-tech-effects">
                  <div class="formula-heading">
                    <h3>{up ? 'Stat boosts' : 'Applied debuff'}</h3>
                    {help(up ? 'boosts' : 'debuff')}
                  </div>
                  <table class="mp-tech-stat-effects">
                    <thead>
                      <tr>
                        <th scope="col">Stat</th>
                        <th scope="col">Effect</th>
                        {!up && <th scope="col">After effect</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(up
                        ? (['maxHp', 'strength', 'defense'] as const)
                        : (['strength', 'defense'] as const)
                      ).map((stat) => (
                        <tr key={stat}>
                          <th scope="row">
                            {stat === 'maxHp'
                              ? 'Max HP'
                              : stat === 'strength'
                                ? 'Strength'
                                : 'Defense'}
                          </th>
                          <td>
                            {up
                              ? boosts
                                ? `+${fmt(boosts[stat])}`
                                : '—'
                              : reductions && stat !== 'maxHp'
                                ? `−${fmt(reductions[stat])}`
                                : '—'}
                          </td>
                          {!up && (
                            <td>
                              {target && reductions && stat !== 'maxHp'
                                ? fmt(target.stats[stat] - reductions[stat])
                                : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {(kind === 'speed' || kind === 'freeze') && (
                <section class="section-card mp-tech-effects">
                  <div class="formula-heading">
                    <h3>{friendly ? 'Stat boosts' : 'Applied debuff'}</h3>
                    {help('speedStats')}
                  </div>
                  <table class="mp-tech-stat-effects">
                    <thead>
                      <tr>
                        <th scope="col">Stat</th>
                        <th scope="col">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['speed', 'Speed'],
                          ['criticalRate', 'Critical rate'],
                          ['hitRate', 'Hit rate'],
                          ['evasion', 'Evasion'],
                        ] as const
                      ).map(([key, label]) => (
                        <tr key={key}>
                          <th scope="row">{label}</th>
                          <td>{speed ? `${speed[key] > 0 ? '+' : ''}${fmt(speed[key])}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {kind === 'resist' && (
                <section class="section-card mp-tech-effects">
                  <div class="formula-heading">
                    <h3>Resistance boosts</h3>
                    {help('resistStats')}
                  </div>
                  <table class="mp-tech-stat-effects">
                    <thead>
                      <tr>
                        <th scope="col">Resistance</th>
                        <th scope="col">Increase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['fire', 'ice', 'thunder', 'dark'] as const).map((key) => (
                        <tr key={key}>
                          <th scope="row">{ELEMENT_NAMES[key]}</th>
                          <td>+{fmt(tech.boosts[key] ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {isCure(tech) && (
                <section class="section-card">
                  <div class="formula-heading">
                    <h3>Poison removal</h3>
                    {help('cure')}
                  </div>
                  <table class="mp-tech-stat-effects">
                    <thead>
                      <tr>
                        <th scope="col">Poison strength</th>
                        <th scope="col">Chance to cure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 11 }, (_, i) => (
                        <tr key={i}>
                          <th scope="row">{i === 10 ? '10+' : i}</th>
                          <td>{cureChance(tech, i)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {kind === 'venom' && (
                <section class="section-card mp-tech-effects">
                  <div class="mp-tech-effect-heading">
                    <h3>Poison</h3>
                    <small class="muted">Additional effect after the hit</small>
                  </div>
                  <div class="mp-tech-results-grid">
                    {chanceMetric('Chance to poison', 'poisonChance')}
                    {metric(
                      'Poison duration',
                      'poisonDuration',
                      poison ? (
                        <>
                          {(poison.frames / fps).toFixed(1)} <small>seconds</small>
                        </>
                      ) : (
                        '—'
                      ),
                      'When poison is applied',
                    )}
                    {metric(
                      'Poison damage',
                      'poisonDamage',
                      poison ? (
                        <>
                          {poison.damage} <small>per tick</small>
                        </>
                      ) : (
                        '—'
                      ),
                      'Separate from the initial hit',
                    )}
                  </div>
                </section>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

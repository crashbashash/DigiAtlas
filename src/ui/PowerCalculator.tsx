import { SearchPicker } from './SearchPicker';
import { useMemo, useState } from 'preact/hooks';
import {
  durationText,
  gameFrameRate,
  powerDownChance,
  powerDuration,
  validPowerStat,
} from '../data/power';
import { CharacterSetup, type CharacterValues } from './CharacterSetup';
import { Link, SettingsBar } from './common';
import { routes } from '../app/route';
import { useApp } from './context';
import { variantLabel } from './pieces';
import { VariantSpawns } from './VariantSpawns';
import { FormulaHelp } from './FormulaHelp';

export function PowerCalculator({ kind }: { kind: 'up' | 'down' }) {
  const isDown = kind === 'down';
  const title = isDown ? 'Power Down' : 'Power Up';
  const { model, settings, scope, reimport } = useApp();
  const fps = gameFrameRate(model.raw.manifest);
  const [character, setCharacter] = useState<CharacterValues | null>(null);
  const [selectedName, setName] = useState('');
  const [row, setRow] = useState(-1);
  const spells = model.raw.items.powerSpells;
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
  const targetSpirit = target?.stats.spirit ?? NaN;
  const w = character?.wisdom ?? NaN;
  const f = character?.force ?? NaN;
  const chance = powerDownChance(f, targetSpirit);
  return (
    <div class="page power-page">
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          <Link to={routes.calculators()}>Calculators</Link>
        </nav>
        <h1>{title}</h1>
        <p class="muted">
          {isDown
            ? 'Work out duration and chance to apply Power Down.'
            : 'Work out how long Power Up lasts.'}
        </p>
      </header>
      <div class="power-grid">
        <section class="section-card">
          <h2>Your character</h2>
          <CharacterSetup force={isDown} onChange={setCharacter} />
          {(!validPowerStat(w) || (isDown && !validPowerStat(f))) && (
            <p role="alert">Enter whole-number stats from 0 to 9999.</p>
          )}
        </section>
        {isDown && (
          <section class="section-card">
            <div class="formula-heading">
              <h2>Chance to apply</h2>
              <FormulaHelp title="Power Down chance formula">
                <p>
                  <strong>F</strong> = Force skill · <strong>S</strong> = enemy Spirit
                </p>
                <table class="formula-bands">
                  <thead>
                    <tr>
                      <th scope="col">Force skill</th>
                      <th scope="col">A</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>0–1000</td>
                      <td>550 + floor(F / 4)</td>
                    </tr>
                    <tr>
                      <td>1001–2000</td>
                      <td>800 + floor((F − 1000) / 5)</td>
                    </tr>
                    <tr>
                      <td>2001+</td>
                      <td>1000 + floor((F − 2000) / 10)</td>
                    </tr>
                  </tbody>
                </table>
                <p class="formula-equation">Chance (%) = clamp(floor(100 × A / S) / 10, 0, 100)</p>
                <p>
                  <strong>floor</strong> rounds down. <strong>clamp</strong> keeps the result
                  between 0% and 100%.
                </p>
                <p class="muted">Wisdom and spell grade do not change this chance.</p>
              </FormulaHelp>
            </div>
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
                    label: `${variantLabel(e)} · HP ${e.hp.toLocaleString()} · Spirit ${e.stats.spirit} · Row ${e.row}`,
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
            <p class="muted">
              Enemy Spirit: {Number.isFinite(targetSpirit) ? targetSpirit.toLocaleString() : '—'}
            </p>
            <p class="power-result" aria-live="polite">
              {chance === null ? '—' : `${chance.toFixed(1)}%`}
            </p>
            <p>Force improves your chance. Wisdom increases duration.</p>
            {(!Number.isInteger(targetSpirit) || targetSpirit <= 0) && (
              <p role="alert">Choose an available enemy variant with positive Spirit.</p>
            )}
          </section>
        )}
      </div>
      <section class="section-card power-durations">
        <div class="formula-heading">
          <h2>Effect durations</h2>
          <FormulaHelp title={`${title} duration formula`}>
            <p>
              <strong>B</strong> = the spell grade’s base duration in frames
              <br />
              <strong>W</strong> = Wisdom
            </p>
            <p class="formula-equation">
              {isDown
                ? `Duration (seconds) = (B + floor(W / 2)) / ${fps}`
                : `Duration (seconds) = (B + W) / ${fps}`}
            </p>
            <p>
              {isDown
                ? `Half your Wisdom is rounded down before it is added to the base duration. Every ${fps * 2} Wisdom adds one second.`
                : `Every ${fps} Wisdom adds one second.`}
            </p>
            <p class="muted">The game uses {fps} frames per second.</p>
          </FormulaHelp>
        </div>
        {!spells?.length ? (
          <p>
            Re-import your disc to read spell durations.{' '}
            {reimport && (
              <button type="button" onClick={reimport}>
                Re-import from disc
              </button>
            )}
          </p>
        ) : (
          <div class="power-table-wrap">
            <table class="power-table">
              <caption>Durations at {validPowerStat(w) ? w : '—'} Wisdom</caption>
              <thead>
                <tr>
                  <th scope="col">Grade</th>
                  <th scope="col">Duration</th>
                </tr>
              </thead>
              <tbody>
                {spells
                  .filter((s) => s.kind === kind)
                  .map((spell) => {
                    const frames = powerDuration(spell, w);
                    return (
                      <tr key={spell.row}>
                        <th scope="row">{spell.grade}</th>
                        <td>
                          {frames === null ? (
                            '—'
                          ) : (
                            <>
                              <strong>{durationText(frames, fps)}</strong>
                              <small>
                                {Number((spell.baseFrames / fps).toFixed(2))} seconds base +{' '}
                                {Number(((frames - spell.baseFrames) / fps).toFixed(2))} seconds
                                from Wisdom
                              </small>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

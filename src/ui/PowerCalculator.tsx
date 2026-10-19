import { SearchPicker } from './SearchPicker';
import { useMemo, useState } from 'preact/hooks';
import { durationText, powerDownChance, powerDuration, validPowerStat } from '../data/power';
import { readPowerBoxes, type SaveBox } from '../data/power-save-file';
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
  const [wisdom, setWisdom] = useState('1000');
  const [force, setForce] = useState('1000');
  const [spirit, setSpirit] = useState('500');
  const [name, setName] = useState('');
  const [row, setRow] = useState(-1);
  const [boxes, setBoxes] = useState<SaveBox[]>([]);
  const [box, setBox] = useState('');
  const saved = boxes.find((b) => b.id === box)?.digimon ?? [];
  const [character, setCharacter] = useState('');
  const [error, setError] = useState('');
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
  const variants = name ? model.variantsOn(name, settings.difficulty, scope) : [];
  const target = variants.find((e) => e.row === row) ?? variants[0];
  const targetSpirit = name ? (target?.stats.spirit ?? NaN) : spirit.trim() ? Number(spirit) : NaN;
  const w = wisdom.trim() ? Number(wisdom) : NaN;
  const f = force.trim() ? Number(force) : NaN;
  const chance = powerDownChance(f, targetSpirit);
  function chooseSaved(index: string) {
    setCharacter(index);
    if (index === '') return;
    const selected = saved[Number(index)];
    setWisdom(String(selected.wisdom));
    setForce(String(selected.force));
  }
  function chooseBox(id: string, choices = boxes) {
    const selected = choices.find((b) => b.id === id);
    if (!selected) return;
    setBox(id);
    setCharacter('0');
    setWisdom(String(selected.digimon[0].wisdom));
    setForce(String(selected.digimon[0].force));
  }
  async function loadSave(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const stats = model.raw.items.saveStats;
      if (!stats) throw new Error('Re-import your disc to load character stats.');
      const loaded = readPowerBoxes(await file.arrayBuffer(), stats, model.items);
      setBoxes(loaded);
      chooseBox(loaded[0].id, loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
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
          <p>Enter your stats, or load a save.</p>
          <label class="power-field">
            Load a save
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
              onChange={chooseSaved}
              options={[
                { value: '', label: 'Manual stats' },
                ...saved.map((d, i) => ({ value: String(i), label: `${d.name} · Lv ${d.level}` })),
              ]}
            />
          )}
          <div class="power-inputs">
            <label class="power-field">
              Wisdom
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={wisdom}
                onInput={(e) => {
                  setWisdom(e.currentTarget.value);
                  setCharacter('');
                }}
              />
            </label>
            {isDown && (
              <label class="power-field">
                Force skill
                <input
                  type="number"
                  min="0"
                  max="9999"
                  step="1"
                  value={force}
                  onInput={(e) => {
                    setForce(e.currentTarget.value);
                    setCharacter('');
                  }}
                />
              </label>
            )}
          </div>
          {(!validPowerStat(w) || (isDown && !validPowerStat(f))) && (
            <p role="alert">Enter whole-number stats from 0 to 9999.</p>
          )}
          {character !== '' && (
            <p class="muted">
              Wisdom includes saved equipment and X-Data upgrades. The same saved equipment is used
              for each selected form; temporary effects are not stored in the save. You can edit
              either stat.
            </p>
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
              options={[
                { value: '', label: 'Enter Spirit manually' },
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
            ) : (
              <label class="power-field">
                Enemy Spirit
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={spirit}
                  onInput={(e) => setSpirit(e.currentTarget.value)}
                />
              </label>
            )}
            <p class="power-result" aria-live="polite">
              {chance === null ? '—' : `${chance.toFixed(1)}%`}
            </p>
            <p>Force improves your chance. Wisdom increases duration.</p>
            {(!Number.isInteger(targetSpirit) || targetSpirit <= 0) && (
              <p role="alert">Enemy Spirit must be a positive whole number.</p>
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
                ? 'Duration (seconds) = (B + floor(W / 2)) / 60'
                : 'Duration (seconds) = (B + W) / 60'}
            </p>
            <p>
              {isDown
                ? 'Half your Wisdom is rounded down before it is added to the base duration. Every 120 Wisdom adds one second.'
                : 'Every 60 Wisdom adds one second.'}
            </p>
            <p class="muted">The game uses 60 frames per second.</p>
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
                              <strong>{durationText(frames)}</strong>
                              <small>
                                {Number((spell.baseFrames / 60).toFixed(2))} seconds base +{' '}
                                {Number(((frames - spell.baseFrames) / 60).toFixed(2))} seconds from
                                Wisdom
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

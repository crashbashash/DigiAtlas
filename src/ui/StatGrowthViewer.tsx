import { useMemo, useRef, useState } from 'preact/hooks';
import { routes } from '../app/route';
import {
  GROWTH_BANDS,
  GROWTH_STATS,
  growthFactor,
  growthParameters,
  naturalGain,
  naturalStat,
  type DigimonForm,
  type GrowthStat,
} from '../data/stat-growth';
import { Link } from './common';
import { useApp } from './context';
import { FormulaHelp } from './FormulaHelp';
import { SearchPicker } from './SearchPicker';

const number = (text: string) => (text.trim() ? Number(text) : NaN);
const clampLevel = (level: number) => Math.max(1, Math.min(999, Math.trunc(level) || 1));
const fmt = (value: number) => (Number.isFinite(value) ? value.toLocaleString('en-US') : '—');
const gainText = (gain: number) =>
  Number.isFinite(gain) ? `${gain >= 0 ? '+' : ''}${fmt(gain)}` : '—';

interface GrowthRow {
  level: number;
  value: number;
  comparison?: number;
}

function GrowthChart({
  rows,
  form,
  comparison,
  label,
  level,
  onLevel,
}: {
  rows: GrowthRow[];
  form: DigimonForm;
  comparison?: DigimonForm;
  label: string;
  level: number;
  onLevel(level: number): void;
}) {
  const dragPointer = useRef<number | null>(null);
  const width = 960;
  const height = 310;
  const left = 76;
  const right = width - 24;
  const top = 20;
  const bottom = height - 44;
  const start = rows[0].level;
  const end = rows[rows.length - 1].level;
  const paddedPeak = Math.max(1, ...rows.flatMap((r) => [r.value, r.comparison ?? 0])) * 1.08;
  const roughStep = paddedPeak / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= roughStep)! * magnitude,
  );
  const maximum = Math.ceil(paddedPeak / step) * step;
  const statTicks = Array.from({ length: Math.round(maximum / step) + 1 }, (_, i) => i * step);
  const x = (n: number) =>
    start === end ? (left + right) / 2 : left + ((n - start) / (end - start)) * (right - left);
  const y = (n: number) => bottom - (n / maximum) * (bottom - top);
  const path = (key: 'value' | 'comparison') =>
    rows.map((row, i) => `${i === 0 ? 'M' : 'L'}${x(row.level)},${y(row[key]!)}`).join(' ');
  const ticks = [1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 999];
  const selected = rows.find((r) => r.level === level);
  return (
    <>
      <div class="growth-legend">
        {selected && <span class="muted">Level {level}</span>}
        <span>
          <i class="growth-primary-swatch" />
          {form.name}
          {selected && <strong>{fmt(selected.value)}</strong>}
        </span>
        {comparison && (
          <span>
            <i class="growth-comparison-swatch" />
            {comparison.name}
            {selected && <strong>{fmt(selected.comparison!)}</strong>}
          </span>
        )}
      </div>
      <svg
        class="growth-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label} from level ${start} to ${end}: ${form.name}${comparison ? ` compared with ${comparison.name}` : ''}. Use Inspect level to read exact values and gains.`}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            !event.isPrimary ||
            !(event.target instanceof Element) ||
            !event.target.closest('.growth-level-marker')
          )
            return;
          event.preventDefault();
          dragPointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragPointer.current !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - rect.left) / rect.width) * width;
          onLevel(
            Math.max(
              start,
              Math.min(
                end,
                Math.round(start + ((position - left) / (right - left)) * (end - start)),
              ),
            ),
          );
        }}
        onPointerUp={(event) => {
          if (dragPointer.current !== event.pointerId) return;
          dragPointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragPointer.current = null;
        }}
        onLostPointerCapture={() => {
          dragPointer.current = null;
        }}
      >
        {statTicks.map((value) => (
          <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} class="growth-grid-line" />
            <text x={left - 12} y={y(value) + 4} text-anchor="end">
              {fmt(value)}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={bottom + 25} text-anchor="middle">
            {tick}
          </text>
        ))}
        <path d={path('value')} class="growth-line growth-primary-line" />
        {comparison && <path d={path('comparison')} class="growth-line growth-comparison-line" />}
        {selected && (
          <g class="growth-level-marker">
            <title>Drag the line to inspect a level</title>
            <line x1={x(level)} x2={x(level)} y1={top} y2={bottom} class="growth-cursor-hit" />
            <line x1={x(level)} x2={x(level)} y1={top} y2={bottom} class="growth-cursor" />
            <circle cx={x(level)} cy={y(selected.value)} r={5} class="growth-primary-point" />
            {comparison && (
              <circle
                cx={x(level)}
                cy={y(selected.comparison!)}
                r={5}
                class="growth-comparison-point"
              />
            )}
          </g>
        )}
        {start === end && !selected && (
          <g>
            <circle cx={x(start)} cy={y(rows[0].value)} r={5} class="growth-primary-point" />
            {comparison && (
              <circle
                cx={x(start)}
                cy={y(rows[0].comparison!)}
                r={5}
                class="growth-comparison-point"
              />
            )}
          </g>
        )}
        <text x={(left + right) / 2} y={height - 2} text-anchor="middle">
          Level
        </text>
      </svg>
    </>
  );
}

export function StatGrowthViewer() {
  const { model, reimport } = useApp();
  const forms = model.raw.items.saveStats?.forms ?? [];
  const [species, setSpecies] = useState('');
  const [compareSpecies, setCompareSpecies] = useState('');
  const [stat, setStat] = useState<GrowthStat>('strength');
  const [levelText, setLevel] = useState('1');
  const form = forms.find((f) => String(f.species) === species) ?? forms[0];
  const comparison = forms.find((f) => String(f.species) === compareSpecies);
  const definition = GROWTH_STATS.find((s) => s.key === stat)!;
  const level = clampLevel(number(levelText));
  const parameters = form && growthParameters(form, stat);
  const comparisonParameters = comparison && growthParameters(comparison, stat);
  const dataReady = !!parameters && (!comparison || !!comparisonParameters);
  const rows = useMemo<GrowthRow[]>(() => {
    if (!form || !dataReady) return [];
    return Array.from({ length: 999 }, (_, i) => {
      const n = i + 1;
      return {
        level: n,
        value: naturalStat(form, stat, n),
        comparison: comparison ? naturalStat(comparison, stat, n) : undefined,
      };
    });
  }, [form, comparison, stat, dataReady]);
  const missingData =
    !forms.length || (form && GROWTH_STATS.some((s) => !growthParameters(form, s.key)));
  const chooseLevel = (n: number) => setLevel(String(clampLevel(n)));
  return (
    <div class="page power-page growth-page">
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          <Link to={routes.calculators()}>Calculators</Link>
        </nav>
        <h1>Stat growth</h1>
        <p class="muted">Explore natural stats from level 1 to 999 and compare Digimon forms.</p>
      </header>
      {missingData && (
        <p role="status">
          Reload your disc to view all seven stats. This import is missing growth data.
          {reimport && (
            <>
              {' '}
              <button type="button" class="link" onClick={reimport}>
                Re-import from disc
              </button>
            </>
          )}
        </p>
      )}
      {form && (
        <>
          <section class="section-card">
            <div class="growth-controls">
              <SearchPicker
                compact
                label="Digimon"
                value={String(form.species)}
                onChange={setSpecies}
                options={forms.map((f) => ({ value: String(f.species), label: f.name }))}
              />
              <SearchPicker
                compact
                label="Compare with"
                value={compareSpecies}
                onChange={setCompareSpecies}
                options={[
                  { value: '', label: 'No comparison' },
                  ...forms.map((f) => ({ value: String(f.species), label: f.name })),
                ]}
              />
              <SearchPicker
                compact
                label="Stat to graph"
                value={stat}
                onChange={(value) => setStat(value as GrowthStat)}
                options={GROWTH_STATS.map((s) => ({ value: s.key, label: s.label }))}
              />
            </div>
            <p class="muted">
              Starting stats and growth values come from your loaded disc. Equipment, permanent
              upgrades and temporary effects are excluded.
            </p>
          </section>
          <section class="section-card growth-level-section">
            <label class="power-field">
              Inspect level
              <input
                type="number"
                min={1}
                max={999}
                step={1}
                value={levelText}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  const next = value === '' ? '' : String(clampLevel(number(value)));
                  e.currentTarget.value = next;
                  setLevel(next);
                }}
                onBlur={() => chooseLevel(level)}
              />
            </label>
            <label class="growth-slider">
              <span class="visually-hidden">Inspect level slider</span>
              <input
                type="range"
                min={1}
                max={999}
                step={1}
                value={level}
                onInput={(e) => setLevel(e.currentTarget.value)}
              />
              <span class="growth-slider-labels">
                <span>1</span>
                <span>999</span>
              </span>
            </label>
          </section>
          <section aria-label={`Stats at level ${level}`}>
            <h2>
              {form.name} at level {level}
            </h2>
            <div class="growth-stat-cards">
              {GROWTH_STATS.map((s) => {
                const value = naturalStat(form, s.key, level);
                const gain = naturalGain(form, s.key, level);
                return (
                  <button
                    type="button"
                    key={s.key}
                    class={`section-card growth-stat-card${stat === s.key ? ' selected' : ''}`}
                    aria-pressed={stat === s.key}
                    onClick={() => setStat(s.key)}
                  >
                    <span>{s.label}</span>
                    <strong>{fmt(value)}</strong>
                    <small>
                      {level === 1 ? 'Starting value' : `${gainText(gain)} from level ${level - 1}`}
                    </small>
                    {comparison && (
                      <small class="growth-comparison-value">
                        {comparison.name}: {fmt(naturalStat(comparison, s.key, level))}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
          <section class="section-card growth-plot-section">
            <div class="formula-heading">
              <h2>{definition.label} by level</h2>
              <FormulaHelp
                title="Stat growth formula"
                terms={['truncate']}
                example={
                  parameters ? (
                    <>
                      <p>
                        {form.name} · {definition.label} · Level {level}
                      </p>
                      <p>
                        Starting value = {fmt(parameters.initial)} · Growth ={' '}
                        {fmt(parameters.growth)} · Level factor ={' '}
                        {fmt(growthFactor(level, definition.curve))}
                      </p>
                      <p class="formula-equation">
                        min({fmt(definition.cap)}, {fmt(parameters.initial)} + truncate(
                        {fmt(parameters.growth)} × {fmt(growthFactor(level, definition.curve))} /
                        100)) = {fmt(naturalStat(form, stat, level))}
                      </p>
                    </>
                  ) : (
                    <p>Choose a valid level and a stat with imported growth data.</p>
                  )
                }
              >
                <p class="formula-equation">
                  Stat = min(cap, starting value + truncate(growth × level factor / 100))
                </p>
                <p>
                  Every form uses the same level factors, with its own starting value and growth
                  coefficient. HP and MP cap at 99,999; the other stats cap at 9,999. Growth is
                  deterministic.
                </p>
                <p>
                  The factor is offset + rate × (level − origin), using the first row whose ceiling
                  includes the level. Gains use the difference between rounded, capped values at
                  consecutive levels.
                </p>
                <div class="power-table-wrap">
                  <table class="power-table growth-band-table">
                    <caption>Shared level factors</caption>
                    <thead>
                      <tr>
                        <th>Ceiling</th>
                        <th>Origin</th>
                        <th>HP/MP offset</th>
                        <th>HP/MP rate</th>
                        <th>Stat offset</th>
                        <th>Stat rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {GROWTH_BANDS.map((b) => (
                        <tr key={b.ceiling}>
                          <td>{b.ceiling}</td>
                          <td>{b.origin}</td>
                          <td>{fmt(b.hpOffset)}</td>
                          <td>{b.hpRate}</td>
                          <td>{b.statOffset}</td>
                          <td>{b.statRate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FormulaHelp>
            </div>
            {!dataReady && (
              <p role="status">
                Reload your disc to view {definition.label.toLowerCase()} growth for the selected
                forms.
              </p>
            )}
            {rows.length > 0 && (
              <>
                <GrowthChart
                  rows={rows}
                  form={form}
                  comparison={comparison}
                  label={definition.label}
                  level={level}
                  onLevel={chooseLevel}
                />
                <p class="muted growth-chart-hint">
                  Drag the vertical line or use Inspect level to see exact stats. Select a stat card
                  to change the graph.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

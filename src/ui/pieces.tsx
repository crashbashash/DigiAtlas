import { useState } from 'preact/hooks';
import { routes } from '../app/route';
import { categoryLabel, formatPercent, type DropTable } from '../data/logic';
import type { Enemy } from '../data/types';
import { Link } from './common';
import { useApp } from './context';

const fmt = (n: number): string => n.toLocaleString('en-US');

export function ItemLink({ itemKey }: { itemKey: string }) {
  const { model } = useApp();
  return (
    <Link to={routes.item(itemKey)} class="link">
      {model.itemLabel(itemKey)}
    </Link>
  );
}

/** Label/value pairs in two columns. */
export function StatGrid({ stats }: { stats: [string, number | string][] }) {
  return (
    <dl class="stats">
      {stats.map(([k, v]) => (
        <div>
          <dt>{k}</dt>
          <dd>{typeof v === 'number' ? fmt(v) : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EnemyStats({ enemy }: { enemy: Enemy }) {
  const s = enemy.stats;
  const r = enemy.resist;
  return (
    <div class="card">
      <StatGrid
        stats={[
          ['HP', enemy.hp],
          ['Strength', s.strength],
          ['Defense', s.defense],
          ['Wisdom', s.wisdom],
          ['Spirit', s.spirit],
          ['Speed', s.speed],
          ['EXP', s.exp],
          ...(enemy.rarity ? [['Crown rank', enemy.rarity] as [string, number]] : []),
        ]}
      />
      <div class="sub">Resistances</div>
      <StatGrid
        stats={[
          ['Fire', r.fire],
          ['Ice', r.ice],
          ['Thunder', r.thunder],
          ['Dark', r.dark],
          ['Stun', r.stun],
          ['Poison', r.poison],
        ]}
      />
    </div>
  );
}

/** Drops below this chance are folded away until asked for; long tables are mostly 0.5% chips. */
const RARE_PERCENT = 1;
const ALWAYS_SHOWN = 8;

export function DropTableView({ table, caption }: { table: DropTable; caption: string }) {
  const [all, setAll] = useState(false);
  if (!table.rows.length) return <p class="muted">Drops nothing.</p>;
  const common = table.rows.filter((r, i) => r.percent >= RARE_PERCENT || i < ALWAYS_SHOWN);
  const rare = table.rows.length - common.length;
  const rows = all ? table.rows : common;
  return (
    <div class="drops">
      <div class="sub">{caption}</div>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="pct">{formatPercent(r.percent)}</td>
              <td>
                <ItemLink itemKey={r.key} />
              </td>
              <td class="cat">{categoryLabel(r.category)}</td>
            </tr>
          ))}
          {rare > 0 && (
            <tr class="more-row">
              <td colSpan={3}>
                <button type="button" class="link" onClick={() => setAll(!all)} aria-expanded={all}>
                  {all
                    ? 'Show fewer'
                    : `Show ${rare} rarer drop${rare === 1 ? '' : 's'} (under ${RARE_PERCENT}% each)`}
                </button>
              </td>
            </tr>
          )}
          <tr class="nothing">
            <td class="pct">{formatPercent(table.nothingPercent)}</td>
            <td colSpan={2}>Nothing</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

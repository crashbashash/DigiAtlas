import type { Enemy, EnemyKind, Generator } from '../data/types';

/** One thing drawn on the map. A badge above 1 means that many enemies spawn there. */
export interface Marker {
  gi: number;
  x: number;
  z: number;
  kind: EnemyKind;
  label: string;
  detail: string;
  badge: number;
  /** For a spawner with more spots than enemies: where it can appear (world units). */
  zone: { radius: number; spots: [number, number][] } | null;
  /** For a radar spawner: how close you must get for it to start (world units). */
  trigger: { x: number; z: number; radius: number } | null;
}

/** How the spawner starts, in words for a tooltip. */
export function startText(g: Generator): string {
  if (g.trigger) return `Appears when you get within ${g.trigger.radius} units`;
  if (g.startMode === 'direct' || g.startMode === 'timer') return 'Started by a game script';
  return '';
}

/**
 * Markers that match how many enemies really spawn:
 *  - boxes, barrels and crates: one marker per placed object;
 *  - a spawner with more spots than enemies (it places only `count`): one marker with the count,
 *    at the middle of its spots, and a zone showing where it can appear;
 *  - otherwise one marker per spot, carrying a share of the total when it respawns in waves.
 */
export function makeMarkers(generators: Generator[], enemies: Map<number, Enemy>): Marker[] {
  const out: Marker[] = [];
  generators.forEach((g, gi) => {
    const e = enemies.get(g.row);
    const kind: EnemyKind = e?.kind ?? 'enemy';
    const label = e?.name ?? `Row ${g.row}`;
    const spots = g.spawns;
    const count = g.count;
    const stat = e && kind !== 'object' ? `HP ${e.hp.toLocaleString('en-US')}` : '';
    const start = kind === 'object' ? '' : startText(g);
    const trigger = g.trigger ? { x: g.trigger.center[0], z: g.trigger.center[2], radius: g.trigger.radius } : null;

    if (kind === 'object' || count === null || count < 1 || spots.length <= count) {
      const per = kind !== 'object' && count !== null && count > spots.length ? Math.round(count / spots.length) : 1;
      const detail = [
        stat && `${stat} · ${count ?? '?'} total`,
        per > 1 ? `${count} in total, over ${spots.length} spot${spots.length === 1 ? '' : 's'}` : '',
        start,
      ].filter(Boolean).join('\n');
      for (const [x, , z] of spots) out.push({ gi, x, z, kind, label, detail, badge: per, zone: null, trigger });
      return;
    }

    const cx = spots.reduce((n, p) => n + p[0], 0) / spots.length;
    const cz = spots.reduce((n, p) => n + p[2], 0) / spots.length;
    const radius = Math.max(10, ...spots.map((p) => Math.hypot(p[0] - cx, p[2] - cz)));
    out.push({
      gi, x: cx, z: cz, kind, label,
      detail: [`${stat} · ${count} total`, `Spawns ${count} among ${spots.length} spots here`, start].filter(Boolean).join('\n'),
      badge: count,
      trigger,
      zone: { radius, spots: spots.map((p) => [p[0], p[2]] as [number, number]) },
    });
  });
  return out;
}

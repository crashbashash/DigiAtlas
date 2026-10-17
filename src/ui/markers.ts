import { isUnused, startSummary } from '../data/logic';
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
  /** No script starts this spawner (only present when unused ones are shown). */
  unused: boolean;
  /** The spawner's other spots, which it does not use for its first enemies (world x, z). */
  others: [number, number][] | null;
  /** For a radar spawner: how close you must get for it to start (world units). */
  trigger: { x: number; z: number; radius: number } | null;
}

/**
 * Markers that match where enemies really spawn. The game places each enemy at the spawner's next
 * spot in list order (no randomness) and wraps around the list, so:
 *  - a spawner with more spots than enemies uses only its first `count` spots; the rest are kept in
 *    `others` to show on hover;
 *  - a spawner that spawns more than it has spots (respawn waves) uses every spot, each carrying a
 *    share of the total;
 *  - boxes, barrels and crates are one marker per placed object.
 * The game starts counting from the first spot (assumed; the code never sets the cursor).
 */
export function makeMarkers(
  generators: Generator[],
  enemies: Map<number, Enemy>,
  hideUnused = false,
  isBossFight: (g: Generator) => boolean = (g) => enemies.get(g.row)?.kind === 'boss',
): Marker[] {
  const out: Marker[] = [];
  generators.forEach((g, gi) => {
    const e = enemies.get(g.row);
    const kind: EnemyKind = isBossFight(g) ? 'boss' : (e?.kind ?? 'enemy');
    const label = e?.name ?? `Row ${g.row}`;
    const spots = g.spawns;
    const count = g.count;
    const stat = e && kind !== 'object' ? `HP ${e.hp.toLocaleString('en-US')}` : '';
    const unused = isUnused(g, e);
    if (unused && hideUnused) return;
    const start = startSummary(g, e);
    const trigger = g.trigger
      ? { x: g.trigger.center[0], z: g.trigger.center[2], radius: g.trigger.radius }
      : null;

    const partial = kind !== 'object' && count !== null && count >= 1 && spots.length > count;
    const used = partial ? spots.slice(0, count) : spots;
    const others = partial ? spots.slice(count).map((p) => [p[0], p[2]] as [number, number]) : null;
    const per =
      kind !== 'object' && count !== null && count > spots.length
        ? Math.round(count / spots.length)
        : 1;
    const detail = [
      stat && `${stat} · ${count ?? '?'} total`,
      partial
        ? `Spawns at the first ${count} of ${spots.length} spots (it places them in order)`
        : '',
      per > 1 ? `${count} in total, over ${spots.length} spot${spots.length === 1 ? '' : 's'}` : '',
      start,
    ]
      .filter(Boolean)
      .join('\n');
    for (const [x, , z] of used)
      out.push({ gi, x, z, kind, label, detail, badge: per, others, trigger, unused });
  });
  return out;
}

import { isUnused, startSummary } from '../data/logic';
import type { Difficulty, Enemy, EnemyKind, Generator, Stage } from '../data/types';
import type { Model, Scope } from '../data/model';

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

/** Distinct spawn groups at the same world position, including different enemies sharing a spot. */
export function markersAtSpot(markers: Marker[], spot: Marker): Marker[] {
  const seen = new Set<number>();
  return markers.filter((m) => {
    if (m.x !== spot.x || m.z !== spot.z || seen.has(m.gi)) return false;
    seen.add(m.gi);
    return true;
  });
}

/** Match drawing order: selected groups sit on top, then bosses, enemies and objects. */
export function markerRank(marker: Marker, selected: number | null): number {
  return (
    (marker.gi === selected ? 100 : 0) +
    (marker.kind === 'object' ? 0 : marker.kind === 'enemy' ? 1 : 2)
  );
}

/** Equal-distance hits choose the last drawn marker, so hover and clicks agree with the picture. */
export function pickMarker(
  markers: Marker[],
  project: (m: Marker) => [number, number],
  px: number,
  py: number,
  selected: number | null,
  radius: number,
): Marker | null {
  let best: Marker | null = null;
  let bestD = radius * radius;
  for (const m of markers) {
    const [sx, sy] = project(m);
    const distance = (sx - px) ** 2 + (sy - py) ** 2;
    if (
      distance <= bestD &&
      (distance < bestD || !best || markerRank(m, selected) >= markerRank(best, selected))
    ) {
      best = m;
      bestD = distance;
    }
  }
  return best;
}

/** Repeated clicks on a shared point reach every group without moving their real spawn positions. */
export function nextMarkerAtSpot(markers: Marker[], hit: Marker, selected: number | null): Marker {
  if (hit.gi !== selected) return hit;
  const groups = markersAtSpot(markers, hit);
  const index = groups.findIndex((m) => m.gi === selected);
  return groups[(index + 1) % groups.length] ?? hit;
}

/** Use the same active groups and stable generator indices as the map's side panel. */
export function stageMarkers(
  model: Model,
  stage: Stage,
  difficulty: Difficulty,
  scope: Scope,
): Marker[] {
  const inactive = model.hidden(stage, difficulty, { ...scope, hideUnused: true });
  return makeMarkers(model.generators(stage, difficulty, scope), model.enemies, false, (g) =>
    model.isBossFight(g),
  )
    .filter((m) => !scope.hideUnused || !inactive.has(m.gi))
    .map((m) => ({ ...m, unused: m.unused || inactive.has(m.gi) }));
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

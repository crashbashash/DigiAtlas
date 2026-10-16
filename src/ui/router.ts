import type { Model } from '../data/model';
import { DIFFICULTIES, type Difficulty } from '../data/types';
import type { Selection, State } from './state';

/** What the address bar (and saved view) can express: a stage, a difficulty and one thing selected. */
export interface View {
  stageId: string | null;
  difficulty: Difficulty | null;
  players: number | null;
  showUnused: boolean;
  item: string | null;
  enemy: string | null;
  spawner: string | null;
}

export function viewFromHash(hash: string): View {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(query);
  const d = q.get('d');
  return {
    stageId: path || null,
    difficulty: DIFFICULTIES.includes(d as Difficulty) ? (d as Difficulty) : null,
    players: [1, 2, 3, 4].includes(Number(q.get('p'))) ? Number(q.get('p')) : null,
    showUnused: q.get('u') === '1',
    item: q.get('item'),
    enemy: q.get('enemy'),
    spawner: q.get('spawner'),
  };
}

export function hashFor(model: Model, s: State): string {
  const q = new URLSearchParams({ d: s.difficulty });
  if (s.players !== 1) q.set('p', String(s.players));
  if (s.showUnused) q.set('u', '1');
  const sel = s.selection;
  if (sel.kind === 'item') q.set('item', sel.key);
  else if (sel.kind === 'species') q.set('enemy', sel.name);
  else if (sel.kind === 'generator' && s.stageId) {
    const stage = model.byId.get(s.stageId);
    const name = stage ? model.generators(stage, s.difficulty)[sel.index]?.name : undefined;
    if (name) q.set('spawner', name);
  }
  return `#/${s.stageId ?? ''}?${q.toString()}`;
}

/** Turn a parsed view back into state, ignoring anything that no longer exists in the data. */
export function stateFromView(model: Model, v: View, fallback: State): State {
  const stage = v.stageId ? model.byId.get(v.stageId) : undefined;
  const stageId = stage ? stage.id : fallback.stageId;
  const target = model.byId.get(stageId ?? '');
  const avail = target ? model.available(target) : [];
  const wanted = v.difficulty ?? (target && model.entryDifficulty(target)) ?? fallback.difficulty;
  const difficulty = avail.includes(wanted) ? wanted : (avail[0] ?? wanted);
  let selection: Selection = { kind: 'none' };
  if (v.item && model.items.has(v.item)) selection = { kind: 'item', key: v.item };
  else if (v.enemy && [...model.enemies.values()].some((e) => e.name === v.enemy)) selection = { kind: 'species', name: v.enemy };
  else if (v.spawner && target) {
    const index = model.generators(target, difficulty).findIndex((g) => g.name === v.spawner);
    if (index >= 0) selection = { kind: 'generator', index };
  }
  return { ...fallback, stageId, difficulty, players: v.players ?? fallback.players, showUnused: v.showUnused || fallback.showUnused, selection };
}

const KEY = 'digiatlas.view';

export function loadSaved(): Pick<View, 'stageId' | 'difficulty' | 'players'> | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Pick<View, 'stageId' | 'difficulty' | 'players'>) : null;
  } catch {
    return null;
  }
}

export function save(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ stageId: s.stageId, difficulty: s.difficulty, players: s.players }));
  } catch {
    /* storage can be unavailable; the view just is not remembered */
  }
}

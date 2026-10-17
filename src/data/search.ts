import type { Model } from './model';
import { categoryLabel } from './logic';

export type HitKind = 'item' | 'enemy' | 'room';

export interface Hit {
  kind: HitKind;
  /** Item key, enemy name or stage id: what the result opens. */
  id: string;
  label: string;
  detail: string;
  /** Lower is better: 0 exact, 1 prefix, 2 word start, 3 anywhere. */
  rank: number;
  /** For items: the category, so results can be filtered. */
  category?: string;
}

export interface Results {
  items: Hit[];
  enemies: Hit[];
  rooms: Hit[];
}

// Item names use Greek letters for tiers; let people type the Latin ones.
const GREEK: Record<string, string> = { α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', ω: 'w' };

/** Lower case, Greek tier letters spelled in Latin, and runs of spaces or punctuation as one space. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[αβγδεζω]/g, (c) => GREEK[c])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** How well `text` matches `query` (both normalized); null when it does not. */
export function matchRank(text: string, query: string): number | null {
  if (!query) return null;
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.includes(` ${query}`)) return 2;
  if (text.includes(query)) return 3;
  // Every word of the query found somewhere ("sword long", "hp disk a").
  const words = query.split(' ');
  return words.length > 1 && words.every((w) => text.includes(w)) ? 4 : null;
}

const byLabel = (a: Hit, b: Hit) => a.label.localeCompare(b.label);
const byRank = (a: Hit, b: Hit) =>
  a.rank - b.rank || a.label.length - b.label.length || a.label.localeCompare(b.label);

/**
 * Search everything a player can look up. With a `category`, only items of that category are
 * returned, and an empty query lists all of them.
 */
export function search(model: Model, query: string, category: string | null = null): Results {
  const q = normalize(query);
  const items: Hit[] = [];
  for (const [key, item] of model.items) {
    if (category && item.category !== category) continue;
    const label = model.itemLabel(key);
    const rank = q ? matchRank(normalize(label), q) : category ? 0 : null;
    // Within a category the category is a given; the weapon type or nothing says more.
    const detail = category ? (item.skillType ?? '') : categoryLabel(item.category);
    if (rank !== null)
      items.push({
        kind: 'item',
        id: key,
        label,
        detail,
        rank,
        category: item.category,
      });
  }
  // A whole category is a list to browse, so alphabetical; a search puts the best matches first.
  if (category) return { items: items.sort(q ? byRank : byLabel), enemies: [], rooms: [] };

  const enemies: Hit[] = [];
  if (q) {
    const species = new Map<string, { kind: string; variants: number; partOf?: string }>();
    for (const e of model.enemies.values()) {
      if (e.kind === 'object') continue;
      const s = species.get(e.name);
      if (s) s.variants += 1;
      else species.set(e.name, { kind: e.kind, variants: 1 });
    }
    // Names that are only a boss's parts say whose (Lucemon's orb: part of Lucemon).
    for (const [name, s] of species)
      if (model.isPartOnly(name)) s.partOf = model.speciesRows(name)[0].partOf;
    for (const [name, s] of species) {
      const rank = matchRank(normalize(name), q);
      if (rank === null) continue;
      const kind = s.partOf ? `Part of ${s.partOf}` : s.kind === 'boss' ? 'Boss' : 'Enemy';
      enemies.push({
        kind: 'enemy',
        id: name,
        label: name,
        detail: s.variants > 1 ? `${kind} · ${s.variants} stat variants` : kind,
        rank,
      });
    }
  }

  const rooms: Hit[] = [];
  if (q) {
    for (const w of model.worlds) {
      for (const r of w.rooms) {
        const rank = Math.min(
          matchRank(normalize(r.room), q) ?? 9,
          (matchRank(normalize(r.area), q) ?? 9) + 1,
        );
        if (rank < 9)
          rooms.push({ kind: 'room', id: r.stages[0].id, label: r.room, detail: r.area, rank });
      }
    }
  }
  return { items: items.sort(byRank), enemies: enemies.sort(byRank), rooms: rooms.sort(byRank) };
}

/** Item categories with how many items each has, in the game's order. */
export function itemCategories(model: Model): { category: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of model.items.values()) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  return [...counts].map(([category, count]) => ({
    category,
    label: categoryLabel(category),
    count,
  }));
}

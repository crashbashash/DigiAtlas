import type { DataSource } from '../data/source';
import type { Model } from '../data/model';
import {
  categoryLabel,
  fillModeText,
  formatPercent,
  groupByEnemy,
  startModeText,
  statLabel,
  type DropTable,
  type EnemyGroup,
} from '../data/logic';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty, type Enemy, type Generator, type Item, type Stage } from '../data/types';
import { clear, fmt, h } from './dom';
import { KIND_COLOR, KIND_LABEL } from './mapview';
import type { State } from './state';

export interface PanelActions {
  selectGenerator(index: number): void;
  selectGroup(row: number): void;
  selectItem(key: string): void;
  selectSpecies(name: string): void;
  goToStage(stageId: string): void;
  setDifficulty(d: Difficulty): void;
  clearSelection(): void;
}

const SOURCE_LIMIT = 40;

export class Panel {
  readonly el = h('aside', { class: 'panel' });
  private showAllSources = false;
  private sourceFilter: 'all' | 'enemy' | 'object' = 'all';
  private lastItem = '';

  constructor(
    private readonly model: Model,
    private readonly source: DataSource,
    private readonly act: PanelActions,
  ) {}

  render(state: State, stage: Stage | null): void {
    clear(this.el);
    const d = state.difficulty;
    const sel = state.selection;
    if (sel.kind === 'item') {
      if (sel.key !== this.lastItem) {
        this.showAllSources = false;
        this.sourceFilter = 'all';
      }
      this.lastItem = sel.key;
      this.el.append(...this.itemView(sel.key, d, stage));
    } else if (sel.kind === 'species') {
      this.el.append(...this.speciesView(sel.name, d));
    } else if (stage && sel.kind === 'generator') {
      this.el.append(...this.generatorView(stage, d, sel.index));
    } else if (stage && sel.kind === 'group') {
      this.el.append(...this.groupView(stage, d, sel.row));
    } else if (stage) {
      this.el.append(...this.overview(stage, d));
    } else {
      this.el.append(h('p', { class: 'muted' }, 'Pick a stage from the list to begin.'));
    }
    this.el.scrollTop = 0;
  }

  // --- shared pieces -------------------------------------------------------------------------

  private back(label = 'Stage overview'): HTMLElement {
    return h('button', { class: 'link back', onclick: () => this.act.clearSelection() }, `← ${label}`);
  }

  private itemLink(key: string, text?: string): HTMLElement {
    return h('button', { class: 'link', onclick: () => this.act.selectItem(key) }, text ?? this.model.itemLabel(key));
  }

  private enemyCard(e: Enemy | undefined, row: number): HTMLElement {
    if (!e) return h('p', { class: 'muted' }, `No stat data for row ${row}.`);
    const s = e.stats;
    const stat = (label: string, v: number | string) =>
      h('div', null, h('span', { class: 'k' }, label), h('span', { class: 'v' }, typeof v === 'number' ? fmt(v) : v));
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'stats' },
        stat('HP', e.hp),
        stat('Strength', s.strength),
        stat('Defense', s.defense),
        stat('Wisdom', s.wisdom),
        stat('Spirit', s.spirit),
        stat('Speed', s.speed),
        stat('EXP', s.exp),
        e.rarity ? stat('Crown rank', e.rarity) : null,
      ),
      h('div', { class: 'sub' }, 'Resistances'),
      h('div', { class: 'stats' },
        stat('Fire', e.resist.fire),
        stat('Ice', e.resist.ice),
        stat('Thunder', e.resist.thunder),
        stat('Dark', e.resist.dark),
        stat('Stun', e.resist.stun),
        stat('Poison', e.resist.poison),
      ),
    );
  }

  private titleFor(e: Enemy | undefined, row: number): HTMLElement {
    const kind = e?.kind ?? 'enemy';
    return h('h2', null, h('i', { class: 'dot', style: `background:${KIND_COLOR[kind]}` }), e?.name ?? `Unknown (row ${row})`,
      h('small', null, KIND_LABEL[kind]));
  }

  private dropTableEl(t: DropTable, caption: string): HTMLElement {
    if (!t.rows.length) return h('p', { class: 'muted' }, 'Drops nothing.');
    return h(
      'div',
      { class: 'drops' },
      h('div', { class: 'sub' }, caption),
      h('table', null,
        ...t.rows.map((r) => {
          return h('tr', null,
            h('td', { class: 'pct' }, formatPercent(r.percent)),
            h('td', null, this.itemLink(r.key)),
            h('td', { class: 'cat' }, categoryLabel(r.category)),
          );
        }),
        h('tr', { class: 'nothing' }, h('td', { class: 'pct' }, formatPercent(t.nothingPercent)), h('td', { colspan: 2 }, 'Nothing')),
      ),
    );
  }

  private groupSummary(g: EnemyGroup, d: Difficulty): HTMLElement {
    const name = g.enemy?.name ?? `Row ${g.row}`;
    const kind = g.enemy?.kind ?? 'enemy';
    const hp = g.enemy ? `HP ${fmt(g.enemy.hp)}${g.enemy.rarity ? ` · crown ${g.enemy.rarity}` : ''} · ` : '';
    const detail =
      g.enemy?.kind === 'object'
        ? `${g.spawners} placed`
        : `${hp}${g.spawners} spawner${g.spawners === 1 ? '' : 's'} · ${g.total} total`;
    void d;
    return h('button', { class: 'row', onclick: () => this.act.selectGroup(g.row) },
      h('i', { class: 'dot', style: `background:${KIND_COLOR[kind]}` }),
      h('span', { class: 'grow' }, name),
      h('span', { class: 'detail muted' }, detail),
    );
  }

  // --- views ---------------------------------------------------------------------------------

  private overview(stage: Stage, d: Difficulty): HTMLElement[] {
    const gens = this.model.generators(stage, d);
    const groups = groupByEnemy(gens, this.model.enemies);
    const byName = (a: EnemyGroup, b: EnemyGroup) =>
      (b.enemy?.kind === 'boss' ? 1 : 0) - (a.enemy?.kind === 'boss' ? 1 : 0) ||
      (a.enemy?.name ?? '').localeCompare(b.enemy?.name ?? '') ||
      (a.enemy?.hp ?? 0) - (b.enemy?.hp ?? 0);
    const fights = groups.filter((g) => g.enemy?.kind !== 'object').sort(byName);
    const objects = groups.filter((g) => g.enemy?.kind === 'object').sort(byName);
    const out: HTMLElement[] = [
      h('h2', null, this.model.stageTitle(stage), h('small', null, `${stage.area ?? ''} · ${DIFFICULTY_LABEL[d]}`)),
    ];
    out.push(
      h('div', { class: 'sub' }, `Enemies (${fights.length})`),
      h('div', { class: 'list' }, ...fights.map((g) => this.groupSummary(g, d))),
    );
    if (objects.length) {
      out.push(
        h('div', { class: 'sub' }, `Boxes, barrels and crates (${objects.length})`),
        h('div', { class: 'list' }, ...objects.map((g) => this.groupSummary(g, d))),
      );
    }
    out.push(
      h('p', { class: 'note' },
        'Markers show everything this stage can spawn, not what is there when you arrive. Enemies that come when you get close appear on their own; the rest are started by game scripts (traps, cutscenes, story progress, your Digimon or level, co-op), which are not shown yet. Spawners stacked on one spot are usually alternatives.'),
    );
    if (!stage.map) out.push(h('p', { class: 'note' }, 'No map is available for this stage; markers are plotted on a plain grid.'));
    return out;
  }

  private generatorView(stage: Stage, d: Difficulty, index: number): HTMLElement[] {
    const g: Generator | undefined = this.model.generators(stage, d)[index];
    if (!g) return [this.back(), h('p', { class: 'muted' }, 'That spawner is not on this difficulty.')];
    const e = this.model.enemies.get(g.row);
    const table = this.model.tableFor(g, d);
    const out: HTMLElement[] = [this.back(), this.titleFor(e, g.row)];
    const isObject = e?.kind === 'object';
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'facts' },
        h('div', null, h('span', { class: 'k' }, isObject ? 'Placed at' : 'Spots'), h('span', { class: 'v' }, `${g.spawns.length}`)),
        isObject ? null : h('div', null, h('span', { class: 'k' }, 'Total spawned'), h('span', { class: 'v' }, g.count === null ? '?' : `${g.count}`)),
        isObject ? null : h('div', null, h('span', { class: 'k' }, 'At once (max)'), h('span', { class: 'v' }, g.maxCount === null ? '?' : `${g.maxCount}`)),
      ),
      isObject
        ? null
        : h('p', { class: 'note' },
            `${startModeText(g.startMode)}.` +
              ((g.count ?? 0) > (g.maxCount ?? 0) ? ` ${fillModeText(g.fillMode)}.` : '') +
              (g.count !== null && g.spawns.length > g.count ? ` It has ${g.spawns.length} possible spots but places only ${g.count}.` : '')),
      h('div', { class: 'sub' }, `Stats (${DIFFICULTY_LABEL[d]})`),
      this.enemyCard(e, g.row),
      this.dropTableEl(table, `Drops (${DIFFICULTY_LABEL[d]}, per kill)`),
    ];
    out.push(...(parts.filter(Boolean) as HTMLElement[]));
    const last = this.model.tableFor(g, d, true);
    if (last.rows.length && JSON.stringify(last.rows) !== JSON.stringify(table.rows)) {
      out.push(this.dropTableEl(last, 'When it is the last one defeated'));
    }
    return out;
  }

  private groupView(stage: Stage, d: Difficulty, row: number): HTMLElement[] {
    const gens = this.model.generators(stage, d);
    const e = this.model.enemies.get(row);
    const group = groupByEnemy(gens, this.model.enemies).find((x) => x.row === row);
    const out: HTMLElement[] = [this.back(), this.titleFor(e, row)];
    if (group) {
      out.push(h('p', { class: 'note' },
        e?.kind === 'object'
          ? `${group.spawners} placed in this stage.`
          : `${group.spawners} spawner${group.spawners === 1 ? '' : 's'} at ${group.points} point${group.points === 1 ? '' : 's'}, ${group.total} spawned in total.`));
    }
    out.push(h('div', { class: 'sub' }, `Stats (${DIFFICULTY_LABEL[d]})`), this.enemyCard(e, row));
    // Spawners of one kind usually share a drop table; show each distinct one once.
    const seen = new Set<string>();
    for (const gi of group?.generators ?? []) {
      const g = gens[gi];
      const name = g.drops?.[d] ?? '';
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(this.dropTableEl(this.model.tableFor(g, d), `Drops (${DIFFICULTY_LABEL[d]}, per kill)`));
    }
    return out;
  }

  private itemView(key: string, d: Difficulty, stage: Stage | null): HTMLElement[] {
    const item: Item | undefined = this.model.items.get(key);
    if (!item) return [this.back(), h('p', { class: 'muted' }, 'Unknown item.')];
    const out: (HTMLElement | null)[] = [
      this.back(stage ? 'Back to stage' : 'Back'),
      h('h2', null, this.model.itemLabel(key), h('small', null, categoryLabel(item.category) + (item.skillType ? ` · ${item.skillType}` : ''))),
      item.description ? h('p', { class: 'desc' }, item.description) : null,
      item.stats
        ? h('div', { class: 'stats' },
            ...Object.entries(item.stats).map(([k, v]) => h('div', null, h('span', { class: 'k' }, statLabel(k)), h('span', { class: 'v' }, fmt(v)))))
        : null,
    ];
    const all = this.model.sourcesOf(key, d);
    if (!all.length) {
      out.push(h('div', { class: 'sub' }, `Dropped by (${DIFFICULTY_LABEL[d]})`));
      const elsewhere = DIFFICULTIES.filter((x) => x !== d && this.model.sourcesOf(key, x).length > 0);
      if (elsewhere.length) {
        out.push(
          h('p', { class: 'muted' }, `Nothing drops this on ${DIFFICULTY_LABEL[d]}. It does drop on:`),
          h('div', { class: 'list' }, ...elsewhere.map((x) =>
            h('button', { class: 'row', onclick: () => this.act.setDifficulty(x) },
              h('span', { class: 'grow' }, DIFFICULTY_LABEL[x]),
              h('span', { class: 'muted' }, `${this.model.sourcesOf(key, x).length} sources`)))),
        );
      } else {
        out.push(h('p', { class: 'muted' }, 'No enemy or object drops this on any difficulty. It may come from shops, quests or scripted rewards.'));
      }
      return out.filter(Boolean) as HTMLElement[];
    }

    const objects = all.filter((s) => s.kind === 'object').length;
    const sources = this.sourceFilter === 'all' ? all : all.filter((s) => (s.kind === 'object') === (this.sourceFilter === 'object'));
    const here = stage ? all.filter((s) => s.stage.id === stage.id).reduce((n, s) => n + s.generators.length, 0) : 0;
    const chip = (id: 'all' | 'enemy' | 'object', label: string, n: number) =>
      h('button', { class: 'chip' + (this.sourceFilter === id ? ' on' : ''), disabled: n === 0, onclick: () => { this.sourceFilter = id; this.showAllSources = false; this.act.selectItem(key); } }, `${label} ${n}`);
    out.push(
      h('div', { class: 'sub' }, `Dropped by (${DIFFICULTY_LABEL[d]})`),
      h('div', { class: 'filters' }, chip('all', 'All', all.length), chip('enemy', 'Enemies', all.length - objects), chip('object', 'Boxes & crates', objects)),
      stage ? h('p', { class: 'note' }, here ? `${here} spawner${here === 1 ? '' : 's'} on this map ${here === 1 ? 'is' : 'are'} highlighted.` : 'Nothing on this map drops it.') : null,
    );
    const shown = this.showAllSources ? sources : sources.slice(0, SOURCE_LIMIT);
    out.push(
      h('table', { class: 'sources' },
        h('tr', { class: 'head' }, h('th', { class: 'pct' }, 'Chance'), h('th', null, 'Dropped by'), h('th', null, 'Where')),
        ...shown.map((s) =>
          h('tr', { class: s.stage.id === stage?.id ? 'here' : '' },
            h('td', { class: 'pct' }, formatPercent(s.percent)),
            h('td', null, s.enemyName, s.generators.length > 1 ? h('span', { class: 'muted' }, ` ×${s.generators.length}`) : null),
            h('td', null, h('button', { class: 'link', title: s.stage.area ?? '', onclick: () => this.act.goToStage(s.stage.id) }, this.model.stageTitle(s.stage))),
          )),
      ),
    );
    if (sources.length > shown.length) {
      out.push(h('button', { class: 'more', onclick: () => { this.showAllSources = true; this.act.selectItem(key); } }, `Show all ${sources.length}`));
    }
    return out.filter(Boolean) as HTMLElement[];
  }

  private speciesView(name: string, d: Difficulty): HTMLElement[] {
    const rows = [...this.model.enemies.values()].filter((e) => e.name === name);
    const kind = rows[0]?.kind ?? 'enemy';
    const rowSet = new Set(rows.map((r) => r.row));
    const found = this.model.stages
      .map((s) => ({ s, gens: this.model.generators(s, d).filter((g) => rowSet.has(g.row)) }))
      .filter((x) => x.gens.length > 0);
    // Which stat rows this enemy actually uses on this difficulty, weakest first.
    const used = new Map<number, number>();
    for (const { gens } of found) for (const g of gens) used.set(g.row, (used.get(g.row) ?? 0) + 1);
    const variants = [...used.keys()].map((r) => this.model.enemies.get(r)!).filter(Boolean).sort((a, b) => a.hp - b.hp);

    const out: (HTMLElement | null)[] = [
      this.back('Back'),
      h('h2', null, h('i', { class: 'dot', style: `background:${KIND_COLOR[kind]}` }), name, h('small', null, KIND_LABEL[kind])),
    ];
    if (variants.length) {
      const num = (n: number) => h('td', { class: 'n' }, fmt(n));
      out.push(
        h('div', { class: 'sub' }, `Stats (${DIFFICULTY_LABEL[d]})`),
        h('table', { class: 'variants' },
          h('tr', null, h('th', { class: 'l' }, 'Variant'), ...['HP', 'Str', 'Def', 'Wis', 'Spi', 'Spd', 'EXP'].map((c) => h('th', null, c))),
          ...variants.map((e) =>
            h('tr', null, h('td', { class: 'l' }, e.rarity ? `Crown ${e.rarity}` : 'Base', h('span', { class: 'muted' }, ` ×${used.get(e.row)}`)), num(e.hp), num(e.stats.strength), num(e.stats.defense), num(e.stats.wisdom), num(e.stats.spirit), num(e.stats.speed), num(e.stats.exp))),
        ),
        variants.length > 1
          ? h('p', { class: 'note' }, `${variants.length} stat variants appear (area tiers and crown ranks). Open a stage and click a marker for the exact one, resistances included.`)
          : null,
      );
    }
    out.push(h('div', { class: 'sub' }, `Found in (${DIFFICULTY_LABEL[d]})`));
    if (!found.length) out.push(h('p', { class: 'muted' }, 'Not spawned anywhere on this difficulty.'));
    out.push(
      h('div', { class: 'list' },
        ...found.map(({ s, gens }) =>
          h('button', { class: 'row', onclick: () => this.act.goToStage(s.id) },
            h('span', { class: 'grow' }, this.model.stageTitle(s)),
            h('span', { class: 'detail muted' }, `${gens.length} spawner${gens.length === 1 ? '' : 's'} · ${gens.reduce((n, g) => n + (g.count ?? 0), 0)} total`),
          )),
      ),
    );
    return out.filter(Boolean) as HTMLElement[];
  }
}

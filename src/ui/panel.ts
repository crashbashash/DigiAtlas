import type { DataSource } from '../data/source';
import { traderLabel, type Model } from '../data/model';
import {
  categoryLabel,
  fillModeText,
  scriptRefText,
  formatPercent,
  groupByEnemy,
  itemKey,
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
  showUnused(show: boolean): void;
  openItem(key: string): void;
  clearSelection(): void;
}

const SOURCE_LIMIT = 40;

export class Panel {
  readonly el = h('aside', { class: 'panel' });
  private showAllSources = false;
  private sourceFilter: 'all' | 'enemy' | 'object' = 'all';
  private sourcesOpen = false;
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
    if (sel.kind === 'item' && stage) {
      // The item card lives in its own window; here the map highlights the droppers.
      this.el.append(...this.overview(stage, d));
    } else if (sel.kind === 'item') {
      this.el.append(...this.itemInfo(sel.key), ...this.mapsList(sel.key, d), ...this.tradesList(sel.key));
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
    const hiddenSet = this.model.hidden(stage, d);
    const groups = groupByEnemy(gens, this.model.enemies, hiddenSet);
    const byName = (a: EnemyGroup, b: EnemyGroup) =>
      (b.enemy?.kind === 'boss' ? 1 : 0) - (a.enemy?.kind === 'boss' ? 1 : 0) ||
      (a.enemy?.name ?? '').localeCompare(b.enemy?.name ?? '') ||
      (a.enemy?.hp ?? 0) - (b.enemy?.hp ?? 0);
    const fights = groups.filter((g) => g.enemy?.kind !== 'object').sort(byName);
    const objects = groups.filter((g) => g.enemy?.kind === 'object').sort(byName);
    const out: HTMLElement[] = [
      h('h2', null, this.model.stageTitle(stage), h('small', null, `${stage.area ?? ''}${this.model.available(stage).length ? ` · ${DIFFICULTY_LABEL[d]}` : ''}${gens.length && this.model.players > 1 ? ` · ${this.model.players} players` : ''}`)),
    ];
    if (this.model.tradersAt(stage, d).length) out.push(...this.tradersBlock(stage, d));
    if (!gens.length) {
      out.push(h('p', { class: 'note' }, 'No enemies or breakable objects spawn here.'));
      return out;
    }
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
        'Markers show every enemy spawn in the stage. Some only appear after game events such as traps, cutscenes or story progress.'),
    );
    if (hiddenSet.size) {
      out.push(
        h('p', { class: 'note' },
          `${hiddenSet.size} spawner${hiddenSet.size === 1 ? ' is' : 's are'} left out because no game script starts ${hiddenSet.size === 1 ? 'it' : 'them'}. `,
          h('button', { class: 'link', onclick: () => this.act.showUnused(true) }, 'Show them')),
      );
    }
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
              (g.count !== null && g.spawns.length > g.count ? ` It has ${g.spawns.length} spots in its list and places its first ${g.count}, in order.` : '')),
      isObject ? null : this.startBlock(g),
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

  /** What makes a spawner start, from its trigger circle and the stage's scripts. */
  private startBlock(g: Generator): HTMLElement {
    const info = g.script;
    const lines: string[] = [];
    if (g.trigger) {
      lines.push(`Starts by itself when you get within ${g.trigger.radius} units of its anchor.`);
    } else if (g.startMode === 'direct' || g.startMode === 'timer') {
      if (!info || info.status === 'referenced') lines.push('Started by a game script:');
      else if (info.status === 'none') lines.push('No script in this stage starts it, so it most likely never appears.');
      else if (info.status === 'dynamic') lines.push('A script starts spawners in a loop by building their names, and this one fits the pattern:');
      else lines.push('A script in this stage starts spawners by a name it builds in code, so it cannot be told whether this one is started.');
    }
    const refs = info?.refs ?? [];
    if (g.trigger && refs.length) lines.push('Scripts also control it:');
    return h('div', { class: 'starts' },
      h('div', { class: 'sub' }, 'What starts it'),
      ...lines.map((t) => h('p', { class: 'note tight' }, t)),
      refs.length ? h('ul', null, ...refs.map((r) => h('li', null, scriptRefText(r)))) : null,
    );
  }

  private groupView(stage: Stage, d: Difficulty, row: number): HTMLElement[] {
    const gens = this.model.generators(stage, d);
    const e = this.model.enemies.get(row);
    const group = groupByEnemy(gens, this.model.enemies, this.model.hidden(stage, d)).find((x) => x.row === row);
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

  /** The item card: name, description and stats. This is all the popout window shows. */
  private itemInfo(key: string): HTMLElement[] {
    const item: Item | undefined = this.model.items.get(key);
    if (!item) return [h('p', { class: 'muted' }, 'Unknown item.')];
    const out: (HTMLElement | null)[] = [
      h('h2', null, this.model.itemLabel(key), h('small', null, categoryLabel(item.category) + (item.skillType ? ` · ${item.skillType}` : ''))),
      item.description ? h('p', { class: 'desc' }, item.description) : null,
      item.stats
        ? h('div', { class: 'stats' },
            ...Object.entries(item.stats).map(([k, v]) => h('div', null, h('span', { class: 'k' }, statLabel(k)), h('span', { class: 'v' }, fmt(v)))))
        : null,
    ];
    return out.filter(Boolean) as HTMLElement[];
  }

  /** The Digimon in a shop room and what each one swaps on the chosen difficulty. */
  private tradersBlock(stage: Stage, d: Difficulty): HTMLElement[] {
    const traders = this.model.tradersAt(stage, d);
    const total = traders.reduce((n, t) => n + (t.tables[d]?.length ?? 0), 0);
    return [
      h('div', { class: 'sub' }, `Traders (${traders.length}) · ${total} trades`),
      h('p', { class: 'note' }, `Hand a trader the item on the left and they give you the one on the right. Each stands where its pin is on the map, and what it swaps depends on the difficulty (${DIFFICULTY_LABEL[d]} is shown).`),
      ...traders.map((t, i) =>
        h('details', { class: 'trader', 'data-trader': String(i) },
          h('summary', null, traderLabel(t), h('span', { class: 'muted' }, ` · ${t.tables[d]!.length} trades`)),
          h('div', { class: 'list' },
            ...t.tables[d]!.map((o) =>
              h('div', { class: 'trade' },
                h('button', { class: 'link', onclick: () => this.act.selectItem(itemKey(o.give.category, o.give.id)) }, this.model.itemLabel(itemKey(o.give.category, o.give.id))),
                h('span', { class: 'arrow muted' }, '→'),
                h('button', { class: 'link', onclick: () => this.act.selectItem(itemKey(o.get.category, o.get.id)) }, this.model.itemLabel(itemKey(o.get.category, o.get.id))))))),
      ),
    ];
  }

  /** Open one trader's list and bring it into view (a pin was clicked on the map). */
  revealTrader(index: number): void {
    const el = this.el.querySelector<HTMLDetailsElement>(`details.trader[data-trader="${index}"]`);
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  }

  /** Traders who give an item, and ones who take it, listed in the item window. */
  private tradesList(key: string): HTMLElement[] {
    const { getFrom, giveTo } = this.model.tradesFor(key);
    const rows = (links: ReturnType<Model['tradesFor']>['getFrom'], verb: string) =>
      links.map((t) =>
        h('button', { class: 'row', onclick: () => this.act.goToStage(t.stage.id) },
          h('span', { class: 'grow' }, `${t.label} · ${verb} ${t.other}`),
          h('span', { class: 'muted' }, `${this.model.stageTitle(t.stage).replace(/ \((Normal|Hard|Very Hard)\)$/, '')}${t.difficulties.length < DIFFICULTIES.length ? ` · ${t.difficulties.map((x) => DIFFICULTY_LABEL[x]).join(', ')}` : ''}`)));
    const out: HTMLElement[] = [];
    if (getFrom.length) out.push(h('div', { class: 'sub' }, `Trade for it (${getFrom.length})`), h('div', { class: 'list maps' }, ...rows(getFrom, 'wants')));
    if (giveTo.length) out.push(h('div', { class: 'sub' }, `Trade it in (${giveTo.length})`), h('div', { class: 'list maps' }, ...rows(giveTo, 'gives')));
    return out;
  }

  /** The maps an item drops in; clicking one opens it in the main window with the droppers highlighted. */
  private mapsList(key: string, d: Difficulty): HTMLElement[] {
    const maps = this.model.mapsFor(key, d);
    const where = `${DIFFICULTY_LABEL[d]}${this.model.players > 1 ? ` · ${this.model.players} players` : ''}`;
    if (!maps.length) {
      return [
        h('div', { class: 'sub' }, `Drops in (${where})`),
        h('p', { class: 'muted' }, `No enemy or object drops this on ${where}.`),
      ];
    }
    return [
      h('div', { class: 'sub' }, `Drops in ${maps.length} map${maps.length === 1 ? '' : 's'}, best chance first (${where})`),
      h('div', { class: 'list maps' },
        ...maps.map((m, i) =>
          h('button', { class: 'row', title: m.droppedBy.join(', '), onclick: () => this.act.goToStage(m.stage.id) },
            h('span', { class: 'rank muted' }, `${i + 1}.`),
            h('span', { class: 'grow' }, this.model.stageTitle(m.stage), m.stage.area ? h('span', { class: 'muted' }, ` · ${m.stage.area}`) : null),
            h('span', { class: 'pct' }, formatPercent(m.percent)),
            h('span', { class: 'detail muted' }, m.droppedBy.slice(0, 4).join(', ') + (m.droppedBy.length > 4 ? ` +${m.droppedBy.length - 4}` : '')),
          )),
      ),
    ];
  }

  private speciesView(name: string, d: Difficulty): HTMLElement[] {
    const rows = [...this.model.enemies.values()].filter((e) => e.name === name);
    const kind = rows[0]?.kind ?? 'enemy';
    const rowSet = new Set(rows.map((r) => r.row));
    const found = this.model.stages
      .map((s) => {
        const hidden = this.model.hidden(s, d);
        return { s, gens: this.model.generators(s, d).filter((g, i) => rowSet.has(g.row) && !hidden.has(i)) };
      })
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

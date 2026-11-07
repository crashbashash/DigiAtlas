import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { routes, type MapSelection } from '../../app/route';
import {
  fillModeText,
  formatPercent,
  groupByEnemy,
  itemKey,
  scriptRefText,
  startModeText,
  type EnemyGroup,
} from '../../data/logic';
import { traderLabel } from '../../data/model';
import {
  doorActivations,
  doorEnemyGroups,
  doorLabel,
  doorSummary,
  platformLabel,
  platformMovements,
  platformSummary,
  visibleDoors,
  visiblePlatforms,
} from '../../data/doors';
import {
  DIFFICULTY_LABEL,
  type Difficulty,
  type Enemy,
  type Generator,
  type Stage,
  type Platform,
} from '../../data/types';
import { Empty, KindDot, Link, settingsText } from '../common';
import { useApp } from '../context';
import { DOOR_COLOR, PLATFORM_COLOR, KIND_LABEL, SERVICE_COLOR } from '../mapview';
import { DropTableView, EnemyStats, ItemLink, variantLabel } from '../pieces';

const fmt = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A selection after the spawner's name has been matched to its index on this difficulty. */
export type Resolved =
  | { kind: 'none' }
  | { kind: 'door'; id: string }
  | { kind: 'platform'; id: string }
  | { kind: 'train'; id: string }
  | { kind: 'generator'; index: number }
  | { kind: 'group'; row: number }
  | { kind: 'item'; key: string }
  | { kind: 'species'; name: string };

export interface PanelProps {
  stage: Stage;
  difficulty: Difficulty;
  selection: Resolved;
  /** Spawners on this stage that drop the selected item. */
  itemSpawners: number;
  /** A trader pin that was clicked: open its list. `n` changes on every click so the same pin can flash again. */
  reveal: { kind: 'trader' | 'service'; index: number; n: number } | null;
  select(sel: MapSelection): void;
}

/** The right-hand panel of the map page: the stage overview, or whatever is selected on it. */
export function StagePanel(props: PanelProps) {
  const { stage, selection: sel } = props;
  const scroller = useRef<HTMLElement>(null);
  const identity = `${stage.id}|${JSON.stringify(sel)}`;
  // Back to the top for a new stage or selection, not when a setting changes underneath.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [identity]);

  return (
    <aside class="panel" ref={scroller} aria-label="Details">
      {sel.kind === 'item' && <ItemBanner {...props} itemKey={sel.key} />}
      {sel.kind === 'generator' && <SpawnerView {...props} index={sel.index} />}
      {sel.kind === 'group' && <GroupView {...props} row={sel.row} />}
      {sel.kind === 'species' && <SpeciesView {...props} name={sel.name} />}
      {sel.kind === 'door' && <DoorView {...props} id={sel.id} />}
      {sel.kind === 'platform' && <DoorView {...props} id={sel.id} platform />}
      {sel.kind === 'train' && <TrainView {...props} id={sel.id} />}
      {(sel.kind === 'none' || sel.kind === 'item') && <Overview {...props} />}
    </aside>
  );
}

function Back({
  select,
  label = 'Stage overview',
}: {
  select: PanelProps['select'];
  label?: string;
}) {
  return (
    <button type="button" class="link back" onClick={() => select({ kind: 'none' })}>
      ← {label}
    </button>
  );
}

function Title({ enemy, fallback }: { enemy: Enemy | undefined; fallback: string }) {
  const kind = enemy?.kind ?? 'enemy';
  return (
    <>
      <h2>
        <KindDot kind={kind} />
        {enemy?.name ?? fallback}
        <small>{KIND_LABEL[kind]}</small>
      </h2>
      {enemy && kind !== 'object' && (
        <p class="to-page">
          <Link to={routes.enemy(enemy.name)}>Enemy page: every room, all drops →</Link>
        </p>
      )}
    </>
  );
}

// --- item ------------------------------------------------------------------------------------

/** What the selected item has to do with this stage, and where to go if the answer is nothing. */
function ItemBanner({
  stage,
  difficulty: d,
  itemKey: key,
  itemSpawners,
  select,
}: PanelProps & { itemKey: string }) {
  const { model, settings, scope } = useApp();
  const here = useMemo(
    () => model.sourcesOf(key, d, scope).filter((s) => s.stage.id === stage.id),
    [model, key, d, scope, stage.id],
  );
  const traders = model
    .tradersAt(stage, d)
    .filter((t) =>
      (t.tables[d] ?? []).some((o) =>
        [o.give, o.get].some((x) => itemKey(x.category, x.id) === key),
      ),
    );
  const best = useMemo(
    () => model.mapsFor(key, d, scope).find((m) => m.stage.id !== stage.id),
    [model, key, d, scope, stage.id],
  );
  const names = [...new Set(here.map((s) => s.enemyName))];
  const bestHere = Math.max(0, ...here.map((s) => s.percent));
  return (
    <section class="item-banner" aria-label="Selected item">
      <div class="item-banner-head">
        <div>
          <div class="sub">Showing on the map</div>
          <strong>
            <ItemLink itemKey={key} />
          </strong>
        </div>
        <button
          type="button"
          class="icon"
          title="Clear (Esc)"
          aria-label="Clear the item"
          onClick={() => select({ kind: 'none' })}
        >
          ×
        </button>
      </div>
      {itemSpawners > 0 ? (
        <p>
          Dropped here by {names.join(', ')}, best <strong>{formatPercent(bestHere)}</strong> per
          kill ({plural(itemSpawners, 'spawner')} highlighted).
        </p>
      ) : (
        <p>Nothing drops it in this room on {settingsText(d, settings.players)}.</p>
      )}
      {traders.length > 0 && (
        <p>{plural(traders.length, 'trader')} here deal in it (highlighted pins).</p>
      )}
      {itemSpawners === 0 && best && (
        <p>
          Best chance elsewhere:{' '}
          <Link to={routes.map(best.stage.id, { kind: 'item', key }, true)}>
            {model.stageTitle(best.stage)}
          </Link>
          , {formatPercent(best.percent)}.
        </p>
      )}
      <p class="item-banner-actions">
        <Link to={routes.item(key, 'drops')}>Every place it drops</Link>
        <Link to={routes.item(key)}>Item details</Link>
      </p>
    </section>
  );
}

// --- overview --------------------------------------------------------------------------------

/** Spawn groups of one enemy name: crown ranks and area tiers share a name and are one row here. */
interface Species {
  name: string;
  enemy: Enemy | undefined;
  groups: EnemyGroup[];
}

function bySpecies(groups: EnemyGroup[]): Species[] {
  const out = new Map<string, Species>();
  for (const g of groups) {
    const name = g.enemy?.name ?? `Row ${g.row}`;
    const s = out.get(name);
    if (s) s.groups.push(g);
    else out.set(name, { name, enemy: g.enemy, groups: [g] });
  }
  for (const s of out.values()) s.groups.sort((a, b) => (a.enemy?.hp ?? 0) - (b.enemy?.hp ?? 0));
  return [...out.values()].sort(
    (a, b) =>
      Number(b.enemy?.kind === 'boss') - Number(a.enemy?.kind === 'boss') ||
      a.name.localeCompare(b.name),
  );
}

function groupDetail(g: EnemyGroup): string {
  if (g.enemy?.kind === 'object') return `${g.spawners} placed`;
  const label = g.enemy?.form ?? (g.enemy?.rarity ? `crown ${g.enemy.rarity}` : '');
  const hp = g.enemy ? `HP ${fmt(g.enemy.hp)}${label ? ` · ${label}` : ''} · ` : '';
  const part = g.enemy?.role === 'part' ? `Part of ${g.enemy.partOf} · ` : '';
  return `${part}${hp}${plural(g.spawners, 'spawner')} · ${g.total} total`;
}

function SpeciesRow({ s, select }: { s: Species; select: PanelProps['select'] }) {
  const [open, setOpen] = useState(false);
  const kind = s.enemy?.kind ?? 'enemy';
  if (s.groups.length === 1) {
    const g = s.groups[0];
    return (
      <button type="button" class="row" onClick={() => select({ kind: 'group', row: g.row })}>
        <KindDot kind={kind} />
        <span class="grow">{s.name}</span>
        <span class="detail muted">{groupDetail(g)}</span>
      </button>
    );
  }
  const hps = s.groups.map((g) => g.enemy?.hp ?? 0);
  const spawners = s.groups.reduce((n, g) => n + g.spawners, 0);
  const total = s.groups.reduce((n, g) => n + g.total, 0);
  return (
    <div class="species">
      <div class="species-head">
        <button type="button" class="row" onClick={() => select({ kind: 'species', name: s.name })}>
          <KindDot kind={kind} />
          <span class="grow">{s.name}</span>
          <span class="detail muted">
            {s.groups.length} variants · HP {fmt(Math.min(...hps))}–{fmt(Math.max(...hps))} ·{' '}
            {plural(spawners, 'spawner')} · {total} total
          </span>
        </button>
        <button
          type="button"
          class="expand"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${s.name} variants`}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <div class="variants">
          {s.groups.map((g) => (
            <button type="button" class="row" onClick={() => select({ kind: 'group', row: g.row })}>
              <span class="grow">{g.enemy ? variantLabel(g.enemy) : 'Base'}</span>
              <span class="detail muted">{groupDetail(g)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Overview({ stage, difficulty: d, reveal, select }: PanelProps) {
  const { model, scope, settings, setSettings } = useApp();
  const gens = model.generators(stage, d, scope);
  const hidden = model.hidden(stage, d, scope);
  const species = bySpecies(groupByEnemy(gens, model.enemies, hidden));
  const fights = species.filter((s) => s.enemy?.kind !== 'object');
  const objects = species.filter((s) => s.enemy?.kind === 'object');
  const doors = visibleDoors(stage);
  const platforms = visiblePlatforms(stage, d, settings.players);
  return (
    <>
      {stage.train && <TrainOverview stage={stage} select={select} />}
      {doors.length > 0 && (
        <section aria-label="Doors and gates">
          <h3 class="sub">Doors and gates ({doors.length})</h3>
          <p class="note">Select a door to see what opens it and highlight its linked triggers.</p>
          {doors.map((door) => (
            <button
              type="button"
              class="row"
              onClick={() => select({ kind: 'door', id: door.id })}
              key={door.id}
            >
              <i class="dot" style={{ background: DOOR_COLOR }} aria-hidden="true" />
              <span class="grow">{doorLabel(door, stage)}</span>
              <span class="detail muted">{doorSummary(door, stage, d, settings.players)}</span>
            </button>
          ))}
        </section>
      )}
      {platforms.length > 0 && (
        <section aria-label="Moving platforms">
          <h3 class="sub">Moving platforms ({platforms.length})</h3>
          <p class="note">Select a platform to see its movements and linked triggers.</p>
          {platforms.map((platform) => (
            <button
              type="button"
              class="row"
              key={platform.id}
              onClick={() => select({ kind: 'platform', id: platform.id })}
            >
              <i class="dot" style={{ background: PLATFORM_COLOR }} aria-hidden="true" />
              <span class="grow">{platformLabel(platform, stage)}</span>
              <span class="detail muted">
                {platformSummary(platform, stage, d, settings.players)}
              </span>
            </button>
          ))}
        </section>
      )}
      {model.tradersAt(stage, d).length > 0 && (
        <Traders stage={stage} difficulty={d} reveal={reveal} />
      )}
      {!!stage.services?.length && <Services stage={stage} reveal={reveal} />}
      {gens.length > 0 && (
        <>
          <h3 class="sub">Enemies ({fights.length})</h3>
          <div class="list">
            {fights.map((s) => (
              <SpeciesRow s={s} select={select} />
            ))}
          </div>
          {objects.length > 0 && (
            <>
              <h3 class="sub">Boxes, barrels and crates ({objects.length})</h3>
              <div class="list">
                {objects.map((s) => (
                  <SpeciesRow s={s} select={select} />
                ))}
              </div>
            </>
          )}
          {hidden.size > 0 && (
            <p class="note">
              {hidden.size} spawner{hidden.size === 1 ? ' is' : 's are'} left out because
              {hidden.size === 1 ? ' it is' : ' they are'} unused or inactive on this difficulty.{' '}
              <button type="button" class="link" onClick={() => setSettings({ showUnused: true })}>
                Show them
              </button>
            </p>
          )}
        </>
      )}
      {!stage.map && (
        <p class="note">No map is available for this stage; markers are plotted on a plain grid.</p>
      )}
    </>
  );
}

function TrainOverview({ stage, select }: Pick<PanelProps, 'stage' | 'select'>) {
  const train = stage.train!;
  return (
    <section aria-label="Train controls and route">
      <h3>Train route</h3>
      <p>
        Choose the train’s direction by hitting the arrow signs. Straight is selected by default at
        each junction.
      </p>
      <button type="button" class="row" onClick={() => select({ kind: 'train', id: 'route' })}>
        <span class="grow">Fastest route directions to Power Plant</span>
        <span class="detail muted">{train.steps.length} steps</span>
      </button>
      <details>
        <summary>All train controls ({train.controls.length})</summary>
        {[...train.controls]
          .sort((a, b) => a.junction - b.junction || a.label.localeCompare(b.label))
          .map((control) => (
            <button
              type="button"
              class="row"
              key={control.id}
              onClick={() => select({ kind: 'train', id: control.id })}
            >
              <span class="grow">{control.label}</span>
            </button>
          ))}
      </details>
    </section>
  );
}

function TrainView({ stage, id, select }: PanelProps & { id: string }) {
  const train = stage.train!;
  const control = train.controls.find((c) => c.id === id);
  if (id !== 'route' && !control)
    return (
      <>
        <Back select={select} />
        <Empty>This train control is not in the imported data.</Empty>
      </>
    );
  if (control) {
    const visit = train.steps.findIndex((s) => s.controlId === control.id);
    const best = train.steps
      .map((s) => train.controls.find((c) => c.id === s.controlId)!)
      .find((c) => c.junction === control.junction);
    return (
      <section class="train-details" aria-label="Train control">
        <Back select={select} />
        <h2>{control.label}</h2>
        <p>
          The purple branch leads toward {control.previewDestination}. The orange line continues to
          show the fastest route.
        </p>
        {control.choice === 'gate' ? (
          <p>Hit this post before the barrier to open the gate and continue along the route.</p>
        ) : (
          <>
            <p>
              Hit this arrow while its junction’s controls are active. The choice takes effect when
              the train leaves that junction’s trigger area.
            </p>
            <p>
              Selecting one arrow deselects its opposite. The next junction starts with straight
              selected. All players share the choice.
            </p>
          </>
        )}
        <p>
          {visit >= 0
            ? `Fastest route: step ${visit + 1}. ${train.steps[visit].instruction}.`
            : best
              ? `Fastest route here: ${best.choice === 'straight' ? 'continue straight' : `turn ${best.choice}`}.`
              : 'The fastest route bypasses this junction.'}
        </p>
        <button type="button" class="link" onClick={() => select({ kind: 'train', id: 'route' })}>
          Show the full fastest route
        </button>
      </section>
    );
  }
  return (
    <section class="train-details" aria-label="Fastest train route">
      <Back select={select} />
      <h2>Fastest train route</h2>
      <p>
        Follow these choices in order from departure to Power Plant. The numbered controls and
        orange line match the steps below.
      </p>
      <p class="note">
        Optimises rail travel time. Hit the required arrows before their junction passes, and hit
        both gate posts.
      </p>
      <ol class="train-steps">
        {train.steps.map((step, index) => {
          const control = train.controls.find((c) => c.id === step.controlId)!;
          return (
            <li key={step.controlId} class="card">
              <button
                type="button"
                class="link"
                onClick={() => select({ kind: 'train', id: control.id })}
              >
                {index + 1}. {step.instruction}
              </button>
              <p class="sub">{control.label}</p>
              {control.choice === 'straight' && <p class="note">Leave straight selected.</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DoorView({
  stage,
  difficulty,
  id,
  select,
  platform = false,
}: PanelProps & { id: string; platform?: boolean }) {
  const { model, settings, scope } = useApp();
  const door = platform
    ? visiblePlatforms(stage).find((p) => p.id === id)
    : visibleDoors(stage).find((door) => door.id === id);
  if (!door)
    return (
      <>
        <Back select={select} />
        <Empty>This {platform ? 'platform' : 'door'} is not in the imported data.</Empty>
      </>
    );
  const movements = platform
    ? platformMovements(door as Platform, difficulty, settings.players)
    : [
        {
          id: 'door',
          label: 'Opens when',
          activations: doorActivations(door, difficulty, settings.players),
        },
      ];
  const generators = model.generators(stage, difficulty, scope);
  const groupNumbers = new Map(
    [
      ...doorEnemyGroups(
        movements.flatMap((m) => m.activations),
        generators,
        model.enemies,
      ),
    ]
      .sort((a, b) => a - b)
      .map((index, n) => [index, n + 1]),
  );
  return (
    <section
      class="door-details"
      aria-label={platform ? 'Platform movement conditions' : 'Door opening conditions'}
    >
      <Back select={select} />
      <h2>
        <i
          class="dot"
          style={{ background: platform ? PLATFORM_COLOR : DOOR_COLOR }}
          aria-hidden="true"
        />
        {platform ? platformLabel(door as Platform, stage) : doorLabel(door, stage)}
      </h2>
      <p class="note">
        {platform
          ? 'The marker shows the platform’s starting position. Each movement has an identified trigger.'
          : 'The selected door is outlined on the map.'}{' '}
        Linked controls and enemy groups are highlighted.
      </p>
      {groupNumbers.size > 1 && (
        <p class="note">
          Group numbers match the map. Groups that share a spawn location share a map label.
        </p>
      )}
      {!movements.length && <p>No movement is available for these settings.</p>}
      {movements.map((movement) => {
        const activations = movement.activations;
        return (
          <section key={movement.id} aria-label={movement.label}>
            <h3>{movement.label}</h3>
            {!activations.length && (
              <p>Opening condition has not been identified for these settings.</p>
            )}
            {activations.map((activation, index) => {
              const groups = [
                ...doorEnemyGroups([{ ...activation, enemyModels: [] }], generators, model.enemies),
              ];
              const deathNames = [
                ...new Set(
                  activation.enemyModels.flatMap((modelName) => {
                    const names = [...model.enemies.values()]
                      .filter((enemy) => enemy.model === modelName)
                      .map((enemy) => enemy.name);
                    return names.length ? names : ['the linked enemy'];
                  }),
                ),
              ];
              return (
                <div class="card door-activation" key={index}>
                  {activations.length > 1 && (
                    <div class="sub">
                      {index === 0 ? 'Either' : 'Or'} · Option {index + 1}
                    </div>
                  )}
                  {activation.description && <p>{activation.description}</p>}
                  {activation.areas?.map((area) => (
                    <p key={area.id}>
                      {area.event === 'leave'
                        ? area.allPlayers
                          ? 'Move at least one player out of'
                          : 'Leave'
                        : area.allPlayers
                          ? 'Move all players into'
                          : 'Enter'}{' '}
                      <strong>{area.label}</strong>.
                    </p>
                  ))}
                  {activation.switches.some((s) => !s.action || s.action === 'activate') && (
                    <p>
                      Activate{' '}
                      {activation.switches
                        .filter((s) => !s.action || s.action === 'activate')
                        .map((s) => s.label)
                        .join(' and ')}
                      . Follow the dashed lines to their map markers.
                    </p>
                  )}
                  {activation.switches.some((s) => s.action === 'break') && (
                    <p>
                      Break{' '}
                      {activation.switches
                        .filter((s) => s.action === 'break')
                        .map((s) => s.label)
                        .join(' and ')}
                      . Follow the dashed lines to their map markers.
                    </p>
                  )}
                  {activation.switches.some((s) => s.action === 'hold') && (
                    <p>
                      Stand on{' '}
                      {activation.switches
                        .filter((s) => s.action === 'hold')
                        .map((s) => s.label)
                        .join(' and ')}
                      {activation.switches.filter((s) => s.action === 'hold').length > 1
                        ? ' at the same time'
                        : ''}
                      . Keep the required buttons held until the gate opens.
                    </p>
                  )}
                  {activation.switches.some((s) => s.action === 'destroy') && (
                    <p>
                      Destroy{' '}
                      {activation.switches
                        .filter((s) => s.action === 'destroy')
                        .map((s) => s.label)
                        .join(' and ')}{' '}
                      at the highlighted marker.
                    </p>
                  )}
                  {activation.items.length > 0 && (
                    <div>
                      <p>Carry all of these key items:</p>
                      <ul>
                        {activation.items.map((item) => (
                          <li key={itemKey(item.category, item.id)}>
                            <ItemLink itemKey={itemKey(item.category, item.id)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {groups.length > 0 && (
                    <div>
                      <p>Defeat the enemies in all linked groups:</p>
                      <ul>
                        {groups.map((i) => {
                          const g = generators[i];
                          const enemy = model.enemies.get(g.row);
                          return (
                            <li key={g.name}>
                              <button
                                type="button"
                                class="link"
                                onClick={() => select({ kind: 'spawner', name: g.name })}
                              >
                                Group {groupNumbers.get(i)} · {enemy?.name ?? 'Enemy group'}
                                {g.count !== null
                                  ? ` · ${g.count} ${enemy?.kind === 'object' ? 'objects' : g.count === 1 ? 'enemy' : 'enemies'}`
                                  : ''}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {deathNames.length > 0 && (
                    <p>
                      Defeat {deathNames.join(' and ')}. Matching spawn locations are highlighted on
                      the map.
                    </p>
                  )}
                  {activation.generators.length > 0 && groups.length === 0 && (
                    <p>The linked enemy group is not present on this difficulty.</p>
                  )}
                  {activation.conditions.map((condition) => (
                    <p class="note" key={condition}>
                      {condition}
                    </p>
                  ))}
                  {activation.unresolved && (
                    <p class="note">
                      {platform
                        ? 'The movement has a linked trigger; some additional scripted conditions are only partly identified.'
                        : 'The opening condition is only partly identified from the game scripts.'}
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </section>
  );
}

/** Service pins reveal their matching NPC and purpose in the keyboard-accessible list. */
function Services({ stage, reveal }: { stage: Stage; reveal: PanelProps['reveal'] }) {
  const refs = useRef<(HTMLDetailsElement | null)[]>([]);
  useEffect(() => {
    if (!reveal || reveal.kind !== 'service') return;
    const el = refs.current[reveal.index];
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [reveal]);
  return (
    <section aria-label="Service NPCs">
      <h3 class="sub">Services ({stage.services!.length})</h3>
      <p class="note">Select a green map pin to find its service here.</p>
      {stage.services!.map((npc, i) => (
        <details
          class="service-npc"
          key={npc.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <summary>
            <i class="dot" style={{ background: SERVICE_COLOR }} aria-hidden="true" /> {npc.label}
          </summary>
          <p class="note">
            <strong>{npc.name}</strong> · {npc.description}
          </p>
        </details>
      ))}
    </section>
  );
}

/** The Digimon in a shop room and what each one swaps on the chosen difficulty. */
function Traders({
  stage,
  difficulty: d,
  reveal,
}: {
  stage: Stage;
  difficulty: Difficulty;
  reveal: PanelProps['reveal'];
}) {
  const { model } = useApp();
  const traders = model.tradersAt(stage, d);
  const total = traders.reduce((n, t) => n + (t.tables[d]?.length ?? 0), 0);
  const refs = useRef<(HTMLDetailsElement | null)[]>([]);
  useEffect(() => {
    if (!reveal || reveal.kind !== 'trader') return;
    const el = refs.current[reveal.index];
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  }, [reveal]);
  return (
    <>
      <h3 class="sub">
        Traders ({traders.length}) · {total} trades
      </h3>
      <p class="note">
        Hand a trader the item on the left and they give you the one on the right. Each stands where
        its pin is on the map; what it swaps depends on the difficulty ({DIFFICULTY_LABEL[d]} is
        shown).
      </p>
      {traders.map((t, i) => (
        <details
          class="trader"
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <summary>
            {traderLabel(t)}
            <span class="muted"> · {t.tables[d]!.length} trades</span>
          </summary>
          <div class="list">
            {t.tables[d]!.map((o) => (
              <div class="trade">
                <ItemLink itemKey={itemKey(o.give.category, o.give.id)} />
                <span class="arrow muted">→</span>
                <ItemLink itemKey={itemKey(o.get.category, o.get.id)} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

// --- spawners and enemies ----------------------------------------------------------------------

/** What makes a spawner start, from its trigger circle and the stage's scripts. */
function StartBlock({ g }: { g: Generator }) {
  const info = g.script;
  const lines: string[] = [];
  if (g.trigger) {
    lines.push(`Starts by itself when you get within ${g.trigger.radius} units of its anchor.`);
  } else if (g.startMode === 'direct' || g.startMode === 'timer') {
    if (!info || info.status === 'referenced') lines.push('Started by a game script:');
    else if (info.status === 'none')
      lines.push('No script in this stage starts it, so it most likely never appears.');
    else if (info.status === 'dynamic')
      lines.push(
        'A script starts spawners in a loop by building their names, and this one fits the pattern:',
      );
    else
      lines.push(
        'A script in this stage starts spawners by a name it builds in code, so it cannot be told whether this one is started.',
      );
  }
  const refs = info?.refs ?? [];
  if (g.trigger && refs.length) lines.push('Scripts also control it:');
  return (
    <div class="starts">
      <h3 class="sub">What starts it</h3>
      {lines.map((t) => (
        <p class="note tight">{t}</p>
      ))}
      {refs.length > 0 && (
        <ul>
          {refs.map((r) => (
            <li>{scriptRefText(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpawnerView({ stage, difficulty: d, index, select }: PanelProps & { index: number }) {
  const { model, scope } = useApp();
  const g = model.generators(stage, d, scope)[index];
  if (!g) return <Back select={select} />;
  const e = model.enemies.get(g.row);
  const table = model.tableFor(g, d);
  const last = model.tableFor(g, d, true);
  const isObject = e?.kind === 'object';
  const fact = (k: string, v: string) => (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  return (
    <>
      <Back select={select} />
      <Title enemy={e} fallback={`Unknown (row ${g.row})`} />
      <dl class="facts">
        {fact(isObject ? 'Placed at' : 'Spots', `${g.spawns.length}`)}
        {!isObject && fact('Total spawned', g.count === null ? '?' : `${g.count}`)}
        {!isObject && fact('At once (max)', g.maxCount === null ? '?' : `${g.maxCount}`)}
      </dl>
      {!isObject && (
        <p class="note">
          {startModeText(g.startMode)}.
          {(g.count ?? 0) > (g.maxCount ?? 0) && ` ${fillModeText(g.fillMode)}.`}
          {g.count !== null &&
            g.spawns.length > g.count &&
            ` It has ${g.spawns.length} spots in its list and places its first ${g.count}, in order.`}
        </p>
      )}
      {!isObject && <StartBlock g={g} />}
      <h3 class="sub">Stats ({DIFFICULTY_LABEL[d]})</h3>
      {e ? <EnemyStats enemy={e} /> : <p class="muted">No stat data for row {g.row}.</p>}
      <DropTableView table={table} caption={`Drops (${DIFFICULTY_LABEL[d]}, per kill)`} />
      {last.rows.length > 0 && JSON.stringify(last.rows) !== JSON.stringify(table.rows) && (
        <DropTableView table={last} caption="When it is the last one defeated" />
      )}
    </>
  );
}

function GroupView({ stage, difficulty: d, row, select }: PanelProps & { row: number }) {
  const { model, scope } = useApp();
  const gens = model.generators(stage, d, scope);
  const e = model.enemies.get(row);
  const group = groupByEnemy(gens, model.enemies, model.hidden(stage, d, scope)).find(
    (x) => x.row === row,
  );
  // Spawners of one kind usually share a drop table; show each distinct one once.
  const tables = new Map<string, Generator>();
  for (const gi of group?.generators ?? []) {
    const name = gens[gi].drops?.[d] ?? '';
    if (!tables.has(name)) tables.set(name, gens[gi]);
  }
  return (
    <>
      <Back select={select} />
      <Title enemy={e} fallback={`Unknown (row ${row})`} />
      {group && (
        <p class="note">
          {e?.kind === 'object'
            ? `${group.spawners} placed in this stage.`
            : `${plural(group.spawners, 'spawner')} at ${plural(group.points, 'point')}, ${group.total} spawned in total.`}
        </p>
      )}
      <h3 class="sub">Stats ({DIFFICULTY_LABEL[d]})</h3>
      {e ? <EnemyStats enemy={e} /> : <p class="muted">No stat data for row {row}.</p>}
      {[...tables.values()].map((g) => (
        <DropTableView
          table={model.tableFor(g, d)}
          caption={`Drops (${DIFFICULTY_LABEL[d]}, per kill)`}
        />
      ))}
    </>
  );
}

function SpeciesView({ difficulty: d, name, select }: PanelProps & { name: string }) {
  const { model, scope } = useApp();
  const rows = [...model.enemies.values()].filter((e) => e.name === name);
  const kind = rows[0]?.kind ?? 'enemy';
  const rowSet = new Set(rows.map((r) => r.row));
  const found = model.stages
    .map((s) => {
      const hidden = model.hidden(s, d, scope);
      return {
        s,
        gens: model.generators(s, d, scope).filter((g, i) => rowSet.has(g.row) && !hidden.has(i)),
      };
    })
    .filter((x) => x.gens.length > 0);
  // Which stat rows this enemy actually uses on this difficulty, weakest first.
  const used = new Map<number, number>();
  for (const { gens } of found) for (const g of gens) used.set(g.row, (used.get(g.row) ?? 0) + 1);
  const variants = [...used.keys()]
    .map((r) => model.enemies.get(r)!)
    .filter(Boolean)
    .sort((a, b) => a.hp - b.hp);
  if (!rows.length) return <Empty>No enemy is called {name}.</Empty>;
  return (
    <>
      <Back select={select} label="Back" />
      <h2>
        <KindDot kind={kind} />
        {name}
        <small>{KIND_LABEL[kind]}</small>
      </h2>
      <p class="to-page">
        <Link to={routes.enemy(name)}>Enemy page: every room, all drops →</Link>
      </p>
      {variants.length > 0 && (
        <>
          <h3 class="sub">Stats ({DIFFICULTY_LABEL[d]})</h3>
          <div class="table-scroll">
            <table class="variants">
              <thead>
                <tr>
                  <th class="l">Variant</th>
                  {['HP', 'Str', 'Def', 'Wis', 'Spi', 'Spd', 'EXP'].map((c) => (
                    <th>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variants.map((e) => (
                  <tr>
                    <td class="l">
                      {variantLabel(e)}
                      <span class="muted"> ×{used.get(e.row)}</span>
                    </td>
                    {[
                      e.hp,
                      e.stats.strength,
                      e.stats.defense,
                      e.stats.wisdom,
                      e.stats.spirit,
                      e.stats.speed,
                      e.stats.exp,
                    ].map((n) => (
                      <td class="n">{fmt(n)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {variants.length > 1 && (
            <p class="note">
              {variants.length} stat variants appear (area tiers and crown ranks). Click a marker
              for the exact one, resistances included.
            </p>
          )}
        </>
      )}
      <h3 class="sub">Found in ({DIFFICULTY_LABEL[d]})</h3>
      {!found.length && <p class="muted">Not spawned anywhere on this difficulty.</p>}
      <div class="list">
        {found.map(({ s, gens }) => (
          <Link to={routes.map(s.id, { kind: 'species', name })} class="row">
            <span class="grow">{model.stageTitle(s)}</span>
            <span class="detail muted">
              {plural(gens.length, 'spawner')} · {gens.reduce((n, g) => n + (g.count ?? 0), 0)}{' '}
              total
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

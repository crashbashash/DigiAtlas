import type { Difficulty, Door, DoorActivation, Enemy, Generator, Platform, Stage } from './types';

/** Physical roles of the authored models; activation requirements supply the remaining names. */
const MODEL_NAMES: Record<string, string> = {
  g_gobgatez01: 'Fortress entrance',
  g_brossgatez01: 'Blossomon arena gate',
  g_circlegatez03: 'Arena ring gate',
  g_covergatez05: 'Lab barrier',
  g_factgatez06: 'River gate',
  g_scorpiongatez02: 'Scorpiomon arena gate',
  g_dbossgate: 'Boss gate',
  g_bossgatez01: 'Boss entrance',
  g_bossgatez02: 'Boss entrance',
  g_bossgatez03: 'Boss entrance',
  g_entrywayz04: 'Starship boarding door',
  g_entrywaybz04: 'Starship door model',
  g_sandgate: 'Train barrier',
};

export function visibleDoors(stage: Stage): Door[] {
  return (stage.doors ?? []).filter((door) => door.model !== 'g_traingatez02');
}

function baseDoorName(door: Door, stage: Stage): string {
  if (MODEL_NAMES[door.model]) return MODEL_NAMES[door.model];

  const switches = [...new Set(door.activations.flatMap((a) => a.switches.map((s) => s.label)))];
  const items = door.activations.some((a) => a.items.length > 0);
  const enemies = door.activations.some((a) => a.generators.length > 0 || a.enemyModels.length > 0);
  const noun =
    door.model === 'g_breakinggatez05' ? 'barrier' : door.model.includes('gate') ? 'gate' : 'door';
  if (items) return `Key item ${noun}`;
  if (switches.length && enemies) return `Encounter ${noun}`;
  if (switches.length === 1) return `${switches[0]} ${noun}`;
  if (switches.length > 1) {
    const type = switches.every((s) => s.startsWith('Button '))
      ? 'Button puzzle'
      : switches.every((s) => s.startsWith('Lever '))
        ? 'Lever puzzle'
        : 'Switch puzzle';
    return `${type} ${noun}`;
  }
  if (enemies) return `Enemy clear ${noun}`;
  if (door.model.startsWith('g_dgate')) return 'Arena barrier';
  if (door.model === 'g_breakinggatez05') return 'Fortress barrier';
  if (door.model === 'g_breakdoorz03') return 'Control panel door';
  if (door.model === 'g_sandgate') return 'Train barrier';
  return stage.kind === 'dungeon' ? 'Dungeon door' : 'Gate';
}

/** Names stay stable across difficulty and party changes. Only duplicate roles need a number. */
export function doorLabel(door: Door, stage: Stage): string {
  const name = baseDoorName(door, stage);
  const matches = visibleDoors(stage).filter((d) => baseDoorName(d, stage) === name);
  return matches.length > 1 ? `${name} ${matches.findIndex((d) => d.id === door.id) + 1}` : name;
}

export function hasAssignedTrigger(activation: DoorActivation): boolean {
  return !!(
    activation.areas?.length ||
    activation.switches.length ||
    activation.generators.length ||
    activation.enemyModels.length ||
    activation.items.length
  );
}

export function visiblePlatforms(stage: Stage, difficulty?: Difficulty, players = 1): Platform[] {
  return (stage.platforms ?? []).filter(
    (p) =>
      p.movements.length > 0 &&
      p.movements.every(
        (m) => m.activations.length > 0 && m.activations.every(hasAssignedTrigger),
      ) &&
      (!difficulty || platformMovements(p, difficulty, players).length > 0),
  );
}

export function platformMovements(platform: Platform, difficulty: Difficulty, players: number) {
  return platform.movements
    .map((m) => ({
      ...m,
      activations: uniqueActivations(
        m.activations.filter(
          (a) =>
            a.difficulties.includes(difficulty) &&
            a.players.includes(players) &&
            hasAssignedTrigger(a),
        ),
      ),
    }))
    .filter((m) => m.activations.length > 0);
}

export function platformLabel(platform: Platform, stage: Stage): string {
  const name = platform.label;
  const matches = visiblePlatforms(stage).filter((p) => p.label === name);
  return matches.length > 1
    ? `${name} ${matches.findIndex((p) => p.id === platform.id) + 1}`
    : name;
}

/** A compact requirement beside each name and in its map tooltip. */
export function doorSummary(
  door: Door,
  stage: Stage,
  difficulty: Difficulty,
  players: number,
): string {
  void stage;
  const routes = doorActivations(door, difficulty, players).map((a) => {
    const parts: string[] = [];
    for (const area of a.areas ?? [])
      parts.push(
        area.event === 'leave'
          ? `Leave ${area.label}`
          : area.allPlayers
            ? `All players enter ${area.label}`
            : `Enter ${area.label}`,
      );
    const controls = a.switches.filter((s) => !s.action || s.action === 'activate');
    const objects = a.switches.filter((s) => s.action === 'destroy');
    const broken = a.switches.filter((s) => s.action === 'break');
    const held = a.switches.filter((s) => s.action === 'hold');
    if (controls.length) parts.push(`Activate ${controls.map((s) => s.label).join(' and ')}`);
    if (objects.length) parts.push(`Destroy ${objects.map((s) => s.label).join(' and ')}`);
    if (broken.length) parts.push(`Break ${broken.map((s) => s.label).join(' and ')}`);
    if (held.length)
      parts.push(
        `Stand on ${held.map((s) => s.label).join(' and ')}${held.length > 1 ? ' at the same time' : ''}`,
      );
    if (a.generators.length || a.enemyModels.length) parts.push('Defeat linked enemies');
    if (a.items.length)
      parts.push(
        a.items.length === 1 ? 'Key item required' : `${a.items.length} key items required`,
      );
    if (a.conditions.length) parts.push('Story progress required');
    if (!parts.length) return 'Opening trigger not identified';
    return `${parts.join(' · ')}${a.unresolved ? ' · partly identified' : ''}`;
  });
  return [...new Set(routes)].join(' or ') || 'No opening trigger identified';
}

export function platformSummary(
  platform: Platform,
  stage: Stage,
  difficulty: Difficulty,
  players: number,
): string {
  return doorSummary(
    {
      ...platform,
      activations: platformMovements(platform, difficulty, players).flatMap((m) => m.activations),
    },
    stage,
    difficulty,
    players,
  );
}

export function doorActivations(
  door: Door,
  difficulty: Difficulty,
  players: number,
): DoorActivation[] {
  return uniqueActivations(
    door.activations.filter(
      (a) => a.difficulties.includes(difficulty) && a.players.includes(players),
    ),
  );
}

/** Merge script/model variants that ask the player to perform the same physical actions. */
export function uniqueActivations(activations: DoorActivation[]): DoorActivation[] {
  const out = new Map<string, DoorActivation>();
  const switchKey = (s: DoorActivation['switches'][number]) =>
    JSON.stringify([s.label, s.position, s.action ?? 'activate']);
  for (const activation of activations) {
    const switches = [...new Map(activation.switches.map((s) => [switchKey(s), s])).values()].sort(
      (a, b) => a.label.localeCompare(b.label),
    );
    const generators = [...new Set(activation.generators)].sort();
    const enemyModels = [...new Set(activation.enemyModels)].sort();
    const items = [
      ...new Map(activation.items.map((i) => [`${i.category}:${i.id}`, i])).values(),
    ].sort((a, b) => a.category.localeCompare(b.category) || a.id - b.id);
    const conditions = [...new Set(activation.conditions)].sort();
    const areas = activation.areas ?? [];
    const key = JSON.stringify({
      switches: switches.map(switchKey),
      generators,
      enemyModels,
      items,
      conditions,
      description: activation.description,
      areas: areas.map((a) => JSON.stringify([a.bounds, a.event ?? 'enter', a.allPlayers])).sort(),
    });
    const previous = out.get(key);
    if (previous) {
      previous.unresolved &&= activation.unresolved;
      continue;
    }
    out.set(key, { ...activation, switches, generators, enemyModels, items, conditions });
  }
  return [...out.values()];
}

/** Names remain linked to the imported generators, including Crown Mod's replacement enemies. */
export function doorEnemyGroups(
  activations: DoorActivation[],
  generators: Generator[],
  enemies: Map<number, Enemy>,
): Set<number> {
  const names = new Set(activations.flatMap((a) => a.generators));
  const models = new Set(activations.flatMap((a) => a.enemyModels));
  return new Set(
    generators.flatMap((g, i) =>
      names.has(g.name) || models.has(enemies.get(g.row)?.model ?? '') ? [i] : [],
    ),
  );
}

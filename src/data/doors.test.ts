import { describe, expect, it } from 'vitest';
import {
  doorActivations,
  doorEnemyGroups,
  doorLabel,
  doorSummary,
  visibleDoors,
  visiblePlatforms,
  platformMovements,
} from './doors';
import type { Door, DoorActivation, Enemy, Generator, Stage, Platform } from './types';

const activation = (overrides: Partial<DoorActivation> = {}): DoorActivation => ({
  areas: [],
  difficulties: ['normal', 'hard', 'veryhard'],
  players: [1, 2, 3, 4],
  switches: [],
  generators: [],
  enemyModels: [],
  items: [],
  conditions: [],
  description: null,
  unresolved: false,
  ...overrides,
});

const door = (model: string, instance: number, activations: DoorActivation[] = []): Door => ({
  id: `${model}:${instance}`,
  label: 'Gate 1',
  model,
  instance,
  activations,
  position: { x: instance * 50, y: 0, z: 0 },
  facing: 0,
});
const stage = (doors: Door[], id = 'dng101b1'): Stage => ({ id, kind: 'dungeon', doors }) as Stage;

describe('door names', () => {
  it('excludes the train models from Mummy Desert and older imported data', () => {
    const boarding = door('g_traingatez02', 0, [activation({ unresolved: true })]);
    const model = door('g_traingatez02', 1);
    const mummy = stage([boarding, model], 'stag0201');
    expect(visibleDoors(mummy)).toEqual([]);
  });

  it('does not treat the reused Power Plant train models as boarding doors', () => {
    const first = door('g_traingatez02', 0);
    const second = door('g_traingatez02', 1);
    const plant = stage([first, second], 'stag0205');
    expect(visibleDoors(plant)).toEqual([]);
  });

  it('uses known switch identity and numbers only repeated roles', () => {
    const button = door('g_d1door', 0, [
      activation({
        switches: [
          { id: 'g_dbutton:1', label: 'Button 2', position: { x: 100, y: 0, z: 0 }, facing: 0 },
        ],
      }),
    ]);
    const battle = door('g_d1door', 1, [activation({ generators: ['GENE-01'] })]);
    const other = door('g_d1door', 2, [activation({ generators: ['GENE-02'] })]);
    const room = stage([button, battle, other]);
    expect(doorLabel(button, room)).toBe('Button 2 door');
    expect(doorLabel(battle, room)).toBe('Enemy clear door 1');
    expect(doorLabel(other, room)).toBe('Enemy clear door 2');
    expect(doorSummary(button, room, 'normal', 1)).toBe('Activate Button 2');
  });

  it('keeps the physical name stable when settings change the available opening route', () => {
    const gate = door('g_bossgatez01', 0, [
      activation({ difficulties: ['hard'], generators: ['GENE-01'] }),
    ]);
    const room = stage([gate], 'stag0104');
    expect(doorLabel(gate, room)).toBe('Boss entrance');
    expect(doorSummary(gate, room, 'normal', 1)).toBe('No opening trigger identified');
    expect(doorSummary(gate, room, 'hard', 1)).toBe('Defeat linked enemies');
    expect(doorLabel(gate, room)).toBe('Boss entrance');
  });
});

describe('moving platforms', () => {
  const platform = (activations: DoorActivation[]): Platform => ({
    ...door('g_lift01z01', 0, activations),
    movements: [{ id: 'SQ_SWON', label: 'Move platform', destination: null, activations }],
  });
  it('never displays a platform movement without an assigned trigger', () => {
    const unknown = platform([activation({ unresolved: true, conditions: ['Some story event'] })]);
    const known = platform([activation({ generators: ['GENE-03'] })]);
    const empty = platform([]);
    const room = { ...stage([]), platforms: [unknown, known, empty] };
    expect(visiblePlatforms(room)).toEqual([known]);
  });
  it('keeps activate and return movements linked to their own floor triggers', () => {
    const area = {
      id: 'matt01',
      label: 'Party trigger area',
      position: { x: 10, y: 0, z: 20 },
      bounds: { minX: 0, maxX: 20, minY: 0, maxY: 30, minZ: 10, maxZ: 30 },
      allPlayers: true,
    };
    const p = platform([activation({ areas: [area] })]);
    p.movements.push({
      id: 'SQ_SWOF',
      label: 'Return platform',
      destination: null,
      activations: [activation({ difficulties: ['hard'], generators: ['GENE-09'] })],
    });
    expect(platformMovements(p, 'normal', 1).map((m) => m.id)).toEqual(['SQ_SWON']);
    expect(platformMovements(p, 'hard', 1).map((m) => m.id)).toEqual(['SQ_SWON', 'SQ_SWOF']);
    expect(platformMovements(p, 'normal', 1)[0].activations[0].areas?.[0].allPlayers).toBe(true);
  });
});

describe('door requirements', () => {
  it('shows only the held buttons for the selected party size', () => {
    const tower = {
      id: 'g_ctower01z02:0',
      label: 'Control tower 1',
      position: { x: 100, y: 0, z: 0 },
      facing: 0,
      action: 'break' as const,
    };
    const gate = door(
      'g_bossgatez02',
      0,
      [1, 2, 3, 4].map((players) =>
        activation({
          players: [players],
          switches: [
            tower,
            ...Array.from({ length: players }, (_, id) => ({
              id: `g_sbutton:${id}`,
              label: `Button ${id + 1}`,
              position: { x: id * 20, y: 0, z: 0 },
              facing: 0,
              action: 'hold' as const,
            })),
          ],
        }),
      ),
    );
    const room = stage([gate], 'stag0204');
    expect(doorActivations(gate, 'normal', 1)).toHaveLength(1);
    expect(doorSummary(gate, room, 'normal', 1)).toBe('Break Control tower 1 · Stand on Button 1');
    expect(doorActivations(gate, 'normal', 4)).toHaveLength(1);
    expect(doorSummary(gate, room, 'normal', 4)).toBe(
      'Break Control tower 1 · Stand on Button 1 and Button 2 and Button 3 and Button 4 at the same time',
    );
  });
  it('uses the selected difficulty and actual party size', () => {
    const hard = activation({ difficulties: ['hard'], players: [2, 3, 4] });
    const normal = activation({ difficulties: ['normal'] });
    const door = { activations: [hard, normal] } as Door;
    expect(doorActivations(door, 'hard', 1)).toEqual([]);
    expect(doorActivations(door, 'hard', 4)).toEqual([hard]);
    expect(doorActivations(door, 'normal', 1)).toEqual([normal]);
  });
  it('collapses equivalent button-model branches while keeping real alternatives', () => {
    const button1 = {
      id: 'g_dbutton1:0',
      label: 'Button 1',
      position: { x: 275, y: 40, z: -35 },
      facing: 0,
    };
    const button2 = {
      id: 'g_dbutton1:1',
      label: 'Button 2',
      position: { x: 275, y: 40, z: 35 },
      facing: 0,
    };
    const first = activation({ switches: [button1, button2] });
    const variant = activation({
      switches: [
        { ...button2, id: 'g_dbutton2:1' },
        { ...button1, id: 'g_dbutton2:0' },
      ],
    });
    const alternative = activation({ generators: ['GENE-01'] });
    const d = door('g_d2door', 7, [first, variant, alternative]);
    const paths = doorActivations(d, 'normal', 1);
    expect(paths).toHaveLength(2);
    expect(paths[0].switches.map((s) => s.label)).toEqual(['Button 1', 'Button 2']);
    expect(paths[1].generators).toEqual(['GENE-01']);
  });
  it('collapses repeated enemy-clear paths without merging distinct groups', () => {
    const d = door('g_d1door', 0, [
      activation({ generators: ['GENE-01', 'GENE-02'] }),
      activation({ generators: ['GENE-02', 'GENE-01'] }),
      activation({ generators: ['GENE-03'] }),
    ]);
    const paths = doorActivations(d, 'normal', 1);
    expect(paths.map((a) => a.generators)).toEqual([['GENE-01', 'GENE-02'], ['GENE-03']]);
  });
  it('follows generator identity when Crown Mod changes the enemy, and supports boss death callbacks', () => {
    const generators = [
      { name: 'GENE-03', row: 123 },
      { name: 'GENE-04', row: 124 },
      { name: 'GENE-05', row: 125 },
    ] as Generator[];
    const enemies = new Map([
      [123, { model: 'e_mummy', name: 'Mummymon' }],
      [124, { model: 'e_blosso' }],
      [125, { model: 'e_goburi' }],
    ]) as Map<number, Enemy>;
    expect([
      ...doorEnemyGroups(
        [activation({ generators: ['GENE-03'], enemyModels: ['e_blosso'] })],
        generators,
        enemies,
      ),
    ]).toEqual([0, 1]);
  });
});

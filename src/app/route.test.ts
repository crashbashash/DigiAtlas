import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, formatHash, parseHash, routes, type Route } from './route';

const roundTrip = (route: Route) => parseHash(formatHash(route, DEFAULT_SETTINGS)).route;

describe('routes', () => {
  it('round-trips every page', () => {
    const pages: Route[] = [
      routes.home(),
      routes.calculators(),
      routes.calculator('attack-damage'),
      routes.calculator('mp-tech'),
      routes.calculator('power-up'),
      routes.calculator('power-down'),
      routes.search('long sword', 'weapon'),
      routes.item('weapon:175'),
      routes.item('armor1:3', 'drops'),
      routes.map('stag0102'),
      routes.map('stag0102', { kind: 'item', key: 'weapon:175' }, true),
      routes.map('stag0102', { kind: 'spawner', name: 'gen_01' }),
      routes.map('stag0102', { kind: 'group', row: 12 }),
      routes.map('stag0102', { kind: 'species', name: 'Goburimon' }),
      routes.enemy('Goburimon'),
      routes.enemy('Devil-family boss (v3)', 'drops'),
      routes.items(),
      routes.items('weapon', 'axe', { column: 'strength', desc: true }),
      routes.enemies(),
      routes.enemies('boss', 'mon', { column: 'hp', desc: false }, 'resist'),
    ];
    for (const r of pages) expect(roundTrip(r)).toEqual(r);
  });

  it('carries the settings in the address', () => {
    const hash = formatHash(routes.item('weapon:1', 'drops'), {
      difficulty: 'veryhard',
      players: 3,
      showUnused: true,
    });
    expect(hash).toBe('#/item/weapon%3A1/drops?d=veryhard&p=3&u=1');
    expect(parseHash(hash).settings).toEqual({
      difficulty: 'veryhard',
      players: 3,
      showUnused: true,
    });
  });

  it('leaves out settings that are not written', () => {
    expect(parseHash('#/map/stag0102').settings).toEqual({});
    expect(parseHash('#/map/stag0102?d=nope&p=7').settings).toEqual({});
  });

  it('keeps old weapon damage links working after the Attack damage rename', () => {
    expect(parseHash('#/calculators/weapon-damage?d=normal')).toEqual({
      route: routes.calculator('attack-damage'),
      settings: { difficulty: 'normal' },
    });
  });

  it('opens old stage links on the map page', () => {
    expect(parseHash('#/stag0102?d=normal&item=weapon:175')).toEqual({
      route: routes.map('stag0102', { kind: 'item', key: 'weapon:175' }),
      settings: { difficulty: 'normal' },
    });
  });

  it('opens the old item window address as the item page', () => {
    expect(parseHash('#/popout?item=weapon:3&d=hard').route).toEqual(routes.item('weapon:3'));
  });

  it('falls back to home for anything it does not know', () => {
    expect(parseHash('').route).toEqual(routes.home());
    expect(parseHash('#/').route).toEqual(routes.home());
    expect(parseHash('#/what/is/this').route).toEqual(routes.home());
  });
});

describe('tables', () => {
  it('sends old category searches to the item table', () => {
    expect(parseHash('#/search?cat=weapon').route).toEqual(routes.items('weapon'));
    expect(parseHash('#/search?q=axe&cat=weapon').route).toEqual(routes.search('axe', 'weapon'));
  });

  it('keeps the sort in the address only when one is chosen', () => {
    expect(formatHash(routes.items('armor1'), DEFAULT_SETTINGS)).toBe('#/items?d=hard&cat=armor1');
    expect(
      formatHash(routes.enemies('all', '', { column: 'exp', desc: true }), DEFAULT_SETTINGS),
    ).toBe('#/enemies?d=hard&sort=exp&dir=desc');
  });
});

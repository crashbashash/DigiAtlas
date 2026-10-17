import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, formatHash, parseHash, routes, type Route } from './route';

const roundTrip = (route: Route) => parseHash(formatHash(route, DEFAULT_SETTINGS)).route;

describe('routes', () => {
  it('round-trips every page', () => {
    const pages: Route[] = [
      routes.home(),
      routes.search('long sword', 'weapon'),
      routes.item('weapon:175'),
      routes.item('armor1:3', 'drops'),
      routes.map('stag0102'),
      routes.map('stag0102', { kind: 'item', key: 'weapon:175' }, true),
      routes.map('stag0102', { kind: 'spawner', name: 'gen_01' }),
      routes.map('stag0102', { kind: 'group', row: 12 }),
      routes.map('stag0102', { kind: 'species', name: 'Goburimon' }),
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

import { describe, expect, it } from 'vitest';
import { sortRows, type Column } from './SortableTable';

type Row = { name: string; hp: number | null };
const columns: Column<Row>[] = [
  { id: 'name', label: 'Name', value: (r) => r.name },
  { id: 'hp', label: 'HP', numeric: true, value: (r) => r.hp },
];
const rows: Row[] = [
  { name: 'Ogremon', hp: 662 },
  { name: 'Blossomon', hp: null },
  { name: 'Goburimon', hp: 649 },
];
const names = (r: Row[]) => r.map((x) => x.name);

describe('sortRows', () => {
  it('keeps the given order without a known column', () => {
    expect(names(sortRows(rows, columns, { column: null, desc: false }))).toEqual(names(rows));
    expect(names(sortRows(rows, columns, { column: 'nope', desc: true }))).toEqual(names(rows));
  });

  it('sorts text and numbers both ways', () => {
    expect(names(sortRows(rows, columns, { column: 'name', desc: false }))).toEqual([
      'Blossomon',
      'Goburimon',
      'Ogremon',
    ]);
    expect(names(sortRows(rows, columns, { column: 'hp', desc: true }))[0]).toBe('Ogremon');
  });

  it('puts rows without a value last in either direction', () => {
    expect(names(sortRows(rows, columns, { column: 'hp', desc: false }))).toEqual([
      'Goburimon',
      'Ogremon',
      'Blossomon',
    ]);
    expect(names(sortRows(rows, columns, { column: 'hp', desc: true }))).toEqual([
      'Ogremon',
      'Goburimon',
      'Blossomon',
    ]);
  });
});

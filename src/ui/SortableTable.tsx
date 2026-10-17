import type { ComponentChildren } from 'preact';
import type { Sort } from '../app/route';

export interface Column<T> {
  id: string;
  label: string;
  /** Longer header text for screen readers and the tooltip. */
  title?: string;
  /** Numbers sort high-first on the first click and line up on the right. */
  numeric?: boolean;
  /** The value to sort by; null sorts last either way. */
  value(row: T): number | string | null;
  render?(row: T): ComponentChildren;
}

function compare(a: number | string | null, b: number | string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** Sort rows by a column; rows without a value stay at the end in both directions. */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: Sort): T[] {
  const column = columns.find((c) => c.id === sort.column);
  if (!column) return rows;
  return [...rows].sort((x, y) => {
    const a = column.value(x);
    const b = column.value(y);
    if (a === null || b === null) return compare(a, b);
    return sort.desc ? compare(b, a) : compare(a, b);
  });
}

/** A table whose headers sort it. The sort lives with the caller (in the address). */
export function SortableTable<T>(props: {
  columns: Column<T>[];
  rows: T[];
  sort: Sort;
  onSort(sort: Sort): void;
  caption: string;
  rowKey(row: T): string;
}) {
  const { columns, sort } = props;
  const rows = sortRows(props.rows, columns, sort);
  const click = (c: Column<T>) =>
    props.onSort(
      sort.column === c.id
        ? { column: c.id, desc: !sort.desc }
        : { column: c.id, desc: !!c.numeric },
    );
  return (
    <div class="table-scroll">
      <table class="browse">
        <caption class="visually-hidden">{props.caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                scope="col"
                class={c.numeric ? 'n' : undefined}
                aria-sort={
                  sort.column === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined
                }
              >
                <button type="button" title={c.title} onClick={() => click(c)}>
                  {c.label}
                  <span class="sort-mark" aria-hidden="true">
                    {sort.column === c.id ? (sort.desc ? '▼' : '▲') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={props.rowKey(r)}>
              {columns.map((c) => (
                <td class={c.numeric ? 'n' : undefined}>
                  {c.render ? c.render(r) : (c.value(r) ?? '–')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";
export type SortState<Key extends string> = { key: Key; direction: SortDirection };
export type SortColumn<Key extends string> = { key: Key; label: string; initialDirection?: SortDirection };

/**
 * Three-state cycle: a new column starts at its natural direction, the active
 * column toggles to the opposite direction, and only then does a third
 * activation restore the default order, so every list always has a way back to
 * its canonical sort (design §10.3, §27.3).
 */
export function nextSortState<Key extends string>(
  current: SortState<Key>,
  column: SortColumn<Key>,
  fallback: SortState<Key>,
): SortState<Key> {
  const initial = column.initialDirection ?? "asc";
  if (current.key !== column.key) return { key: column.key, direction: initial };
  if (current.direction === initial) return { key: column.key, direction: initial === "asc" ? "desc" : "asc" };
  // A fallback on this same column must start where the cycle started, or the
  // third activation would restore a stale state; otherwise restart the cycle.
  const compatible = fallback.key !== column.key || fallback.direction === initial;
  return compatible ? { ...fallback } : { key: column.key, direction: initial };
}

/**
 * A sort control row, deliberately a toolbar rather than a table header: task
 * rows are cards whose cells do not map onto these five columns, so claiming
 * `columnheader`/`aria-sort` semantics would misannounce every row. Each button
 * carries `aria-pressed` and names the order it will apply next; the visible
 * section notes state the order that is currently applied (design §27.3).
 */
export function SortHeaderRow<Key extends string>({ columns, sort, fallback, onChange, label, className = "" }: {
  columns: ReadonlyArray<SortColumn<Key>>;
  sort: SortState<Key>;
  fallback: SortState<Key>;
  onChange: (next: SortState<Key>) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`sort-header-row ${className}`.trim()} role="toolbar" aria-label={label}>
      {columns.map((column) => {
        const active = sort.key === column.key;
        const direction = active ? sort.direction : null;
        const next = nextSortState(sort, column, fallback);
        const resets = next.key === fallback.key && next.direction === fallback.direction;
        const accessible = active
          ? `${column.label}, sorted ${direction === "asc" ? "ascending" : "descending"}. Activate to ${resets ? "restore the default order" : `sort ${next.direction === "asc" ? "ascending" : "descending"}`}.`
          : `Sort by ${column.label.toLowerCase()}, ${next.direction === "asc" ? "ascending" : "descending"}.`;
        return (
          <span key={column.key} data-sort-key={column.key} className={`sort-header-cell ${active ? "is-active" : ""}`.trim()}>
            <button type="button" aria-pressed={active} aria-label={accessible} title={accessible} onClick={() => onChange(next)}>
              <span className="sort-header-label">{column.label}</span>
              {direction === "asc"
                ? <ArrowUp size={12} aria-hidden="true" />
                : direction === "desc"
                  ? <ArrowDown size={12} aria-hidden="true" />
                  : <ArrowUpDown size={12} aria-hidden="true" className="sort-header-idle" />}
            </button>
          </span>
        );
      })}
    </div>
  );
}

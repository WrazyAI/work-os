import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";
export type SortState<Key extends string> = { key: Key; direction: SortDirection };
export type SortColumn<Key extends string> = { key: Key; label: string; initialDirection?: SortDirection };

/**
 * Three-state cycle: a new column starts at its natural direction, the active
 * column toggles asc/desc, and a third activation restores the default order so
 * every list always has a way back to its canonical sort (design §10.3, §27.3).
 */
export function nextSortState<Key extends string>(
  current: SortState<Key>,
  column: SortColumn<Key>,
  fallback: SortState<Key>,
): SortState<Key> {
  if (current.key !== column.key) return { key: column.key, direction: column.initialDirection ?? "asc" };
  if (current.direction === "asc") return { key: column.key, direction: "desc" };
  return { ...fallback };
}

/**
 * Real `columnheader` elements with `aria-sort` inside a `role="row"`, so the
 * sortable list keeps table semantics: the header states the active order and
 * each button names the order it will apply next.
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
    <div className={`sort-header-row ${className}`.trim()} role="row" aria-label={label}>
      {columns.map((column) => {
        const active = sort.key === column.key;
        const direction = active ? sort.direction : null;
        const next = nextSortState(sort, column, fallback);
        const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
        const resets = next.key === fallback.key && next.direction === fallback.direction;
        const accessible = active
          ? `${column.label}, sorted ${direction === "asc" ? "ascending" : "descending"}. Activate to ${resets ? "restore the default order" : `sort ${next.direction === "asc" ? "ascending" : "descending"}`}.`
          : `Sort by ${column.label.toLowerCase()}, ${next.direction === "asc" ? "ascending" : "descending"}.`;
        return (
          <span key={column.key} role="columnheader" aria-sort={ariaSort} data-sort-key={column.key} className={`sort-header-cell ${active ? "is-active" : ""}`.trim()}>
            <button type="button" aria-label={accessible} title={accessible} onClick={() => onChange(next)}>
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

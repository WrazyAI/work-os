import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cx } from "./cx";

export interface GlideRow {
  key: string;
  icon?: ReactNode;
  name: string;
  desc?: string;
  trailing?: ReactNode;
}

/** A listbox with a single highlight that glides between rows instead of each
 *  row toggling its own background (design §25.11). */
export function GlideMenu({
  rows,
  active,
  engaged,
  label,
  id,
  optionIdPrefix,
  menuRef,
  className,
  style,
  emptyText,
  footText,
  onHoverRow,
  onPick,
}: {
  rows: GlideRow[];
  active: number;
  engaged: boolean;
  label: string;
  id?: string;
  optionIdPrefix?: string;
  menuRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  style?: CSSProperties;
  emptyText?: string;
  footText?: string;
  onHoverRow: (index: number) => void;
  onPick: (row: GlideRow, index: number) => void;
}) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setBox({ top: target.offsetTop, height: target.offsetHeight });
    else setBox(null);
  }, [active, rows.length, engaged]);

  return (
    <div id={id} ref={menuRef} className={cx("chat-glide-menu", className)} style={style} role="listbox" aria-label={label} data-workos-chat-menu>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && engaged && rows.length > 0 ? 1 : 0,
          transition:
            "top 200ms cubic-bezier(0.2,0.8,0.2,1), height 200ms cubic-bezier(0.2,0.8,0.2,1), opacity 150ms ease",
        }}
      />
      {rows.map((row, index) => (
        <button
          key={row.key}
          ref={(el) => {
            rowRefs.current[index] = el;
          }}
          type="button"
          id={optionIdPrefix ? `${optionIdPrefix}-${index}` : undefined}
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHoverRow(index)}
          onClick={() => onPick(row, index)}
          className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
        >
          {row.icon !== undefined && (
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2" aria-hidden="true">
              {row.icon}
            </span>
          )}
          <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.name}</span>
          {row.desc !== undefined && (
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
          )}
          {row.trailing}
        </button>
      ))}
      {rows.length === 0 && emptyText !== undefined && (
        <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">{emptyText}</div>
      )}
      {footText !== undefined && (
        <div className="mt-1 border-t border-line px-2 pb-1 pt-1.5 text-[11px] text-ink-3">
          {footText}
        </div>
      )}
    </div>
  );
}

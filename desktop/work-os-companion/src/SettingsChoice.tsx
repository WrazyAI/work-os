import type { KeyboardEvent } from "react";

/** One-of-two choice for an appearance preference: a segmented radio group.
 * The selected option owns the tab stop, arrow keys move and select, and the
 * visual state mirrors `aria-checked`. Shared by Settings and the preview. */
export function SettingsChoice<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Freeze the choice while its owner is saving. Existing callers omit it. */
  disabled?: boolean;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + (forward ? 1 : options.length - 1)) % options.length];
    if (!next) return;
    onChange(next.value);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div className="settings-choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={value === option.value}
          disabled={disabled}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

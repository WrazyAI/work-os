import { useEffect, useRef, type KeyboardEvent } from "react";
import { Check, Monitor, Moon, Sun, X } from "lucide-react";
import { systemPrefersDark, type ThemePreference } from "./appearance";

export type ThemePromptProps = {
  selected: ThemePreference;
  saving?: boolean;
  error?: string | null;
  onSelect: (theme: ThemePreference) => void;
  onUse: () => void;
  onDismiss: () => void;
};

const OPTIONS: { value: ThemePreference; label: string; detail: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", detail: "Bright and familiar", Icon: Sun },
  { value: "dark", label: "Dark", detail: "Dim, easy on the eyes", Icon: Moon },
  { value: "system", label: "System", detail: "Follows your device", Icon: Monitor },
];

function label(value: ThemePreference): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The one-time first-login theme choice. The parent owns the preview and the
 * persistence; this component owns the choice state, roving focus, and the
 * dialog's own keyboard behavior. Escape and Tab are owned by the App's
 * global modal trap. */
export default function ThemePrompt({ selected, saving = false, error = null, onSelect, onUse, onDismiss }: ThemePromptProps) {
  const choicesRef = useRef<HTMLDivElement | null>(null);

  const focusChoice = (value: ThemePreference) => {
    window.requestAnimationFrame(() => {
      choicesRef.current?.querySelector<HTMLButtonElement>(`[data-theme-choice="${value}"]`)?.focus();
    });
  };

  useEffect(() => {
    focusChoice(selected);
    // The prompt opens once; later selection changes move focus in the key
    // handler, not from an effect that would steal it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = OPTIONS.findIndex((option) => option.value === selected);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? OPTIONS.length - 1
        : (index + (forward ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    const choice = OPTIONS[next];
    if (!choice) return;
    onSelect(choice.value);
    focusChoice(choice.value);
  };

  const resolvedSystem = systemPrefersDark() ? "Dark" : "Light";

  return <div
    className="theme-prompt-backdrop"
    onMouseDown={(event) => { if (!saving && event.currentTarget === event.target) onDismiss(); }}
  >
    <section
      className="theme-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-prompt-title"
      aria-describedby="theme-prompt-desc"
    >
      <header className="theme-prompt-head">
        <span className="theme-prompt-mark" aria-hidden="true" />
        <button type="button" className="theme-prompt-close" aria-label="Close theme preview" disabled={saving} onClick={onDismiss}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      <h2 id="theme-prompt-title">How should Work OS look?</h2>
      <p className="theme-prompt-lede" id="theme-prompt-desc">Choose a theme for this device. You can change it any time in Settings, under Appearance.</p>

      <div className="theme-prompt-choices" role="radiogroup" aria-label="Theme" ref={choicesRef} onKeyDown={onKeyDown}>
        {OPTIONS.map(({ value, label: name, detail, Icon }) => <button
          key={value}
          type="button"
          role="radio"
          aria-checked={selected === value}
          tabIndex={selected === value ? 0 : -1}
          data-theme-choice={value}
          className={`theme-prompt-choice${selected === value ? " is-selected" : ""}`}
          onClick={() => onSelect(value)}
        >
          <span className="theme-prompt-choice-head">
            <Icon size={17} aria-hidden="true" />
            <span className="theme-prompt-check" aria-hidden="true"><Check size={10} /></span>
          </span>
          <span className={`theme-prompt-mini is-${value}`} aria-hidden="true">
            <i className="theme-prompt-mini-rail" />
            <span className="theme-prompt-mini-page"><i /><i /></span>
          </span>
          <strong>{name}</strong>
          <small>{detail}</small>
        </button>)}
      </div>

      <div className="theme-prompt-status" aria-live="polite">
        <span>
          Previewing {label(selected)}
          {selected === "system" ? `. This device is set to ${resolvedSystem}.` : "."}
        </span>
        {error ? <span className="theme-prompt-error">{error}</span> : null}
      </div>

      <div className="theme-prompt-footer">
        <button type="button" className="theme-prompt-use" onClick={onUse} disabled={saving}>
          {saving ? "Saving…" : `Use ${label(selected)}`}
        </button>
      </div>
    </section>
  </div>;
}

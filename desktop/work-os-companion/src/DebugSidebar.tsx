import { useRef, type KeyboardEvent } from "react";
import { Activity, Bot, ChevronDown, Clock, Download, Gauge, Layers, ShieldAlert, UserRound } from "lucide-react";
import { DEBUG_SECTION_GROUPS, DEBUG_SECTIONS, nextDebugSection, sectionsInGroup, type DebugSectionId } from "./debugSections";

const ICONS = {
  overview: Gauge,
  presets: Layers,
  session: UserRound,
  workday: Clock,
  companion: Bot,
  backend: ShieldAlert,
  trace: Activity,
  export: Download,
} as const;

type Props = {
  active: DebugSectionId;
  onSelect: (section: DebugSectionId) => void;
  scenarioEnabled: boolean;
  presetLabel: string;
  exportState: "ok" | "error" | null;
};

/** The debugger's section rail. Mirrors Settings: grouped destinations, one
 * roving tab stop, and a section picker instead of a second column when the
 * window is narrow. */
export function DebugSidebar({ active, onSelect, scenarioEnabled, presetLabel, exportState }: Props) {
  const navRef = useRef<HTMLElement | null>(null);

  const move = (event: KeyboardEvent<HTMLButtonElement>, current: DebugSectionId) => {
    const next = nextDebugSection(current, event.key);
    if (!next) return;
    event.preventDefault();
    const button = navRef.current?.querySelector<HTMLButtonElement>(`[data-debug-section="${next}"]`);
    button?.focus();
    button?.click();
  };

  const item = (id: DebugSectionId) => {
    const section = DEBUG_SECTIONS.find((entry) => entry.id === id);
    if (!section) return null;
    const Icon = ICONS[id];
    const current = active === id;
    return <button
      key={id}
      type="button"
      id={`debug-section-${id}`}
      className="debug-rail-item"
      data-debug-section={id}
      aria-current={current ? "page" : undefined}
      tabIndex={current ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => move(event, id)}
    >
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
      <span>{section.label}</span>
      {id === "trace" ? <span className="debug-rail-live" title="Live events" aria-hidden="true" /> : null}
      {id === "export" && exportState ? <span className={`debug-rail-badge ${exportState}`} aria-hidden="true">{exportState === "ok" ? "Saved" : "Failed"}</span> : null}
      {id === "export" && exportState ? <span className="debug-visually-hidden">{exportState === "ok" ? "Last export saved" : "Last export failed"}</span> : null}
    </button>;
  };

  return <aside className="debug-rail" aria-label="Debugger sections">
    <div className="debug-rail-head">
      <span className="debug-rail-label">Active preset</span>
      <strong title={presetLabel}>{presetLabel}</strong>
      <small><span className={`debug-dot${scenarioEnabled ? " is-on" : ""}`} aria-hidden="true" />{scenarioEnabled ? "Overrides applied" : "Overrides off"}</small>
    </div>

    <label className="debug-rail-select">
      <span>Section</span>
      <span className="debug-rail-select-control">
        <select value={active} onChange={(event) => onSelect(event.target.value as DebugSectionId)} aria-label="Debugger section">
          {DEBUG_SECTION_GROUPS.map((group) => <optgroup key={group} label={group}>
            {sectionsInGroup(group).map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
          </optgroup>)}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </label>

    <nav className="debug-rail-nav" aria-label="Debugger views" ref={navRef}>
      {DEBUG_SECTION_GROUPS.map((group) => <div className="debug-rail-group" key={group}>
        <p className="debug-rail-group-label">{group}</p>
        {sectionsInGroup(group).map((section) => item(section.id))}
      </div>)}
    </nav>
  </aside>;
}

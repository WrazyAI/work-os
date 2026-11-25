import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { AgentAccessSettings, agentAccessViewDescription } from "./AgentAccessSettings";
import { SettingsBlock, type SettingsPageId, type SettingsPageMeta } from "./settingsSections";
import type { PersonalSettingsProps } from "./PersonalSettings";

type SettingsContentProps = PersonalSettingsProps & {
  active: SettingsPageId;
  visiblePages: SettingsPageMeta[];
  query: string;
  onSelect: (page: SettingsPageId) => void;
  onQuery: (value: string) => void;
};

/** The stage half of Settings. The Work OS sidebar is already the settings
 * rail, so this component starts with the selected page title and embeds the
 * page's own settings groups directly in the stage.
 *
 * Session is the one page with an inline sub-view: Agent access replaces the
 * page body and title, and its back control returns to the Session summary.
 * That keeps the settings stage as the only layer; the token ledger never
 * stacks a second modal over it. */
export function SettingsContent({ active, visiblePages, query, onSelect, onQuery, ...props }: SettingsContentProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const agentAccessBackRef = useRef<HTMLButtonElement | null>(null);
  const [agentAccessOpen, setAgentAccessOpen] = useState(false);
  const page = visiblePages.find((entry) => entry.id === active) ?? null;
  const normalized = query.trim();
  const inAgentAccess = active === "session" && agentAccessOpen;

  useEffect(() => {
    setAgentAccessOpen(false);
  }, [active]);

  useEffect(() => {
    if (agentAccessOpen) agentAccessBackRef.current?.focus();
  }, [agentAccessOpen]);

  const openResult = (next: SettingsPageId) => {
    onSelect(next);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const backToSession = () => {
    setAgentAccessOpen(false);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  if (page) {
    const sessionBody = active === "session" ? (
      <div className="settings-view-enter" key={inAgentAccess ? "agent-access" : "session"}>
        {inAgentAccess
          ? <AgentAccessSettings
            surface={props.agentAccessSurface}
            apiBase={props.sessionApiBase}
            adminEnabled={props.adminAgentApiEnabled !== false}
          />
          : <SettingsBlock block="session" {...props} onManageAgentAccess={() => setAgentAccessOpen(true)} />}
      </div>
    ) : null;

    return <section className="settings-content-page" aria-labelledby="settings-page-title">
      <header className="settings-content-head">
        {inAgentAccess
          ? <button ref={agentAccessBackRef} type="button" className="settings-view-back" onClick={backToSession}>
            <ArrowLeft size={14} aria-hidden /> Back to Session
          </button>
          : <p className="settings-content-eyebrow">{page.group || "Settings"}</p>}
        <h2 id="settings-page-title" ref={headingRef} tabIndex={-1}>{inAgentAccess ? "Agent access" : page.label}</h2>
        <p>{inAgentAccess ? agentAccessViewDescription(props.agentAccessSurface) : page.description}</p>
      </header>
      <div className="settings-content-body" data-hide-first-head={page.hideFirstGroupHead ? "true" : undefined}>
        {sessionBody ?? page.blocks.map((block) => <SettingsBlock key={block} block={block} {...props} />)}
      </div>
    </section>;
  }

  if (normalized && visiblePages.length) {
    return <section className="settings-content-page" aria-labelledby="settings-page-title">
      <header className="settings-content-head">
        <p className="settings-content-eyebrow">Search</p>
        <h2 id="settings-page-title" ref={headingRef} tabIndex={-1}>Results for “{normalized}”</h2>
        <p>Choose the settings page that holds what you need.</p>
      </header>
      <div className="settings-search-results">
        {visiblePages.map((entry) => <button key={entry.id} type="button" className="settings-result" onClick={() => openResult(entry.id)}>
          <span className="settings-result-icon" aria-hidden="true"><entry.icon size={17} strokeWidth={1.8} /></span>
          <span className="settings-result-copy"><strong>{entry.label}</strong><small>{entry.description}</small></span>
          <span className="settings-result-group">{entry.group}</span>
        </button>)}
      </div>
    </section>;
  }

  return <section className="settings-content-page" aria-labelledby="settings-page-title">
    <div className="settings-empty">
      <Search size={22} aria-hidden="true" />
      <h2 id="settings-page-title" ref={headingRef} tabIndex={-1}>No settings match</h2>
      <p>Try a different word, or clear the search to see every page.</p>
      <button type="button" className="quiet-action" onClick={() => onQuery("")}>Clear search</button>
    </div>
  </section>;
}

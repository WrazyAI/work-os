import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronDown, Copy, ExternalLink, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { apiRequest } from "./api";
import { Setting } from "./Setting";

export type AgentAccessSurface = "employee" | "admin";

type AgentTokenRow = {
  id: string;
  kind?: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};

type ScopeOption = { id: string; label: string };

const SURFACE_COPY = {
  employee: {
    bandTitle: "Scoped tokens",
    bandDetail: "Let external agents read your tasks, log progress, and attach completion evidence. Secrets are shown once.",
    emptyTitle: "No active agent tokens",
    emptyCopy: "Create one when an external agent needs to work on your tasks.",
    footer: "Every issue and revocation is recorded against your account.",
    docsLabel: "User API guide",
    guidePath: "/docs/agent-api/user",
    endpoint: "/api/work-os/me/agent-tokens",
    defaultScopes: ["tasks:read", "tasks:write", "progress:write"],
    scopes: [
      { id: "tasks:read", label: "Read tasks" },
      { id: "tasks:write", label: "Create and update tasks" },
      { id: "progress:write", label: "Log progress" },
      { id: "evidence:write", label: "Attach completion evidence" },
    ] as ScopeOption[],
  },
  admin: {
    bandTitle: "Admin tokens",
    bandDetail: "Let external agents read across this workspace, act on tasks, review EODs, and connect through MCP. Secrets are shown once.",
    emptyTitle: "No active admin tokens",
    emptyCopy: "Create one when an external agent needs an administrative view of this workspace.",
    footer: "Every issue and revocation is recorded against this administrator.",
    docsLabel: "Admin API guide",
    guidePath: "/docs/agent-api/admin",
    endpoint: "/api/work-os/me/admin-agent-tokens",
    defaultScopes: ["people:read", "tasks:read", "eods:read", "records:read", "insights:read"],
    scopes: [
      { id: "people:read", label: "Read people" },
      { id: "tasks:read", label: "Read tasks" },
      { id: "eods:read", label: "Read EOD reports" },
      { id: "records:read", label: "Read work records" },
      { id: "insights:read", label: "Read organization insights" },
      { id: "tasks:write", label: "Create and update tasks" },
      { id: "eods:review", label: "Review EOD reports" },
    ] as ScopeOption[],
  },
} as const;

const EXPIRY_OPTIONS = [30, 90, 365];

function formatDate(value?: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isExpired(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time <= Date.now();
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function docsOrigin(apiBase?: string) {
  const fallback = "https://app.wrazyos.com";
  const raw = (apiBase ?? "").trim();
  if (!raw) return fallback;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
  } catch {
    return fallback;
  }
}

function useAgentTokens(surface: AgentAccessSurface, enabled: boolean) {
  const copy = SURFACE_COPY[surface];
  return useQuery<{ tokens: AgentTokenRow[] }>({
    queryKey: ["work-os", "agent-tokens", surface],
    queryFn: () => apiRequest<{ tokens: AgentTokenRow[] }>(copy.endpoint),
    staleTime: 30_000,
    enabled,
  });
}

export function agentAccessViewDescription(surface: AgentAccessSurface) {
  return surface === "admin"
    ? "Create and manage organization-wide tokens for administrator agents. Reads are the default; every write is opt-in."
    : "Create and manage tokens for agents that work on your tasks. The secret is shown once.";
}

function useGuideUrl(surface: AgentAccessSurface, apiBase: string) {
  return `${docsOrigin(apiBase)}${SURFACE_COPY[surface].guidePath}`;
}

async function openGuide(url: string, onError: (message: string) => void) {
  try {
    if (isTauri()) await openUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    onError("The API guide could not be opened in the browser.");
  }
}

/** The Session page's summary band. It counts the token rows and is the one
 * entry into the inline management view; it never creates a token itself. */
export function AgentAccessSummary({ surface, apiBase, adminEnabled = true, onManage }: {
  surface: AgentAccessSurface;
  apiBase: string;
  adminEnabled?: boolean;
  onManage: () => void;
}) {
  const copy = SURFACE_COPY[surface];
  const enabled = surface === "employee" || adminEnabled;
  const tokens = useAgentTokens(surface, enabled);
  const [guideError, setGuideError] = useState<string | null>(null);
  const guideUrl = useGuideUrl(surface, apiBase);
  const rows = tokens.data?.tokens ?? [];
  const active = rows.filter((token) => !token.revoked_at && !isExpired(token.expires_at));
  const inactive = rows.filter((token) => token.revoked_at || isExpired(token.expires_at));
  const countsKnown = tokens.data !== undefined;

  return (
    <section className="settings-group" aria-labelledby={`agent-access-${surface}-title`}>
      <header className="settings-group-head"><h3 id={`agent-access-${surface}-title`}>Agent access</h3></header>
      <section className="settings-panel">
        {enabled ? (
          <div className="setting">
            <div className="setting-copy">
              <strong>{copy.bandTitle}</strong>
              <small>{copy.bandDetail}</small>
            </div>
            <div className="setting-action">
              <span className="agent-access-controls">
                <span className="agent-access-count">
                  <strong>{countsKnown ? active.length : "—"}</strong> active · <strong>{countsKnown ? inactive.length : "—"}</strong> inactive
                </span>
                <button type="button" className="quiet-action" onClick={onManage}>
                  <KeyRound size={15} aria-hidden /> Manage tokens
                </button>
              </span>
            </div>
          </div>
        ) : (
          <div className="setting">
            <div className="setting-copy">
              <strong>Admin agent access is off</strong>
              <small>An owner can enable <strong>Admin agent API</strong> in Administration → Features. Existing tokens stay listed when it is turned back on.</small>
            </div>
            <div className="setting-action"><span className="status-chip">Off</span></div>
          </div>
        )}
        <div className="setting">
          <div className="setting-copy">
            <strong>{surface === "admin" ? "Admin API guide" : "API guide"}</strong>
            <small>{surface === "admin"
              ? "Organization-wide reads, previewed writes, EOD review, and MCP setup for administrator tokens."
              : "Authentication, endpoints, scopes, retry rules, and MCP setup for employee tokens."}</small>
          </div>
          <div className="setting-action">
            <button type="button" className="agent-access-guide" data-guide-url={guideUrl} onClick={() => void openGuide(guideUrl, setGuideError)}>
              {copy.docsLabel} <ExternalLink size={13} aria-hidden />
            </button>
          </div>
        </div>
        {guideError ? <p className="agent-access-inline-error" role="alert">{guideError}</p> : null}
      </section>
    </section>
  );
}

/** The inline management view. It replaces the Session page body, so it owns
 * creation, the one-time secret, the token ledger, and revocation without a
 * second modal layer over an already-modal settings workspace. */
export function AgentAccessSettings({ surface, apiBase, adminEnabled = true }: {
  surface: AgentAccessSurface;
  apiBase: string;
  adminEnabled?: boolean;
}) {
  const copy = SURFACE_COPY[surface];
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...copy.defaultScopes]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const rowActionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const restoreRevokeFocusTo = useRef<string | null>(null);
  const queryKey = ["work-os", "agent-tokens", surface] as const;
  const enabled = surface === "employee" || adminEnabled;
  const guideUrl = useGuideUrl(surface, apiBase);
  const tokens = useAgentTokens(surface, enabled);

  const create = useMutation({
    mutationFn: () => apiRequest<{ token: AgentTokenRow; secret: string }>(copy.endpoint, {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), scopes, expires_in_days: expiresInDays }),
    }),
    onSuccess: async (created) => {
      setSecret(created.secret);
      setCopied(false);
      setName("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const revoke = useMutation({
    mutationFn: (tokenId: string) => apiRequest(`${copy.endpoint}/${encodeURIComponent(tokenId)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmRevoke(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (confirmRevoke) {
      rowActionRefs.current[confirmRevoke]?.querySelector("button")?.focus();
      return;
    }
    const tokenId = restoreRevokeFocusTo.current;
    if (!tokenId) return;
    restoreRevokeFocusTo.current = null;
    rowActionRefs.current[tokenId]?.querySelector("button")?.focus();
  }, [confirmRevoke]);

  const toggleScope = (scope: string) => {
    setScopes((current) => (current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]));
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const cancelRevoke = () => {
    restoreRevokeFocusTo.current = confirmRevoke;
    setConfirmRevoke(null);
  };

  const rows = tokens.data?.tokens ?? [];
  const active = rows.filter((token) => !token.revoked_at && !isExpired(token.expires_at));
  const inactive = rows.filter((token) => token.revoked_at || isExpired(token.expires_at));
  const countsKnown = tokens.data !== undefined;
  const error = tokens.error || create.error || revoke.error;

  if (!enabled) {
    return <div className="agent-access-view">
      <p className="agent-access-disabled">Admin agent access is off for this workspace. An owner can enable <strong>Admin agent API</strong> in Administration → Features.</p>
      <div className="agent-access-view-foot">
        <small>{copy.footer}</small>
        <button type="button" className="agent-access-guide" data-guide-url={guideUrl} onClick={() => void openGuide(guideUrl, setGuideError)}>
          {copy.docsLabel} <ExternalLink size={13} aria-hidden />
        </button>
      </div>
      {guideError ? <p className="agent-access-inline-error" role="alert">{guideError}</p> : null}
    </div>;
  }

  return (
    <div className="agent-access-view" data-agent-access-view={surface}>
      {error ? <p className="agent-access-error" role="alert">{errorText(error, "Agent tokens could not be loaded.")}</p> : null}

      {secret ? (
        <div className="agent-access-secret" role="status">
          <strong>This is the only time you will see it. Store the secret now.</strong>
          <div className="agent-access-secret-row">
            <code>{secret}</code>
            <button type="button" className="quiet-action" onClick={() => void copySecret()}>
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="quiet-action" onClick={() => { setSecret(null); setCopied(false); create.reset(); }}>Done</button>
          </div>
          <p>Secrets start with <code>{surface === "admin" ? "wos_admin_" : "wos_agent_"}</code>; treat the value like a password.</p>
        </div>
      ) : null}

      <section className="agent-access-create-block" aria-labelledby={`agent-access-create-${surface}`}>
        <h3 id={`agent-access-create-${surface}`}>New token</h3>
        <div className="agent-access-create">
          <label className="agent-access-field">
            <span>Token name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={surface === "admin" ? "Reporting agent" : "Release checks"}
              maxLength={80}
              aria-label="Token name"
            />
          </label>
          <label className="agent-access-field agent-access-expiry">
            <span>Expiry</span>
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} aria-label="Token expiry">
              {EXPIRY_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={!name.trim() || scopes.length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={14} aria-hidden /> {create.isPending ? "Creating…" : "Create token"}
          </button>
        </div>

        <fieldset className="agent-access-scopes">
          <legend><ShieldCheck size={14} aria-hidden /> Scopes</legend>
          <div className="agent-access-scope-grid">
            {copy.scopes.map((option) => (
              <label key={option.id} className="agent-access-scope">
                <input type="checkbox" checked={scopes.includes(option.id)} onChange={() => toggleScope(option.id)} />
                <span>{option.label} <code>{option.id}</code></span>
              </label>
            ))}
          </div>
          <p>Scopes are chosen at creation and cannot be edited later. A scope never implies another.</p>
        </fieldset>
      </section>

      <section className="agent-access-ledger" aria-labelledby={`agent-access-ledger-${surface}`}>
        <div className="agent-access-list-head">
          <h3 id={`agent-access-ledger-${surface}`}>Active tokens <span>{countsKnown ? active.length : "—"}</span></h3>
          <small>Last used and expiry are recorded for each token.</small>
        </div>

        {tokens.isLoading && !tokens.data ? (
          <div className="agent-access-skeleton" aria-busy="true"><span /><span /></div>
        ) : active.length ? (
          <ul className="agent-access-list">
            {active.map((token) => (
              <li key={token.id} className="agent-access-token">
                <div className="agent-access-token-copy">
                  <strong>{token.name}</strong>
                  <small><code>{token.token_prefix}…</code> · last used {formatDate(token.last_used_at)} · expires {formatDate(token.expires_at)}</small>
                  <span className="agent-access-chips">{token.scopes.map((scope) => <code key={scope}>{scope}</code>)}</span>
                </div>
                <div
                  ref={(node) => { rowActionRefs.current[token.id] = node; }}
                  className="agent-access-token-action"
                >
                  {confirmRevoke === token.id ? (
                    <>
                      <span className="agent-access-confirm">Revoke {token.name}?</span>
                      <button type="button" className="quiet-action danger" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>Confirm</button>
                      <button type="button" className="quiet-action" onClick={cancelRevoke}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="quiet-action" onClick={() => setConfirmRevoke(token.id)}>
                      <Trash2 size={14} aria-hidden /> Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="agent-access-empty">
            <KeyRound size={18} aria-hidden />
            <strong>{copy.emptyTitle}</strong>
            <p>{copy.emptyCopy}</p>
          </div>
        )}

        {inactive.length ? (
          <details className="agent-access-inactive">
            <summary><ChevronDown size={13} aria-hidden /> Inactive tokens <span>{inactive.length}</span></summary>
            <ul>
              {inactive.map((token) => (
                <li key={token.id}>
                  <span><strong>{token.name}</strong> · <code>{token.token_prefix}…</code> · created {formatDate(token.created_at)}</span>
                  <span className={`agent-access-pill ${token.revoked_at ? "revoked" : "expired"}`}>{token.revoked_at ? "Revoked" : "Expired"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <footer className="agent-access-view-foot">
        <small>{copy.footer}</small>
        <button type="button" className="agent-access-guide" data-guide-url={guideUrl} onClick={() => void openGuide(guideUrl, setGuideError)}>
          {copy.docsLabel} <ExternalLink size={13} aria-hidden />
        </button>
      </footer>
      {guideError ? <p className="agent-access-inline-error" role="alert">{guideError}</p> : null}
    </div>
  );
}

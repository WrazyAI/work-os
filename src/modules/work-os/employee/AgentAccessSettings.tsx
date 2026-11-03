"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Trash2, X } from "lucide-react";
import { fetchJson, formatDateTimeShort } from "./model";
import styles from "./EmployeeSettings.module.css";

const SCOPE_OPTIONS = [
  { id: "tasks:read", label: "Read tasks" },
  { id: "tasks:write", label: "Create and update tasks" },
  { id: "progress:write", label: "Log progress" },
  { id: "evidence:write", label: "Attach completion evidence" },
] as const;

const DEFAULT_SCOPES = ["tasks:read", "tasks:write", "progress:write"];
const EXPIRY_OPTIONS = [30, 90, 365];

type AgentTokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};

/** Self-service agent credentials. The summary band opens one modal that owns
 * creation and management; the secret is held in component state only and
 * cleared the moment the one-time notice is dismissed. */
export default function AgentAccessSettings() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const bandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A token action that lands on /work-os/settings#agent-access opens the
  // management modal directly. The hash stays useful for later visits.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#agent-access") setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (bandRef.current?.isConnected) bandRef.current.focus();
    };
  }, [open]);

  const tokens = useQuery<{ tokens: AgentTokenRow[] }>({
    queryKey: ["work-os", "agent-tokens"],
    queryFn: () => fetchJson<{ tokens: AgentTokenRow[] }>("/api/work-os/me/agent-tokens"),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () => fetchJson<{ token: AgentTokenRow; secret: string }>("/api/work-os/me/agent-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), scopes, expires_in_days: expiresInDays }),
    }),
    onSuccess: async (created) => {
      setSecret(created.secret);
      setCopied(false);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["work-os", "agent-tokens"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (tokenId: string) => fetchJson(`/api/work-os/me/agent-tokens/${tokenId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmRevoke(null);
      await queryClient.invalidateQueries({ queryKey: ["work-os", "agent-tokens"] });
    },
  });

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

  const rows = tokens.data?.tokens ?? [];
  const now = Date.now();
  const expired = (token: AgentTokenRow) => !token.revoked_at && Number.isFinite(Date.parse(token.expires_at)) && Date.parse(token.expires_at) <= now;
  const activeRows = rows.filter((token) => !token.revoked_at && !expired(token));
  const inactiveRows = rows.filter((token) => token.revoked_at || expired(token));
  const countsKnown = tokens.data !== undefined;
  const error = tokens.error || create.error || revoke.error;

  return (
    <>
      <section className={styles.group} id="agent-access" aria-labelledby="settings-access-title">
        <div className={styles.groupLabel}>
          <h2 id="settings-access-title">Agent access</h2>
          <p>Create, review, and revoke scoped tokens for external agents.</p>
        </div>
        <div className={styles.groupContent}>
          <button
            ref={bandRef}
            type="button"
            className={styles.accessBand}
            aria-label="Open Agent access to create and manage tokens"
            onClick={() => setOpen(true)}
          >
            <span className={styles.memoryLead}>
              <span className={styles.memoryMark} aria-hidden="true"><KeyRound size={16} /></span>
              <span>
                <span className={styles.memoryTitle}>Scoped tokens</span>
                <span className={styles.memoryCopy}>Let external agents read your tasks, log progress, and attach evidence. Secrets are shown once.</span>
              </span>
            </span>
            <span className={styles.accessSide}>
              <span className={styles.memoryCount}>Active <strong>{countsKnown ? activeRows.length : "—"}</strong></span>
              <span className={styles.memoryCount}>Inactive <strong>{countsKnown ? inactiveRows.length : "—"}</strong></span>
              <span className={styles.accessManage}>Manage tokens</span>
            </span>
          </button>
        </div>
      </section>

      {open ? (
        <div className={styles.modalLayer} role="presentation">
          <button
            type="button"
            className={styles.modalBackdrop}
            aria-label="Close agent access"
            onClick={() => setOpen(false)}
            tabIndex={-1}
          />
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="agent-access-title">
            <header className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle} id="agent-access-title">Agent access</h2>
                <p className={styles.modalCopy}>Create and manage scoped tokens for external agents. Secrets are shown once and cannot be recovered.</p>
              </div>
              <button ref={closeRef} type="button" className={styles.modalClose} aria-label="Close" onClick={() => setOpen(false)}>
                <X size={15} />
              </button>
            </header>

            <div className={styles.modalBody}>
              {error ? <div className={`${styles.notice} ${styles.noticeErr}`}>{(error as Error).message}</div> : null}

              {secret ? (
                <div className={styles.secretNotice}>
                  <p className={styles.secretTitle}>This is the only time you will see it. Store the secret now.</p>
                  <div className={styles.secretRow}>
                    <code className={styles.secretCode}>{secret}</code>
                    <button type="button" className={styles.secondaryButton} onClick={() => void copySecret()}>
                      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                    </button>
                    <button type="button" className={styles.quietButton} onClick={() => { setSecret(null); setCopied(false); }}>Done</button>
                  </div>
                </div>
              ) : null}

              <div className={styles.accessForm}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Token name</span>
                  <input
                    className={styles.input}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Release automation"
                    maxLength={80}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Expiry</span>
                  <select className={styles.select} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                    {EXPIRY_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
                  </select>
                </label>
                <button type="button" className={styles.primaryButton} disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                  <Plus size={13} /> {create.isPending ? "Creating…" : "Create token"}
                </button>
              </div>

              <div className={styles.scopeRow}>
                {SCOPE_OPTIONS.map((option) => (
                  <label key={option.id} className={styles.scopeLabel}>
                    <input type="checkbox" checked={scopes.includes(option.id)} onChange={() => toggleScope(option.id)} />
                    {option.label}
                  </label>
                ))}
              </div>

              {tokens.isLoading && !tokens.data ? (
                <div className="grid gap-2" aria-busy="true">
                  <div className={styles.skeletonBlock} style={{ height: 54 }} />
                  <div className={styles.skeletonBlock} style={{ height: 54 }} />
                </div>
              ) : (
                <>
                  <div className={styles.tokenList}>
                    {activeRows.length ? activeRows.map((token) => (
                      <div key={token.id} className={styles.tokenRow}>
                        <div className={styles.tokenMain}>
                          <p className={styles.tokenName}>{token.name}</p>
                          <p className={styles.tokenMeta}>
                            <code>{token.token_prefix}…</code> · created {formatDateTimeShort(token.created_at)} · last used {formatDateTimeShort(token.last_used_at)} · expires {formatDateTimeShort(token.expires_at)}
                          </p>
                          <div className={styles.tokenScopes}>
                            {token.scopes.map((scope) => <span key={scope} className={styles.scopeChip}>{scope}</span>)}
                          </div>
                        </div>
                        <div className={styles.tokenActions}>
                          {confirmRevoke === token.id ? (
                            <>
                              <span className={styles.hint}>Revoke {token.name}?</span>
                              <button type="button" className={`${styles.secondaryButton} ${styles.dangerButton}`} disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>Confirm</button>
                              <button type="button" className={styles.quietButton} onClick={() => setConfirmRevoke(null)}>Cancel</button>
                            </>
                          ) : (
                            <button type="button" className={styles.secondaryButton} onClick={() => setConfirmRevoke(token.id)}>
                              <Trash2 size={13} /> Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    )) : (
                      <div className={styles.empty}>
                        <strong className={styles.emptyTitle}>No active agent tokens</strong>
                        <p className={styles.emptyCopy}>Create one when an external agent needs to work on your tasks.</p>
                      </div>
                    )}
                  </div>

                  {inactiveRows.length ? (
                    <details className={styles.revokedBlock}>
                      <summary>Inactive tokens ({inactiveRows.length})</summary>
                      {inactiveRows.map((token) => (
                        <div key={token.id} className={styles.revokedRow}>
                          <span><strong>{token.name}</strong> · <code>{token.token_prefix}…</code></span>
                          <span>{token.revoked_at ? `revoked ${formatDateTimeShort(token.revoked_at)}` : `expired ${formatDateTimeShort(token.expires_at)}`}</span>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </>
              )}
            </div>

            <footer className={styles.modalFooter}>
              <Link href="/docs/agent-api" className={styles.linkButton}>API guide</Link>
              <button type="button" className={styles.secondaryButton} onClick={() => setOpen(false)}>Done</button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}

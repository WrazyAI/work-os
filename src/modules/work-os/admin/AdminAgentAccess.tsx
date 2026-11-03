"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, KeyRound, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { adminFetch } from "./api";
import {
  Button,
  EmptyState,
  Notice,
  SelectField,
  Skeleton,
  StatusPill,
  TextField,
  relativeTime,
} from "./ui";

const SCOPE_OPTIONS = [
  { id: "people:read", label: "Read people" },
  { id: "tasks:read", label: "Read tasks" },
  { id: "tasks:write", label: "Create and update tasks" },
  { id: "eods:read", label: "Read EOD reports" },
  { id: "eods:review", label: "Review EOD reports" },
  { id: "records:read", label: "Read work records" },
  { id: "insights:read", label: "Read organization insights" },
] as const;

const DEFAULT_SCOPES = ["people:read", "tasks:read", "eods:read", "records:read", "insights:read"];
const EXPIRY_OPTIONS = [30, 90, 365];

type AdminAgentTokenRow = {
  id: string;
  kind: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isExpired(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time <= Date.now();
}

/** Admin-scoped agent credentials. Admin tokens read across the organization,
 * so the Settings page keeps them behind one quiet band; the modal owns
 * creation, scopes, and revocation. The raw secret is held in component state
 * only and cleared when the notice closes. */
export default function AdminAgentAccess() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const rowActionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const restoreRevokeFocusTo = useRef<string | null>(null);
  const bandRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layerRef.current?.focus();
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !layerRef.current) return;
      const focusable = layerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  const tokens = useQuery<{ tokens: AdminAgentTokenRow[] }>({
    queryKey: ["work-os", "admin", "admin-agent-tokens"],
    queryFn: () => adminFetch<{ tokens: AdminAgentTokenRow[] }>("/api/work-os/me/admin-agent-tokens"),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () => adminFetch<{ token: AdminAgentTokenRow; secret: string }>("/api/work-os/me/admin-agent-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), scopes, expires_in_days: expiresInDays }),
    }),
    onSuccess: async (created) => {
      setSecret(created.secret);
      setCopied(false);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["work-os", "admin", "admin-agent-tokens"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (tokenId: string) => adminFetch(`/api/work-os/me/admin-agent-tokens/${tokenId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmRevoke(null);
      await queryClient.invalidateQueries({ queryKey: ["work-os", "admin", "admin-agent-tokens"] });
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

  const cancelRevoke = () => {
    restoreRevokeFocusTo.current = confirmRevoke;
    setConfirmRevoke(null);
  };

  const rows = tokens.data?.tokens ?? [];
  const active = rows.filter((token) => !token.revoked_at && !isExpired(token.expires_at));
  const inactive = rows.filter((token) => token.revoked_at || isExpired(token.expires_at));
  const countsKnown = !tokens.isLoading && tokens.data != null;
  const error = create.error || revoke.error;

  return (
    <>
      <button
        ref={bandRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open admin agent access to create and manage tokens"
        className="flex w-full flex-wrap items-center justify-between gap-3 rounded-[10px] px-1 py-2 text-left transition hover:bg-[var(--bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--accent)]"
      >
        <span className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--accent)" }}>
            <KeyRound size={14} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-[620] tracking-[-0.01em] text-[var(--text-primary)]">Admin tokens</span>
            <span className="mt-0.5 block max-w-[58ch] text-[10.5px] leading-[1.6] text-[var(--text-tertiary)]">
              Let external agents read across this workspace, act on tasks, review EODs, and connect through MCP. Secrets are shown once.
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-3">
          <span className="text-[10.5px] text-[var(--text-tertiary)]">
            Active <strong className="font-[640] tabular-nums text-[var(--text-primary)]">{countsKnown ? active.length : "—"}</strong>
          </span>
          <span className="text-[10.5px] text-[var(--text-tertiary)]">
            Inactive <strong className="font-[640] tabular-nums text-[var(--text-primary)]">{countsKnown ? inactive.length : "—"}</strong>
          </span>
          <span className="inline-flex h-[30px] items-center rounded-[8px] border px-2.5 text-[11px] font-semibold text-[var(--text-primary)]" style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}>
            Manage tokens
          </span>
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="presentation">
          <button type="button" aria-label="Close admin agent access" className="fixed inset-0 bg-black/35" onClick={() => setOpen(false)} />
          <div
            ref={layerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin agent access"
            tabIndex={-1}
            className="relative my-auto flex max-h-[min(88vh,820px)] w-full max-w-[720px] flex-col overflow-hidden rounded-[16px] border"
            style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-md)" }}
          >
            <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="min-w-0">
                <h2 className="text-[16px] font-[620] tracking-[-0.015em] text-[var(--text-primary)]">Admin agent access</h2>
                <p className="mt-0.5 max-w-[62ch] text-[11px] leading-[1.6] text-[var(--text-tertiary)]">
                  Tokens are bound to this workspace and to the administrator who minted them. The secret is shown once.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-[8px] border text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                style={{ borderColor: "var(--border)" }}
              >
                <X size={15} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4">
                {error ? <Notice tone="err">{(error as Error).message}</Notice> : null}

                {secret ? (
                  <Notice tone="info">
                    <div className="grid gap-2" role="status">
                      <p className="font-semibold">This is the only time you will see it. Store the secret now.</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded-[8px] border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--bg-card)", wordBreak: "break-all" }}>
                          {secret}
                        </code>
                        <Button onClick={() => void copySecret()}>
                          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copied ? "Copied" : "Copy"}
                        </Button>
                        <Button variant="ghost" onClick={() => { setSecret(null); setCopied(false); create.reset(); }}>Done</Button>
                      </div>
                      <p className="text-[11.5px] leading-5">Secrets start with <span className="font-mono">wos_admin_</span>; treat the value like a password.</p>
                    </div>
                  </Notice>
                ) : null}

                <div className="flex flex-wrap items-end gap-2">
                  <TextField
                    label="Token name"
                    value={name}
                    onChange={setName}
                    placeholder="Reporting agent"
                    ariaLabel="Admin token name"
                    className="min-w-[220px] flex-1"
                  />
                  <SelectField
                    label="Expiry"
                    value={String(expiresInDays)}
                    onChange={(value) => setExpiresInDays(Number(value))}
                    options={EXPIRY_OPTIONS.map((days) => ({ value: String(days), label: `${days} days` }))}
                    ariaLabel="Admin token expiry"
                  />
                  <Button variant="primary" disabled={!name.trim() || scopes.length === 0 || create.isPending} onClick={() => create.mutate()}>
                    <Plus size={13} aria-hidden /> {create.isPending ? "Creating…" : "Create token"}
                  </Button>
                </div>

                <fieldset className="grid gap-2">
                  <legend className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-secondary)]">
                    <ShieldCheck size={13} aria-hidden /> Scopes
                  </legend>
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    {SCOPE_OPTIONS.map((option) => (
                      <label key={option.id} className="flex items-start gap-2 text-[11.5px] leading-5 text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={scopes.includes(option.id)}
                          onChange={() => toggleScope(option.id)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          {option.label}
                          <span className="ml-1.5 font-mono text-[10px] text-[var(--text-tertiary)]">{option.id}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
                  <h3 className="text-[11.5px] font-semibold text-[var(--text-secondary)]">
                    Active tokens <span className="ml-1 tabular-nums text-[var(--text-tertiary)]">{countsKnown ? active.length : "—"}</span>
                  </h3>
                  {tokens.isLoading && !tokens.data ? (
                    <div aria-busy="true" className="mt-2 grid gap-1.5"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
                  ) : tokens.isError ? (
                    <div className="mt-2">
                      <Notice
                        tone="err"
                        action={
                          <Button size="sm" onClick={() => void tokens.refetch()} disabled={tokens.isFetching}>
                            {tokens.isFetching ? "Retrying…" : "Retry"}
                          </Button>
                        }
                      >
                        Admin tokens could not be loaded. {(tokens.error as Error).message}
                      </Notice>
                    </div>
                  ) : rows.length ? (
                    <div className="mt-1">
                      {active.length ? (
                        <ul>
                          {active.map((token) => (
                            <li key={token.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                              <div className="min-w-0 flex-1 basis-[280px]">
                                <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{token.name}</p>
                                <p className="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]">
                                  <code>{token.token_prefix}…</code> · last used {relativeTime(token.last_used_at)} · expires {formatDate(token.expires_at)}
                                </p>
                                <p className="mt-1 truncate text-[10px] text-[var(--text-tertiary)]">{token.scopes.join(" · ")}</p>
                              </div>
                              <div
                                ref={(node) => { rowActionRefs.current[token.id] = node; }}
                                className="flex flex-wrap items-center gap-2"
                              >
                                {confirmRevoke === token.id ? (
                                  <>
                                    <span className="text-[11px] text-[var(--text-secondary)]">Revoke {token.name}?</span>
                                    <Button size="sm" variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>Confirm</Button>
                                    <Button size="sm" variant="ghost" onClick={cancelRevoke}>Cancel</Button>
                                  </>
                                ) : (
                                  <Button size="sm" onClick={() => setConfirmRevoke(token.id)}><Trash2 size={13} aria-hidden /> Revoke</Button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">No active tokens. Create one when an external agent needs an administrative view.</p>
                      )}

                      {inactive.length ? (
                        <details className="mt-2">
                          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
                            <ChevronDown size={12} aria-hidden /> Inactive tokens <span className="tabular-nums text-[var(--text-tertiary)]">{inactive.length}</span>
                          </summary>
                          <ul className="mt-1">
                            {inactive.map((token) => (
                              <li key={token.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b py-2 text-[11px] last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-[var(--text-secondary)]">{token.name}</span>
                                  <span className="block text-[10px] text-[var(--text-tertiary)]">
                                    <code>{token.token_prefix}…</code> · created {formatDate(token.created_at)}
                                  </span>
                                </span>
                                {token.revoked_at ? <StatusPill tone="err">Revoked</StatusPill> : <StatusPill tone="warn">Expired</StatusPill>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyState
                      icon={KeyRound}
                      title="No admin tokens"
                      body="Create one when an external agent needs an administrative view of this workspace."
                    />
                  )}
                </div>
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-[10px] text-[var(--text-tertiary)]">Every issue and revocation is recorded against this administrator.</span>
              <Button onClick={() => setOpen(false)}>Close</Button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}

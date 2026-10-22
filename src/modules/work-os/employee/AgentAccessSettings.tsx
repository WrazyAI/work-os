"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { fetchJson, formatDateTimeShort } from "./model";
import {
  EmptyState,
  Field,
  Notice,
  Panel,
  PanelHeader,
  PrimaryButton,
  QuietButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
  inputClass,
  inputStyle,
} from "./ui";

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

/** Self-service agent credentials. The secret is held in component state only
 * and cleared the moment the one-time notice is dismissed. */
export default function AgentAccessSettings() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

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
  const error = tokens.error || create.error || revoke.error;

  return (
    <Panel>
      <PanelHeader
        icon={<KeyRound size={16} />}
        title="Agent access"
        meta="Scoped tokens let external agents read your tasks, log progress, and attach evidence. Secrets are shown once."
      />
      <div className="grid gap-4 px-5 py-5">
        {error ? <Notice tone="err">{(error as Error).message}</Notice> : null}

        {secret ? (
          <Notice tone="info">
            <div className="grid gap-2">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">This is the only time you will see it. Store the secret now.</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-[8px] border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--bg-card)", wordBreak: "break-all" }}>
                  {secret}
                </code>
                <SecondaryButton onClick={() => void copySecret()}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                </SecondaryButton>
                <QuietButton onClick={() => { setSecret(null); setCopied(false); }}>Done</QuietButton>
              </div>
            </div>
          </Notice>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <Field label="Token name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Release automation" className={inputClass} style={inputStyle} maxLength={80} />
          </Field>
          <Field label="Expiry">
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className={inputClass} style={inputStyle}>
              {EXPIRY_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </Field>
          <PrimaryButton disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            <Plus size={13} /> {create.isPending ? "Creating…" : "Create token"}
          </PrimaryButton>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SCOPE_OPTIONS.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={scopes.includes(option.id)} onChange={() => toggleScope(option.id)} />
              {option.label}
            </label>
          ))}
        </div>

        {tokens.isLoading && !tokens.data ? (
          <div aria-busy="true" className="grid gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : rows.length ? (
          <div className="grid gap-2">
            {rows.map((token) => (
              <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{token.name}</p>
                  <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    <code>{token.token_prefix}…</code> · created {formatDateTimeShort(token.created_at)} · last used {formatDateTimeShort(token.last_used_at)} · expires {formatDateTimeShort(token.expires_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {token.scopes.map((scope) => <StatusPill key={scope} tone="info">{scope}</StatusPill>)}
                    {token.revoked_at ? <StatusPill tone="error">Revoked</StatusPill> : null}
                  </div>
                </div>
                {token.revoked_at ? null : confirmRevoke === token.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--text-secondary)]">Revoke {token.name}?</span>
                    <SecondaryButton disabled={revoke.isPending} style={{ color: "var(--status-error)" }} onClick={() => revoke.mutate(token.id)}>Confirm</SecondaryButton>
                    <QuietButton onClick={() => setConfirmRevoke(null)}>Cancel</QuietButton>
                  </div>
                ) : (
                  <SecondaryButton onClick={() => setConfirmRevoke(token.id)}><Trash2 size={13} /> Revoke</SecondaryButton>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No agent tokens" message="Create one when an external agent needs to work on your tasks." />
        )}
      </div>
    </Panel>
  );
}

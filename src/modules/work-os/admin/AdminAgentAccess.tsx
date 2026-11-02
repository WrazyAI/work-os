"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { adminFetch } from "./api";
import {
  AdminCard,
  Button,
  EmptyState,
  Notice,
  SectionHeading,
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

/** Admin-scoped agent credentials. Admin tokens read across the organization,
 * so they are minted and revoked here in the administration console; the raw
 * secret is held in component state only and cleared when the notice closes. */
export default function AdminAgentAccess() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

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

  const rows = tokens.data?.tokens ?? [];
  const error = tokens.error || create.error || revoke.error;

  return (
    <AdminCard>
      <SectionHeading
        icon={KeyRound}
        title="Admin agent access"
        detail="Scoped admin tokens let external agents read across this workspace, act on tasks, review EOD reports, and connect through MCP. Every token is bound to this workspace and to the administrator who minted it."
      />
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
                <Button variant="ghost" onClick={() => { setSecret(null); setCopied(false); }}>Done</Button>
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
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {SCOPE_OPTIONS.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
                <input type="checkbox" checked={scopes.includes(option.id)} onChange={() => toggleScope(option.id)} />
                {option.label}
                <span className="font-mono text-[10.5px] text-[var(--text-tertiary)]">{option.id}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {tokens.isLoading && !tokens.data ? (
          <div aria-busy="true" className="grid gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : rows.length ? (
          <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {rows.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-1 last:pb-1">
                <div className="min-w-0 flex-1 basis-[280px]">
                  <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{token.name}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                    <code>{token.token_prefix}…</code> · last used {relativeTime(token.last_used_at)} · expires {formatDate(token.expires_at)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {token.scopes.map((scope) => <StatusPill key={scope} tone="info">{scope}</StatusPill>)}
                    {token.revoked_at ? <StatusPill tone="err">Revoked</StatusPill> : null}
                  </div>
                </div>
                {token.revoked_at ? null : confirmRevoke === token.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-[var(--text-secondary)]">Revoke {token.name}?</span>
                    <Button size="sm" variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" onClick={() => setConfirmRevoke(token.id)}><Trash2 size={13} aria-hidden /> Revoke</Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={KeyRound}
            title="No admin tokens"
            body="Create one when an external agent needs an administrative view of this workspace."
          />
        )}
      </div>
    </AdminCard>
  );
}

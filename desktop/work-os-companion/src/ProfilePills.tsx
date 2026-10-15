import { useState } from "react";
import { Camera, Github, ListChecks, Plus, X, type LucideIcon } from "lucide-react";
import { addProfileItem, customProfileItem, profileItemsOfKind, removeProfileItem, suggestedProfileItems } from "./profileItems";
import type { ProfileItemKind, ProviderAccounts, WorkProfileItem } from "./types";

/** One work-profile signal group: what is picked, what the selected scope still
 * suggests, and one bounded way to add something the catalog does not list.
 * The component owns the shared interaction contract (§8.15) for all three
 * groups — Responsibilities, Outputs, and Evidence sources — so they can never
 * drift apart. */
export function ItemPillGroup({ kind, legend, legendId, items, options, disabled = false, onChange }: {
  kind: ProfileItemKind;
  legend: string;
  legendId: string;
  items: WorkProfileItem[];
  options: WorkProfileItem[];
  disabled?: boolean;
  onChange: (items: WorkProfileItem[]) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const picked = profileItemsOfKind(items, kind);
  const suggestions = suggestedProfileItems(items, options, kind);

  function addCustom() {
    const item = customProfileItem(kind, customValue);
    if (!item) return;
    onChange(addProfileItem(items, item));
    setCustomValue("");
    setCustomOpen(false);
  }

  return <fieldset className="profile-pill-group" disabled={disabled}>
    <legend id={legendId}>{legend}</legend>
    {picked.length
      ? <div className="profile-pill-picked">{picked.map((item) => <span className="profile-pill" key={item.id}>
          {item.label}
          <button type="button" aria-label={`Remove ${item.label}`} title={`Remove ${item.label}`} onClick={() => onChange(removeProfileItem(items, item.id))}><X size={11} /></button>
        </span>)}</div>
      : <p className="profile-pill-empty">Nothing picked yet.</p>}
    <div className="profile-pill-offer">
      {suggestions.map((item) => <button type="button" className="profile-pill-add" key={item.id} aria-label={`Add ${item.label}`} title={`Add ${item.label}`} onClick={() => onChange(addProfileItem(items, item))}><Plus size={11} aria-hidden="true" /> {item.label}</button>)}
      {customOpen
        ? <span className="profile-pill-custom-form">
            <input
              value={customValue}
              maxLength={120}
              autoFocus
              aria-label={`New ${legend.toLowerCase()} item`}
              placeholder="Add your own"
              onChange={(event) => setCustomValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); addCustom(); }
                if (event.key === "Escape") { setCustomValue(""); setCustomOpen(false); }
              }}
            />
            <button type="button" className="profile-pill-custom-add" disabled={!customValue.trim()} onClick={addCustom}>Add</button>
          </span>
        : <button type="button" className="profile-pill-custom" onClick={() => setCustomOpen(true)}><Plus size={11} aria-hidden="true" /> Add your own</button>}
    </div>
  </fieldset>;
}

/** The accounts the workspace has mapped to this person as evidence. Read-only
 * by design: the employee owns their work profile, the workspace owns provider
 * mappings, so this group states what is mapped and never offers a control the
 * employee cannot honor. */
export function ProviderAccountPills({ accounts, note }: { accounts: ProviderAccounts; note?: string }) {
  const pills: Array<{ key: string; provider: string; Mark: LucideIcon; name: string; identifier: string | null; pending: boolean }> = [];
  if (accounts.worktivity.mapped) pills.push({ key: "worktivity", provider: "worktivity", Mark: Camera, name: "Worktivity", identifier: accounts.worktivity.email, pending: false });
  for (const account of accounts.github.accounts) pills.push({ key: `github:${account.id}`, provider: "github", Mark: Github, name: "GitHub", identifier: account.login, pending: !account.verified });
  if (accounts.nifty.mapped) pills.push({ key: "nifty", provider: "nifty", Mark: ListChecks, name: "Nifty", identifier: accounts.nifty.email, pending: false });

  return <div className="profile-accounts">
    <fieldset className="profile-pill-group">
      <legend id="profile-accounts-legend">Connected accounts</legend>
      {pills.length
        ? <div className="profile-account-pills">{pills.map((pill) => <span className={`profile-account-pill is-${pill.provider}`} key={pill.key}>
            <span className="profile-account-mark" aria-hidden="true"><pill.Mark size={12} /></span>
            <strong>{pill.name}</strong>
            {pill.identifier ? <span className="profile-account-id">{pill.identifier}</span> : null}
            {pill.pending ? <em className="profile-account-state">Pending</em> : null}
          </span>)}</div>
        : <p className="profile-pill-empty">No evidence accounts are mapped to you yet.</p>}
    </fieldset>
    <p className="profile-account-note">{note ?? "Mapped to you by your workspace. Their activity appears in your recaps and reports."}</p>
  </div>;
}

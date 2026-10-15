import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Camera, Check, Plus, Trash2, UserRound } from "lucide-react";
import { apiRequestBlob } from "./api";
import { ItemPillGroup, ProviderAccountPills } from "./ProfilePills";
import { SettingsSwitch } from "./SettingsSwitch";
import type { OnboardingData, OnboardingSchedule, WorkProfileItem } from "./types";
import { supportedTimezones, timezoneLabel } from "../../../src/modules/work-os/timezones";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LANGUAGE_OPTIONS = [
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
] as const;

type ProfileFormState = {
  displayName: string;
  timezone: string;
  language: string;
  weekStart: number;
  timeFormat: string;
  schedule: OnboardingSchedule;
  desktopEnabled: boolean;
  sensitiveAppExclusions: string;
  archetypeId: string;
  customRoleTitle: string;
  specialtyIds: string[];
  /** Picked signals and your own additions, kept as one structured list so the
   * save never re-parses typed text and ids stay stable across edits. */
  items: WorkProfileItem[];
  voiceUpdatesEnabled: boolean;
};

export type ProfileSettingsPatch = {
  displayName: string;
  timezone: string;
  language: string;
  weekStart: number;
  timeFormat: string | null;
  schedule: OnboardingSchedule;
  notifications: { desktopEnabled: boolean };
  privacy: { sensitiveAppExclusions: string[] };
  workPreferences: {
    archetypeId: string;
    customRoleTitle: string;
    specialtyIds: string[];
    items: WorkProfileItem[];
    voiceUpdatesEnabled: boolean;
  };
  revision: number;
  clientMutationKey: string;
  source: "desktop";
};

type ProfileSettingsProps = {
  data: OnboardingData;
  mode: "page" | "modal";
  busy?: boolean;
  onSave: (patch: ProfileSettingsPatch, avatar: File | null, removeAvatar: boolean) => Promise<void>;
  onNotify: (tone: "success" | "error" | "info", message: string, title?: string) => void;
};

const initials = (value: string | null | undefined) => (value ?? "Work OS").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "WO";
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);

function formFromData(data: OnboardingData): ProfileFormState {
  const work = data.profile.workPreferences;
  return {
    displayName: data.profile.displayName,
    timezone: data.profile.timezone,
    language: data.profile.language,
    weekStart: data.profile.weekStart,
    timeFormat: data.profile.timeFormat ?? "",
    schedule: {
      daysOfWeek: [...data.profile.schedule.daysOfWeek],
      shiftStart: data.profile.schedule.shiftStart,
      shiftEnd: data.profile.schedule.shiftEnd,
      breaks: data.profile.schedule.breaks.map((item) => ({ ...item })),
    },
    desktopEnabled: data.profile.notifications.desktopEnabled,
    sensitiveAppExclusions: data.profile.privacy.sensitiveAppExclusions.join(", "),
    archetypeId: work.archetypeId ?? work.inferredArchetypeId ?? "",
    customRoleTitle: work.customRoleTitle,
    specialtyIds: [...work.specialtyIds],
    items: work.items.map((item) => ({ ...item })),
    voiceUpdatesEnabled: work.voiceUpdatesEnabled,
  };
}

export function useProfileAvatar(avatarUrl: string | null | undefined) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    if (!avatarUrl) return () => undefined;
    void apiRequestBlob(avatarUrl, "Profile avatar").then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarUrl]);
  return source;
}

export function ProfileAvatar({ name, avatarUrl, className = "" }: { name: string; avatarUrl?: string | null; className?: string }) {
  const source = useProfileAvatar(avatarUrl);
  return <span className={`profile-avatar ${className}`} aria-hidden="true">
    {source ? <img src={source} alt="" /> : <>{initials(name) || <UserRound size={16} />}</>}
  </span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="profile-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="profile-editor-section">
      <header>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="profile-section-content">{children}</div>
    </section>
  );
}

export function ProfileSettings({ data, mode, busy = false, onSave, onNotify }: ProfileSettingsProps) {
  const [form, setForm] = useState(() => formFromData(data));
  const [avatar, setAvatar] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const avatarSource = useProfileAvatar(removeAvatar ? null : data.profile.avatarUrl);
  const previewSource = avatarPreview ?? avatarSource;
  const timezones = useMemo(() => supportedTimezones(), []);
  const selectedArchetype = data.catalog.archetypes.find((entry) => entry.id === form.archetypeId) ?? null;

  useEffect(() => {
    setForm(formFromData(data));
    setAvatar(null);
    setRemoveAvatar(false);
    setSaved(false);
  }, [data.draft.revision, data.profile.displayName, data.profile.avatarUrl]);

  useEffect(() => {
    if (!avatar) {
      setAvatarPreview(null);
      return;
    }
    const source = URL.createObjectURL(avatar);
    setAvatarPreview(source);
    return () => URL.revokeObjectURL(source);
  }, [avatar]);

  function patchForm(patch: Partial<ProfileFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function updateSchedule(patch: Partial<OnboardingSchedule>) {
    setForm((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }));
    setSaved(false);
  }

  function updateBreak(index: number, patch: Partial<{ start: string; end: string }>) {
    updateSchedule({ breaks: form.schedule.breaks.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  }

  function selectArchetype(archetypeId: string) {
    const archetype = data.catalog.archetypes.find((entry) => entry.id === archetypeId);
    patchForm({ archetypeId, specialtyIds: [], ...(archetype?.id === "custom" ? {} : { customRoleTitle: "" }) });
  }

  function toggleDay(day: number) {
    const days = form.schedule.daysOfWeek.includes(day)
      ? form.schedule.daysOfWeek.filter((item) => item !== day)
      : [...form.schedule.daysOfWeek, day];
    updateSchedule({ daysOfWeek: days.sort((left, right) => left - right) });
  }

  function selectAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      onNotify("error", "Choose a JPEG, PNG, or WebP image.", "Photo not changed");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      onNotify("error", "Photos must be 5MB or smaller.", "Photo not changed");
      return;
    }
    setAvatar(file);
    setRemoveAvatar(false);
    setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.displayName.trim()) {
      onNotify("error", "Add a display name before saving.", "Profile not saved");
      return;
    }
    if (!form.schedule.daysOfWeek.length) {
      onNotify("error", "Choose at least one scheduled day.", "Settings not saved");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        displayName: form.displayName.trim(),
        timezone: form.timezone,
        language: form.language.trim() || "en",
        weekStart: form.weekStart,
        timeFormat: form.timeFormat || null,
        schedule: form.schedule,
        notifications: { desktopEnabled: form.desktopEnabled },
        privacy: { sensitiveAppExclusions: splitList(form.sensitiveAppExclusions) },
        // github_username is seeded during onboarding and then managed with the
        // workspace's provider mappings, so this modal omits it from the patch
        // and the stored value stays untouched.
        workPreferences: {
          archetypeId: form.archetypeId,
          customRoleTitle: form.customRoleTitle.trim(),
          specialtyIds: form.specialtyIds,
          items: form.items,
          voiceUpdatesEnabled: form.voiceUpdatesEnabled,
        },
        revision: data.draft.revision,
        clientMutationKey: crypto.randomUUID(),
        source: "desktop",
      }, avatar, removeAvatar);
      setAvatar(null);
      setAvatarPreview(null);
      setRemoveAvatar(false);
      setSaved(true);
      onNotify("success", "Your profile and workspace preferences are synced.", "Settings saved");
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Your settings could not be saved.", "Settings not saved");
    } finally {
      setSaving(false);
    }
  }

  const content = <>
    <Section title="Identity" description="The details Work OS uses across your workspace.">
      <div className="profile-identity">
        <div className="profile-photo-stack">
          <span className="profile-photo-preview">{previewSource ? <img src={previewSource} alt="" /> : initials(form.displayName)}</span>
          <div className="profile-photo-actions">
            <label className="profile-photo-button">
              <Camera size={14} /> Change photo
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectAvatar} />
            </label>
            {(avatar || data.profile.avatarUrl) && <button type="button" className="profile-remove-photo" onClick={() => { setAvatar(null); setRemoveAvatar(true); setSaved(false); }}><Trash2 size={13} /> Remove</button>}
          </div>
        </div>
        <div className="profile-identity-fields">
          <Field label="Display name" hint="Shown across Work OS."><input value={form.displayName} maxLength={120} onChange={(event) => patchForm({ displayName: event.target.value })} autoComplete="name" /></Field>
          <Field label="Account email" hint="Managed by your sign-in provider."><input value={data.profile.email} readOnly aria-readonly="true" /></Field>
        </div>
      </div>
    </Section>

    <Section title="Region &amp; time" description="Set local time, language, and calendar defaults.">
      <div className="profile-field-grid">
        <Field label="Timezone"><select value={form.timezone} onChange={(event) => patchForm({ timezone: event.target.value })}>{timezones.map((timezone) => <option key={timezone} value={timezone}>{timezoneLabel(timezone)}</option>)}</select></Field>
        <Field label="Language"><select value={form.language} onChange={(event) => patchForm({ language: event.target.value })}>{!LANGUAGE_OPTIONS.some(([value]) => value === form.language) && <option value={form.language}>{form.language}</option>}{LANGUAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Week starts"><select value={String(form.weekStart)} onChange={(event) => patchForm({ weekStart: Number(event.target.value) })}><option value="1">Monday</option><option value="0">Sunday</option><option value="6">Saturday</option></select></Field>
        <Field label="Time format"><select value={form.timeFormat} onChange={(event) => patchForm({ timeFormat: event.target.value })}><option value="">Use workspace default</option><option value="24h">24-hour</option><option value="12h">12-hour</option></select></Field>
      </div>
    </Section>

    <Section title="Workday" description="Choose when Work OS expects your day to start, end, and pause.">
      <div className="profile-schedule">
        <div className="profile-schedule-note">Used for clock-in windows and scheduled check-ins.</div>
        <div className="profile-day-picker" role="group" aria-label="Scheduled days">{[{ value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" }].map((day) => <button key={day.value} type="button" aria-pressed={form.schedule.daysOfWeek.includes(day.value)} onClick={() => toggleDay(day.value)}>{day.label}</button>)}</div>
        <div className="profile-field-grid compact"><Field label="Starts"><input type="time" value={form.schedule.shiftStart} onChange={(event) => updateSchedule({ shiftStart: event.target.value })} /></Field><Field label="Ends"><input type="time" value={form.schedule.shiftEnd} onChange={(event) => updateSchedule({ shiftEnd: event.target.value })} /></Field></div>
        <div className="profile-breaks"><div className="profile-subhead"><strong>Break windows</strong><button type="button" className="profile-inline-action" onClick={() => updateSchedule({ breaks: [...form.schedule.breaks, { start: "12:00", end: "12:30" }] })}><Plus size={13} /> Add break</button></div>{form.schedule.breaks.length ? form.schedule.breaks.map((item, index) => <div className="profile-break-row" key={`${index}-${item.start}-${item.end}`}><input type="time" aria-label={`Break ${index + 1} starts`} value={item.start} onChange={(event) => updateBreak(index, { start: event.target.value })} /><span>to</span><input type="time" aria-label={`Break ${index + 1} ends`} value={item.end} onChange={(event) => updateBreak(index, { end: event.target.value })} /><button type="button" aria-label={`Remove break ${index + 1}`} onClick={() => updateSchedule({ breaks: form.schedule.breaks.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={13} /></button></div>) : <small className="profile-muted">No break windows added.</small>}</div>
      </div>
      <div className="profile-preference-row"><div><strong>Desktop check-ins</strong><small>Show scheduled check-ins from the desktop companion.</small></div><SettingsSwitch label="Desktop check-ins" checked={form.desktopEnabled} onChange={(value) => patchForm({ desktopEnabled: value })} /></div>
    </Section>

    <Section title="Privacy" description="Keep sensitive apps and domains outside activity context.">
      <Field label="Sensitive app or domain exclusions" hint="Separate entries with commas."><input value={form.sensitiveAppExclusions} onChange={(event) => patchForm({ sensitiveAppExclusions: event.target.value })} placeholder="password manager, private.example" /></Field>
      <div className="profile-readonly-row"><div><strong>Screenshot analysis consent</strong><small>Managed through the onboarding safety step.</small></div><span className={`status-chip${data.profile.privacy.screenshotAnalysisConsent ? " is-positive" : ""}`}>{data.profile.privacy.screenshotAnalysisConsent ? "Accepted" : "Not accepted"}</span></div>
    </Section>

    <Section title="Work profile" description="Give Otto enough context to understand the work you do.">
      <div className="profile-field-grid"><Field label="Work scope"><select value={form.archetypeId} onChange={(event) => selectArchetype(event.target.value)}>{data.catalog.archetypes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field><Field label="Custom role title"><input value={form.customRoleTitle} onChange={(event) => patchForm({ customRoleTitle: event.target.value })} placeholder={selectedArchetype?.id === "custom" ? "e.g. Customer operations" : "Optional"} /></Field></div>
      {selectedArchetype?.specialties.length ? <fieldset className="profile-specialties"><legend>Specialties</legend><div>{selectedArchetype.specialties.map((specialty) => <label key={specialty.id}><input type="checkbox" checked={form.specialtyIds.includes(specialty.id)} onChange={() => patchForm({ specialtyIds: form.specialtyIds.includes(specialty.id) ? form.specialtyIds.filter((id) => id !== specialty.id) : [...form.specialtyIds, specialty.id] })} /><span>{specialty.name}</span></label>)}</div></fieldset> : null}
      <div className="profile-field-grid">
        <ItemPillGroup kind="responsibility" legend="Responsibilities" legendId="profile-responsibilities-legend" items={form.items} options={selectedArchetype?.items ?? []} disabled={busy || saving} onChange={(items) => patchForm({ items })} />
        <ItemPillGroup kind="deliverable" legend="Outputs" legendId="profile-outputs-legend" items={form.items} options={selectedArchetype?.items ?? []} disabled={busy || saving} onChange={(items) => patchForm({ items })} />
      </div>
      <ItemPillGroup kind="evidence" legend="Evidence sources" legendId="profile-evidence-legend" items={form.items} options={selectedArchetype?.items ?? []} disabled={busy || saving} onChange={(items) => patchForm({ items })} />
      {data.providerAccounts ? <ProviderAccountPills accounts={data.providerAccounts} /> : null}
      <div className="profile-preference-row"><div><strong>Voice updates</strong><small>Use voice notes as drafts for work updates.</small></div><SettingsSwitch label="Voice updates" checked={form.voiceUpdatesEnabled} onChange={(value) => patchForm({ voiceUpdatesEnabled: value })} /></div>
    </Section>
  </>;

  const actions = <div className="profile-editor-actions"><span className="profile-save-state" role="status">{saving ? "Saving…" : saved ? <><Check size={14} /> Saved to your account</> : "Changes sync when you save."}</span><button type="submit" className="primary" disabled={busy || saving}>{saving ? "Saving…" : "Save changes"}</button></div>;

  return mode === "modal"
    ? <form className="profile-editor profile-editor-modal" onSubmit={submit}><div className="task-modal-body profile-editor-body">{content}</div>{actions}</form>
    : <form className="profile-editor profile-editor-page" onSubmit={submit}>{content}{actions}</form>;
}

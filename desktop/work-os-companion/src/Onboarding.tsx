import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, BriefcaseBusiness, Check, CircleAlert, Clock3, LogOut, Plus, ShieldCheck, Sparkles, Trash2, UserRound, Wifi } from "lucide-react";
import type { AttendanceProjection, OnboardingData, OnboardingSchedule, ProfileItemKind, WorkProfileItem } from "./types";
import seenArt from "./assets/onboarding/phase-seen.webp";
import understoodArt from "./assets/onboarding/phase-understood.webp";
import controlArt from "./assets/onboarding/phase-control.webp";
import preparedArt from "./assets/onboarding/phase-prepared.webp";
import safeArt from "./assets/onboarding/phase-safe.webp";
import connectedArt from "./assets/onboarding/phase-connected.webp";
import wordmark from "./assets/work-os-mark.png";
import { supportedTimezones, timezoneLabel } from "../../../src/modules/work-os/timezones";
import { createCoalescedDraftQueue, onboardingHydrationKey, shouldHydrateOnboardingForm, type DraftSaveState } from "./onboardingDraftState";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

const PHASES = [
  { id: "seen", feeling: "Welcome", title: "Your workspace is ready for you.", body: "We’ve brought in the basics so setup feels quick, familiar, and personal from the start.", art: seenArt },
  { id: "understood", feeling: "Understood", title: "Tell us how you contribute.", body: "Choose a broad work scope. Your official company role stays unchanged.", art: understoodArt },
  { id: "profile", feeling: "In control", title: "Shape the profile that guides your companion.", body: "Keep, remove, reorder, or add the signals that describe useful work.", art: controlArt },
  { id: "prepared", feeling: "Prepared", title: "Set the rhythm around your day.", body: "Confirm when you usually work and how the companion should reach you.", art: preparedArt },
  { id: "safe", feeling: "Safe", title: "Your boundaries stay explicit.", body: "Review the required Work OS tracking and screenshot-analysis boundaries before connecting.", art: safeArt },
  { id: "connected", feeling: "Connected", title: "Your Work OS is ready.", body: "We are checking Worktivity for your observed attendance status.", art: connectedArt },
] as const;
type PhaseId = (typeof PHASES)[number]["id"];
const DAYS = [{ value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" }];

interface FormState {
  preferredName: string; email: string; timezone: string; language: string; schedule: OnboardingSchedule;
  desktopNotifications: boolean; sensitiveAppExclusions: string;
  acceptWorkOsConsent: boolean; voiceUpdatesEnabled: boolean; githubUsername: string;
  archetypeId: string; customRoleTitle: string; specialtyIds: string[]; items: WorkProfileItem[];
}

function initial(data: OnboardingData): FormState {
  return {
    preferredName: data.profile.displayName, email: data.profile.email, timezone: data.profile.timezone, language: data.profile.language,
    schedule: data.profile.schedule, desktopNotifications: data.profile.notifications.desktopEnabled,
    sensitiveAppExclusions: data.profile.privacy.sensitiveAppExclusions.join(", "),
    acceptWorkOsConsent: data.employeeRequirements.consentProvided && data.employeeRequirements.screenshotConsentProvided && data.employeeRequirements.privacyAcknowledged,
    voiceUpdatesEnabled: data.profile.workPreferences.voiceUpdatesEnabled, githubUsername: data.profile.workPreferences.githubUsername,
    archetypeId: data.profile.workPreferences.archetypeId ?? data.profile.workPreferences.inferredArchetypeId ?? "",
    customRoleTitle: data.profile.workPreferences.customRoleTitle,
    specialtyIds: data.profile.workPreferences.specialtyIds,
    items: data.profile.workPreferences.items,
  };
}

export default function Onboarding({ data, simulated, busy, onSubmit, onSaveDraft, onComplete, onOpenDebug, onLogout, appError }: {
  data: OnboardingData; simulated: boolean; busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<AttendanceProjection | undefined>;
  onSaveDraft: (body: Record<string, unknown>) => Promise<OnboardingData | { queued: true } | void>;
  onComplete: () => void; onOpenDebug: () => void; onLogout: () => void; appError?: string;
}) {
  const restored = Math.max(0, PHASES.findIndex((phase) => phase.id === data.draft.step));
  const [phaseIndex, setPhaseIndex] = useState(restored >= PHASES.length - 1 ? 0 : restored);
  const [form, setForm] = useState(() => initial(data));
  const [removed, setRemoved] = useState<WorkProfileItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [newKind, setNewKind] = useState<ProfileItemKind>("responsibility");
  const [formError, setFormError] = useState("");
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>("saved");
  const [attendance, setAttendance] = useState<AttendanceProjection | undefined>();
  const hydrated = useRef(false);
  const mutationKey = useRef(crypto.randomUUID());
  const draftRevision = useRef(data.draft.revision);
  const saveWorker = useRef<((step: PhaseId) => Promise<void>) | null>(null);
  const saveCoordinator = useRef<{ enqueue(input: PhaseId): Promise<void> } | null>(null);
  const hydratedIdentity = useRef<string | null>(null);
  const phase = PHASES[phaseIndex];
  const archetype = data.catalog.archetypes.find((entry) => entry.id === form.archetypeId);

  const hydrationKey = onboardingHydrationKey({ email: data.profile.email });
  useEffect(() => {
    if (shouldHydrateOnboardingForm(hydratedIdentity.current, hydrationKey)) {
      setForm(initial(data));
      draftRevision.current = data.draft.revision;
      hydratedIdentity.current = hydrationKey;
    } else if (data.draft.revision > draftRevision.current) {
      // A confirmed response advances concurrency metadata only. It must not
      // reset fields that may have changed while the response was in flight.
      draftRevision.current = data.draft.revision;
    }
    hydrated.current = true;
  }, [data.draft.revision, hydrationKey]);
  useEffect(() => {
    if (!hydrated.current || phase.id === "connected") return;
    const timer = window.setTimeout(() => void saveDraft(phase.id).catch(() => undefined), 700);
    return () => clearTimeout(timer);
  }, [form, phase.id]);

  const grouped = useMemo(() => (["responsibility", "deliverable", "evidence"] as ProfileItemKind[]).map((kind) => ({ kind, items: form.items.filter((entry) => entry.kind === kind) })), [form.items]);
  function workPreferences() { return { archetypeId: form.archetypeId, customRoleTitle: form.customRoleTitle, specialtyIds: form.specialtyIds, items: form.items, voiceUpdatesEnabled: form.voiceUpdatesEnabled, githubUsername: form.githubUsername }; }
  function draftBody(step: PhaseId) { return { step, revision: draftRevision.current, clientMutationKey: mutationKey.current, preferredName: form.preferredName, email: form.email, timezone: form.timezone, language: form.language, schedule: form.schedule, notifications: { desktopEnabled: form.desktopNotifications }, privacy: { sensitiveAppExclusions: form.sensitiveAppExclusions.split(",").map((entry) => entry.trim()).filter(Boolean) }, workPreferences: workPreferences(), source: "desktop" }; }
  saveWorker.current = async (nextStep) => {
    setDraftSaveState("saving");
    try {
      const saved = await onSaveDraft(draftBody(nextStep));
      if (saved && "queued" in saved) { setDraftSaveState("offline"); return; }
      if (saved) draftRevision.current = saved.draft.revision;
      mutationKey.current = crypto.randomUUID();
      setDraftSaveState("saved");
    } catch (error) {
      setDraftSaveState(/changed on another device/i.test(error instanceof Error ? error.message : "") ? "conflict" : "offline");
      throw error;
    }
  };
  if (!saveCoordinator.current) saveCoordinator.current = createCoalescedDraftQueue((step) => saveWorker.current!(step));
  function saveDraft(step: PhaseId) { return saveCoordinator.current!.enqueue(step); }
  function schedule(patch: Partial<OnboardingSchedule>) { setForm((current) => ({ ...current, schedule: { ...current.schedule, ...patch } })); }
  function selectArchetype(id: string) {
    const next = data.catalog.archetypes.find((entry) => entry.id === id);
    if (!next) return;
    const oldSuggested = new Set(data.catalog.archetypes.flatMap((entry) => entry.items.map((item) => item.id)));
    const preserved = form.items.filter((item) => item.source !== "suggested" || !oldSuggested.has(item.id));
    const selectedRemoved = new Set(removed.map((item) => item.id));
    setForm((current) => ({ ...current, archetypeId: id, specialtyIds: [], items: [...preserved, ...next.items.filter((item) => !selectedRemoved.has(item.id))] }));
  }
  function validateCurrent() {
    if (phase.id === "seen" && (!form.preferredName.trim() || !form.email.trim())) return "Confirm your name and work email.";
    if (phase.id === "understood" && !form.archetypeId) return "Choose the type of work you do.";
    if (phase.id === "understood" && form.archetypeId === "custom" && !form.customRoleTitle.trim()) return "Describe your custom work role.";
    if (phase.id === "profile" && !form.items.length) return "Keep or add at least one work-profile signal.";
    if (phase.id === "prepared" && (!form.timezone.trim() || !form.schedule.daysOfWeek.length)) return "Confirm your timezone and at least one working day.";
    if (phase.id === "safe" && !form.acceptWorkOsConsent) return "Accept the Work OS tracking and screenshot-analysis policy to continue.";
    return "";
  }
  async function next() {
    const problem = validateCurrent(); setFormError(problem); if (problem) return;
    if (phase.id === "safe") {
      const result = await onSubmit({ ...draftBody("safe"), privacy: { screenshotAnalysisConsent: true, sensitiveAppExclusions: form.sensitiveAppExclusions.split(",").map((entry) => entry.trim()).filter(Boolean) }, acceptTrackingConsent: true, privacyNoticeAcknowledged: true });
      setAttendance(result); setPhaseIndex(PHASES.length - 1); return;
    }
    await saveDraft(PHASES[Math.min(phaseIndex + 1, PHASES.length - 2)].id);
    setPhaseIndex((current) => Math.min(current + 1, PHASES.length - 1));
  }

  return <main className="guided-onboarding" aria-busy={busy}>
    <aside className="onboarding-story" aria-live="polite">
      <div className="story-brand"><img src={assetUrl(wordmark)} alt="" /><strong>WORK <b>OS</b></strong></div>
      <div className="story-copy"><span>{phase.feeling}</span><h1>{phase.title}</h1><p>{phase.body}</p></div>
      <img key={phase.id} className="phase-art" src={assetUrl(phase.art)} alt="" />
      <div className="phase-path" aria-label={`Onboarding progress: ${phase.feeling}`}>
        {PHASES.map((entry, index) => <i key={entry.id} className={index <= phaseIndex ? "active" : ""} />)}
      </div>
    </aside>
    <section className="onboarding-workspace">
      <header><span>{phase.feeling}</span><div><button className="quiet-action" disabled={busy} onClick={onLogout}><LogOut size={15} /> Sign out</button><button className="debug-trigger" title="Open debug scenarios" aria-label="Open debug scenarios" onClick={onOpenDebug}><CircleAlert size={16} /></button></div></header>
      {simulated && <div className="debug-notice"><CircleAlert size={15} /> Scenario mode. Writes stay on this device.</div>}
      <div className="phase-content" key={phase.id}>
        {phase.id === "seen" && <Seen data={data} form={form} setForm={setForm} />}
        {phase.id === "understood" && <Understood data={data} form={form} setForm={setForm} select={selectArchetype} />}
        {phase.id === "profile" && <ProfileBoard grouped={grouped} removed={removed} newKind={newKind} newItem={newItem} setNewKind={setNewKind} setNewItem={setNewItem} setForm={setForm} setRemoved={setRemoved} />}
        {phase.id === "prepared" && <Prepared form={form} setForm={setForm} schedule={schedule} authoritativeBreaks={data.breakPolicy.worktivityAuthoritative} />}
        {phase.id === "safe" && <Safe data={data} form={form} setForm={setForm} />}
        {phase.id === "connected" && <Connected attendance={attendance} onComplete={onComplete} />}
      </div>
      {(appError || formError) && <div className="onboarding-error" role="alert" aria-live="assertive"><CircleAlert size={16} />{formError || appError}</div>}
      {phase.id !== "connected" && <footer className="phase-actions"><button className="back" disabled={busy || phaseIndex === 0} onClick={() => setPhaseIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={16} /> Back</button><span className={`save-state ${draftSaveState}`}>{draftSaveState === "saving" ? "Saving…" : draftSaveState === "offline" ? "Offline · queued for replay" : draftSaveState === "conflict" ? "Conflict · refresh required" : `Saved · revision ${draftRevision.current}`}</span><button className="primary" disabled={busy || draftSaveState === "conflict"} onClick={() => void next()}>{busy ? "Saving…" : phase.id === "safe" ? "Connect Work OS" : "Continue"}<ArrowRight size={16} /></button></footer>}
    </section>
  </main>;
}

function Seen({ data, form, setForm }: any) { return <><PhaseIntro icon={UserRound} eyebrow="Workspace context" title={`Welcome, ${form.preferredName || "there"}.`} body="It’s good to have you here. We’ve brought in the basics from your workspace—just confirm what feels right, and we’ll help you start the day with clarity." /><div className="identity-grid"><label><span>Preferred name</span><input value={form.preferredName} onChange={(e) => setForm({ ...form, preferredName: e.target.value })} /></label><label><span>Work email</span><input value={form.email} readOnly /></label></div><div className="context-list"><Context label="Official role" value={data.organizationSetup.roleProfile?.name || "Pending manager setup"} /><Context label="Team" value={data.organizationSetup.teams.map((team: any) => team.name).join(", ") || "Pending manager setup"} /><Context label="Manager" value={data.organizationSetup.managers.map((manager: any) => manager.display_name).join(", ") || "Pending manager setup"} /></div><div className="provider-line"><span className={data.providerPrefill.nifty.mapped ? "ok" : ""}>Nifty {data.providerPrefill.nifty.mapped ? "connected" : "not mapped"}</span><span className={data.providerPrefill.worktivity.mapped ? "ok" : ""}>Worktivity {data.providerPrefill.worktivity.mapped ? "connected" : "not mapped"}</span></div></>; }
function Understood({ data, form, setForm, select }: any) { const selected = data.catalog.archetypes.find((entry: any) => entry.id === form.archetypeId); return <><PhaseIntro icon={BriefcaseBusiness} eyebrow="Work archetype" title="What kind of work do you do?" body="This personalizes prompts and reports. It never changes your official company role." />{data.profile.workPreferences.inferredArchetypeId && <div className="suggestion-note"><Sparkles size={15} /> Suggested from your imported role</div>}<div className="archetype-grid">{data.catalog.archetypes.map((entry: any) => <button key={entry.id} className={form.archetypeId === entry.id ? "selected" : ""} onClick={() => select(entry.id)}><strong>{entry.name}</strong><small>{entry.description}</small>{form.archetypeId === entry.id && <Check size={16} />}</button>)}</div>{form.archetypeId === "custom" && <label className="wide-input"><span>Your role</span><input value={form.customRoleTitle} onChange={(e) => setForm({ ...form, customRoleTitle: e.target.value })} placeholder="Describe your work" /></label>}{selected?.specialties.length > 0 && <div className="specialties"><span>Specialties</span><div>{selected.specialties.map((specialty: any) => <button className={form.specialtyIds.includes(specialty.id) ? "selected" : ""} key={specialty.id} onClick={() => setForm({ ...form, specialtyIds: form.specialtyIds.includes(specialty.id) ? form.specialtyIds.filter((id: string) => id !== specialty.id) : [...form.specialtyIds, specialty.id] })}>{specialty.name}</button>)}</div></div>}</>; }
function ProfileBoard({ grouped, removed, newKind, newItem, setNewKind, setNewItem, setForm, setRemoved }: any) { function move(id: string, delta: number) { setForm((current: any) => { const index=current.items.findIndex((item: any)=>item.id===id), target=index+delta;if(index<0||target<0||target>=current.items.length)return current;const items=[...current.items];[items[index],items[target]]=[items[target],items[index]];return {...current,items}; }); } return <><PhaseIntro icon={Sparkles} eyebrow="Your work profile" title="Does this sound like your work?" body="These are profile signals—not tasks. Every suggestion stays editable and nothing is written to Nifty." /><div className="profile-board">{grouped.map((group: any) => <section key={group.kind}><header><strong>{group.kind === "responsibility" ? "Responsibilities" : group.kind === "deliverable" ? "Deliverables" : "Evidence sources"}</strong><small>{group.items.length}</small></header>{group.items.map((item: WorkProfileItem) => <div className="profile-item" key={item.id}><span>{item.label}<em>{item.source}</em></span><button aria-label={`Move ${item.label} up`} onClick={() => move(item.id,-1)}><ArrowUp size={14}/></button><button aria-label={`Move ${item.label} down`} onClick={() => move(item.id,1)}><ArrowDown size={14}/></button><button aria-label={`Remove ${item.label}`} onClick={() => {setRemoved((all: WorkProfileItem[])=>[...all,item]);setForm((current: any)=>({...current,items:current.items.filter((entry: any)=>entry.id!==item.id)}));}}><Trash2 size={14}/></button></div>)}{!group.items.length && <p className="empty-group">No items kept in this group.</p>}</section>)}</div><div className="add-profile-item"><select value={newKind} onChange={(e)=>setNewKind(e.target.value)}><option value="responsibility">Responsibility</option><option value="deliverable">Deliverable</option><option value="evidence">Evidence source</option></select><input value={newItem} onChange={(e)=>setNewItem(e.target.value)} placeholder="Add your own" /><button disabled={!newItem.trim()} onClick={()=>{const item={id:`user:${newKind}:${Date.now()}`,kind:newKind,label:newItem.trim(),source:"user"};setForm((current:any)=>({...current,items:[...current.items,item]}));setNewItem("");}}><Plus size={15}/> Add</button></div>{removed.length>0&&<button className="restore" onClick={()=>{setForm((current:any)=>({...current,items:[...current.items,...removed]}));setRemoved([]);}}>Restore {removed.length} removed suggestion{removed.length===1?"":"s"}</button>}</>; }
function Prepared({ form, setForm, schedule, authoritativeBreaks }: any) { const [breakDraft,setBreakDraft]=useState(form.schedule.breaks[0] ?? { start: "", end: "" }); const patchBreak=(patch:Partial<{start:string;end:string}>)=>{const next={...breakDraft,...patch};setBreakDraft(next);schedule({breaks:next.start&&next.end?[next]:[]});}; return <><PhaseIntro icon={Clock3} eyebrow="Your rhythm" title="When does work usually happen?" body="This is your proposed schedule. A manager-owned official schedule still takes precedence." /><div className="day-selector">{DAYS.map((day)=><button key={day.value} className={form.schedule.daysOfWeek.includes(day.value)?"selected":""} onClick={()=>schedule({daysOfWeek:form.schedule.daysOfWeek.includes(day.value)?form.schedule.daysOfWeek.filter((value:number)=>value!==day.value):[...form.schedule.daysOfWeek,day.value]})}>{day.label}</button>)}</div><div className="schedule-grid"><TimezoneCombobox value={form.timezone} onChange={(timezone)=>setForm({...form,timezone})}/><label><span>Shift starts</span><input type="time" value={form.schedule.shiftStart} onChange={(e)=>schedule({shiftStart:e.target.value})}/></label><label><span>Shift ends</span><input type="time" value={form.schedule.shiftEnd} onChange={(e)=>schedule({shiftEnd:e.target.value})}/></label>{!authoritativeBreaks&&<><label><span>Break starts</span><input type="time" value={breakDraft.start} onChange={(e)=>patchBreak({start:e.target.value})}/></label><label><span>Break ends</span><input type="time" value={breakDraft.end} onChange={(e)=>patchBreak({end:e.target.value})}/></label></>}</div>{authoritativeBreaks&&<p className="policy-note">Break time is derived only from explicit Worktivity OnBreak records for this organization.</p>}<div className="preference-list"><Toggle icon={Bell} title="Desktop notifications" detail="Shift prompts, check-ins, and EOD review" checked={form.desktopNotifications} onChange={(value:boolean)=>setForm({...form,desktopNotifications:value})}/><Toggle icon={Sparkles} title="Voice updates" detail="Use voice when the microphone flow is available" checked={form.voiceUpdatesEnabled} onChange={(value:boolean)=>setForm({...form,voiceUpdatesEnabled:value})}/></div></>; }
function TimezoneCombobox({ value, onChange }: { value: string; onChange: (value: string) => void }) { const [query,setQuery]=useState(value); const [open,setOpen]=useState(false); const [activeIndex,setActiveIndex]=useState(0); const listboxId=useId(); const options=useMemo(()=>supportedTimezones().filter((zone)=>zone.toLowerCase().includes(query.toLowerCase())).slice(0,50),[query]); const choose=(index:number)=>{const zone=options[index];if(!zone)return;onChange(zone);setQuery(zone);setOpen(false);}; const move=(index:number)=>setActiveIndex(Math.max(0,Math.min(options.length-1,index))); return <label className="timezone-combobox"><span>Timezone</span><input role="combobox" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={open&&options[activeIndex]?`${listboxId}-${activeIndex}`:undefined} aria-autocomplete="list" value={query} onFocus={()=>{setOpen(true);setActiveIndex(Math.max(0,options.indexOf(value)))}} onChange={(e)=>{setQuery(e.target.value);setOpen(true);setActiveIndex(0)}} onKeyDown={(e)=>{if(e.key==="Escape"){setOpen(false);return;}if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);move(open?activeIndex+1:0);return;}if(e.key==="ArrowUp"){e.preventDefault();setOpen(true);move(open?activeIndex-1:options.length-1);return;}if(e.key==="Home"){e.preventDefault();setOpen(true);move(0);return;}if(e.key==="End"){e.preventDefault();setOpen(true);move(options.length-1);return;}if(e.key==="Enter"){e.preventDefault();choose(open?activeIndex:0);}if(e.key==="Tab")setOpen(false);}} placeholder="Search city or IANA timezone" />{open&&<ul id={listboxId} role="listbox">{options.map((zone,index)=><li id={`${listboxId}-${index}`} role="option" aria-selected={zone===value} data-active={index===activeIndex||undefined} key={zone}><button type="button" onMouseDown={(e)=>e.preventDefault()} onMouseMove={()=>setActiveIndex(index)} onClick={()=>choose(index)}>{timezoneLabel(zone)} <small>{zone}</small></button></li>)}</ul>}</label>; }
function Safe({ data, form, setForm }: any) { return <><PhaseIntro icon={ShieldCheck} eyebrow="Trust and privacy" title="Clear boundaries, before anything begins." body={data.policy.assurance}/><div className="policy-summary"><strong>Work OS uses this information for:</strong><p>{data.policy.purpose}</p><ul><li>Sampled Worktivity screenshots are analysed as neutral activity context.</li><li>{data.screenshotPolicy.retention}</li><li>{data.screenshotPolicy.sensitiveCapture}</li><li>{data.screenshotPolicy.limitation}</li></ul></div><label className="wide-input"><span>Sensitive apps or domains to exclude</span><input value={form.sensitiveAppExclusions} onChange={(e)=>setForm({...form,sensitiveAppExclusions:e.target.value})} placeholder="Banking, personal email, health portals"/></label><div className="consent-box"><label><input type="checkbox" checked={form.acceptWorkOsConsent} onChange={(e)=>setForm({...form,acceptWorkOsConsent:e.target.checked})}/><span>I accept Work OS tracking and the sampled screenshot-analysis policy above, including encrypted 30-day raw retention, sensitive-capture deletion, and the fact screenshots do not prove productivity or task completion.</span></label><small>{data.policy.version}</small></div></>; }
function Connected({ attendance, onComplete }: {attendance?:AttendanceProjection;onComplete:()=>void}) { const state=attendance?.state??"unknown"; const title=state==="active"?"You’re online.":state==="paused"?"Connected. You’re on a break.":state==="off_shift"?"Connected — waiting for Worktivity.":"Connected — attendance unavailable."; return <div className="connected-state"><span className={`connection-orb ${state}`}><Wifi size={30}/></span><small>Workspace connected</small><h2>{title}</h2><p>{attendance?.message??"Work OS will keep checking Worktivity in the background without guessing your status."}</p>{attendance?.stale&&<div className="stale-status">Last observed status · refresh pending</div>}<button className="primary" onClick={onComplete}>Enter My Day <ArrowRight size={16}/></button></div>; }
function PhaseIntro({ icon:Icon, eyebrow, title, body }: any) { return <div className="phase-intro"><span><Icon size={15}/>{eyebrow}</span><h2>{title}</h2><p>{body}</p></div>; }
function Context({label,value}:{label:string;value:string}) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Toggle({icon:Icon,title,detail,checked,onChange}:any) { return <label className="guided-toggle"><Icon size={17}/><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)}/></label>; }

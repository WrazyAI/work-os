import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Check, CircleAlert, LogOut, Plus, Sparkles, Trash2 } from "lucide-react";
import type { AttendanceProjection, OnboardingData, OnboardingSchedule, ProfileItemKind, WorkProfileItem } from "./types";
import { supportedTimezones, timezoneLabel } from "../../../src/modules/work-os/timezones";
import { createCoalescedDraftQueue, onboardingHydrationKey, shouldHydrateOnboardingForm, type DraftSaveState } from "./onboardingDraftState";
import { OnboardingStage, STAGE_POSE, type StagePose } from "./OnboardingStage";
import { FadeArc } from "./LoadingUi";

/**
 * First run.
 *
 * The employee has not met the product yet, so Otto hosts this instead of
 * annotating it: he is on stage from the first frame, he says why each step
 * matters, and he carries the one piece of copy the step would otherwise have
 * to explain itself. The panel beside him stays in the quiet product language —
 * it does the work, the stage does the welcome.
 */
const PHASES = [
  {
    id: "seen",
    feeling: "Welcome",
    title: "Good to have you here.",
    line: "I’m Otto — I’ll be around while you work. Give me a couple of minutes now to learn how you work, and then I’ll stay out of your way.",
  },
  {
    id: "understood",
    feeling: "Understood",
    title: "What kind of work is it?",
    line: "Pick whichever is closest. This only shapes how I phrase things for you — your official company role stays exactly as it is.",
  },
  {
    id: "profile",
    feeling: "In control",
    title: "Here’s what I’ll listen for.",
    line: "Keep what sounds right, drop what doesn’t, and add anything I missed. None of it becomes a task, and none of it is written to Nifty.",
  },
  {
    id: "prepared",
    feeling: "Prepared",
    title: "When does work usually happen?",
    line: "I use this to time my check-ins and the end-of-day nudge. If your manager has set an official schedule, theirs takes precedence.",
  },
  {
    id: "safe",
    feeling: "Safe",
    title: "This part, I won’t rush.",
    line: "Read what is captured and what never is, then tell me yes. None of this measures how good your work is.",
  },
  {
    id: "connected",
    feeling: "Connected",
    title: "That’s everything.",
    line: "You’re set. Here is where things stand right now.",
  },
] as const;
type PhaseId = (typeof PHASES)[number]["id"];
const DAYS = [{ value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" }];

/** Otto listens through the form steps and only changes when something real
 *  happened: nothing at all, then work while the workspace is prepared. */
const PHASE_POSE: Record<PhaseId, StagePose> = {
  seen: "attending",
  understood: "attending",
  profile: "attending",
  prepared: "attending",
  safe: "attending",
  connected: "done",
};

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

export default function Onboarding({ data, simulated, busy, onSubmit, onSaveDraft, onComplete, onOpenDebug, onLogout, onNotify }: {
  data: OnboardingData; simulated: boolean; busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<AttendanceProjection | undefined>;
  onSaveDraft: (body: Record<string, unknown>) => Promise<OnboardingData | { queued: true } | void>;
  onComplete: () => void | Promise<void>; onOpenDebug: () => void; onLogout: () => void;
  onNotify: (tone: "success" | "error" | "info", message: string, title?: string) => void;
}) {
  const restored = Math.max(0, PHASES.findIndex((phase) => phase.id === data.draft.step));
  const [phaseIndex, setPhaseIndex] = useState(restored >= PHASES.length - 1 ? 0 : restored);
  // A draft that has never been written means nobody has seen any of this yet —
  // that is the only case where Otto introduces himself. Every other entry lands
  // straight on the step they left.
  const [stage, setStage] = useState<"welcome" | "form">(() => (restored === 0 && !data.draft.updatedAt ? "welcome" : "form"));
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [entering, setEntering] = useState(false);
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);
  const [form, setForm] = useState(() => initial(data));
  const [removed, setRemoved] = useState<WorkProfileItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [newKind, setNewKind] = useState<ProfileItemKind>("responsibility");
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

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
    // Nothing is written while the welcome is still open: otherwise an
    // employee who closes the app on the first screen would come back to a
    // draft that has "been seen" and never be greeted again.
    if (!hydrated.current || stage !== "form" || phase.id === "connected") return;
    const timer = window.setTimeout(() => void saveDraft(phase.id).catch(() => undefined), 700);
    return () => clearTimeout(timer);
  }, [form, phase.id, stage]);
  // An answer clears the mark it was carrying — and only that one, so editing
  // an unrelated control cannot hide a field that is still unanswered.
  useEffect(() => {
    if (!problem) return;
    if (!unansweredFields().some((issue) => issue.field === problem.field)) setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  useEffect(() => {
    if (!problem) return;
    panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus();
  }, [problem]);
  // A new step is new content with new controls; move the reading position to
  // its heading (but never on first render, which would steal boot focus).
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first || stage !== "form" || entering) return;
    panelRef.current?.querySelector<HTMLElement>(".phase-heading")?.focus();
  }, [phaseIndex, stage, entering]);

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
      onNotify("error", error instanceof Error ? error.message : "Your onboarding draft could not be saved.", "Onboarding draft not saved");
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
  /** Everything this step is still waiting for, keyed by the control that owns
   *  it, so the panel can mark that control instead of raising a notification
   *  far away from the field. */
  function unansweredFields(): { field: string; message: string }[] {
    const issues: { field: string; message: string }[] = [];
    if (phase.id === "seen") {
      if (!form.preferredName.trim()) issues.push({ field: "preferredName", message: "Add the name you want to be called." });
      if (!form.email.trim()) issues.push({ field: "email", message: "A work email is needed to finish setup." });
    }
    if (phase.id === "understood") {
      if (!form.archetypeId) issues.push({ field: "archetype", message: "Pick the closest fit to continue." });
      if (form.archetypeId === "custom" && !form.customRoleTitle.trim()) issues.push({ field: "customRole", message: "Describe the work in your own words." });
    }
    if (phase.id === "profile" && !form.items.length) issues.push({ field: "items", message: "Keep at least one signal so Otto knows what to listen for." });
    if (phase.id === "prepared") {
      if (!form.timezone.trim()) issues.push({ field: "timezone", message: "Confirm your timezone." });
      if (!form.schedule.daysOfWeek.length) issues.push({ field: "days", message: "Choose at least one working day." });
    }
    if (phase.id === "safe" && !form.acceptWorkOsConsent) issues.push({ field: "consent", message: "Accept the policy to connect Work OS." });
    return issues;
  }
  function validateCurrent() { return unansweredFields()[0] ?? null; }
  function goBack() {
    setDirection("back");
    setPhaseIndex((current) => Math.max(0, current - 1));
  }
  async function next() {
    const issue = validateCurrent();
    if (issue) { setProblem(issue); return; }
    setProblem(null);
    if (phase.id === "safe") {
      try {
        const result = await onSubmit({ ...draftBody("safe"), privacy: { screenshotAnalysisConsent: true, sensitiveAppExclusions: form.sensitiveAppExclusions.split(",").map((entry) => entry.trim()).filter(Boolean) }, acceptTrackingConsent: true, privacyNoticeAcknowledged: true });
        setAttendance(result);
        setDirection("forward");
        setPhaseIndex(PHASES.length - 1);
        onNotify("success", "Your preferences and consent were saved.", "Workspace connected");
      } catch (error) {
        onNotify("error", error instanceof Error ? error.message : "Work OS could not finish onboarding.", "Onboarding not completed");
      }
      return;
    }
    try { await saveDraft(PHASES[Math.min(phaseIndex + 1, PHASES.length - 2)].id); }
    catch { return; }
    setDirection("forward");
    setPhaseIndex((current) => Math.min(current + 1, PHASES.length - 1));
  }
  /** The finish is a hand-off: Otto works while the workspace is really being
   *  prepared, and this state lasts exactly as long as that takes. */
  async function enterWorkspace() {
    if (entering) return;
    setEntering(true);
    try {
      await onComplete();
    } catch (error) {
      setEntering(false);
      onNotify("error", error instanceof Error ? error.message : "Work OS could not finish setting up. Try again.", "Workspace setup did not finish");
    }
  }

  const welcoming = stage === "welcome";
  const pose: StagePose = entering ? "working" : PHASE_POSE[phase.id];
  const line = entering ? "Setting up your workspace — syncing your schedule, tasks, and provider context." : phase.line;
  const welcomeLine = "I’m Otto — I’ll be around while you work. Give me a couple of minutes now to learn how you work, and then I’ll stay out of your way.";
  return <main className="guided-onboarding" data-stage={stage} data-direction={direction} aria-busy={busy}>
    <OnboardingStage
      pose={pose}
      eyebrow={phase.feeling}
      title={welcoming ? "Hey, good to have you." : phase.title}
      line={welcoming ? welcomeLine : line}
      journey={welcoming ? undefined : { total: PHASES.length, index: phaseIndex, label: phase.feeling }}
      replayKey={welcoming ? "welcome" : `${phase.id}:${entering ? "entering" : "step"}`}
      topRight={<SessionControls busy={busy} onLogout={onLogout} onOpenDebug={onOpenDebug} />}
    >
      {welcoming && <div className="otto-bubble-actions">
        <button className="primary" onClick={() => setStage("form")}>Start setup <ArrowRight size={16} /></button>
        <span className="otto-bubble-note">Six short steps.</span>
      </div>}
    </OnboardingStage>
    {!welcoming && <section className="onboarding-workspace">
      <header><span>Workspace setup</span></header>
      {simulated && <div className="debug-notice"><CircleAlert size={15} /> Scenario mode. Writes stay on this device.</div>}
      <div className="phase-content" key={phase.id} ref={panelRef}>
        {phase.id === "seen" && <Seen data={data} form={form} setForm={setForm} problem={problem} />}
        {phase.id === "understood" && <Understood data={data} form={form} setForm={setForm} select={selectArchetype} problem={problem} />}
        {phase.id === "profile" && <ProfileBoard grouped={grouped} removed={removed} newKind={newKind} newItem={newItem} setNewKind={setNewKind} setNewItem={setNewItem} setForm={setForm} setRemoved={setRemoved} problem={problem} />}
        {phase.id === "prepared" && <Prepared form={form} setForm={setForm} schedule={schedule} authoritativeBreaks={data.breakPolicy.worktivityAuthoritative} problem={problem} />}
        {phase.id === "safe" && <Safe data={data} form={form} setForm={setForm} problem={problem} />}
        {phase.id === "connected" && <Connected attendance={attendance} entering={entering} onEnter={() => void enterWorkspace()} />}
      </div>
      {phase.id !== "connected" && <footer className="phase-actions"><button className="back" disabled={busy || phaseIndex === 0} onClick={goBack}><ArrowLeft size={16} /> Back</button><span className={`save-state ${draftSaveState}`}>{draftSaveState === "saving" ? "Saving…" : draftSaveState === "offline" ? "Offline · queued for replay" : draftSaveState === "conflict" ? "Conflict · refresh required" : "Saved"}</span><button className="primary" disabled={busy || draftSaveState === "conflict"} onClick={() => void next()}>{busy ? "Saving…" : phase.id === "safe" ? "Connect Work OS" : "Continue"}<ArrowRight size={16} /></button></footer>}
    </section>}
  </main>;
}

/** The panel's one heading: the concrete instruction for this step. The stage
 *  above carries the purpose, and Otto carries the reasoning, so nothing here
 *  repeats either of them. Focusable so a step change lands the reader on it. */
function PhaseHeading({ title }: { title: string }) {
  return <div className="phase-intro"><h2 className="phase-heading" tabIndex={-1}>{title}</h2></div>;
}
/** The message that belongs to a control. A group-level problem takes focus
 *  itself, because the thing it describes is a set of controls, not a field. */
function FieldError({ children, group = false, id }: { children: ReactNode; group?: boolean; id?: string }) {
  return <span className={`field-error${group ? " is-group" : ""}`} id={id} role="alert"
    tabIndex={group ? -1 : undefined} data-invalid={group ? "true" : undefined}>
    <CircleAlert size={13} aria-hidden="true" />{children}
  </span>;
}

/** Session chrome. It sits in the same corner whether or not the step panel is
 *  open, so signing out is never behind a step and never moves between them. */
function SessionControls({ busy, onLogout, onOpenDebug }: { busy: boolean; onLogout: () => void; onOpenDebug: () => void }) {
  return <div className="session-controls">
    <button className="quiet-action" disabled={busy} onClick={onLogout}><LogOut size={15} /> Sign out</button>
    <button className="debug-trigger" title="Open debug scenarios" aria-label="Open debug scenarios" onClick={onOpenDebug}><CircleAlert size={16} /></button>
  </div>;
}
function Seen({ data, form, setForm, problem }: any) { return <><PhaseHeading title="Is this right?" /><div className="identity-grid"><label><span>Preferred name</span><input value={form.preferredName} aria-invalid={problem?.field === "preferredName" || undefined} aria-describedby={problem?.field === "preferredName" ? "ob-error-name" : undefined} onChange={(e) => setForm({ ...form, preferredName: e.target.value })} />{problem?.field === "preferredName" && <FieldError id="ob-error-name">{problem.message}</FieldError>}</label><label><span>Work email</span><input value={form.email} readOnly aria-invalid={problem?.field === "email" || undefined} aria-describedby={problem?.field === "email" ? "ob-error-email" : undefined} />{problem?.field === "email" && <FieldError id="ob-error-email">{problem.message}</FieldError>}</label></div><p className="ob-provenance">Brought in from your workspace</p><div className="context-list"><Context label="Official role" value={data.organizationSetup.roleProfile?.name || "Pending manager setup"} /><Context label="Team" value={data.organizationSetup.teams.map((team: any) => team.name).join(", ") || "Pending manager setup"} /><Context label="Manager" value={data.organizationSetup.managers.map((manager: any) => manager.display_name).join(", ") || "Pending manager setup"} /></div><div className="provider-line"><span className={data.providerPrefill.nifty.mapped ? "ok" : ""}>Nifty {data.providerPrefill.nifty.mapped ? "connected" : "not mapped"}</span><span className={data.providerPrefill.worktivity.mapped ? "ok" : ""}>Worktivity {data.providerPrefill.worktivity.mapped ? "connected" : "not mapped"}</span></div></>; }
function Understood({ data, form, setForm, select, problem }: any) { const selected = data.catalog.archetypes.find((entry: any) => entry.id === form.archetypeId); return <><PhaseHeading title="Pick the closest fit." />{data.profile.workPreferences.inferredArchetypeId && <div className="suggestion-note"><Sparkles size={15} /> Suggested from your imported role</div>}<div className="archetype-grid">{data.catalog.archetypes.map((entry: any) => <button key={entry.id} className={form.archetypeId === entry.id ? "selected" : ""} aria-pressed={form.archetypeId === entry.id} onClick={() => select(entry.id)}><strong>{entry.name}</strong><small>{entry.description}</small>{form.archetypeId === entry.id && <Check size={16} />}</button>)}</div>{problem?.field === "archetype" && <FieldError group>{problem.message}</FieldError>}{form.archetypeId === "custom" && <label className="wide-input"><span>Your role</span><input value={form.customRoleTitle} aria-invalid={problem?.field === "customRole" || undefined} aria-describedby={problem?.field === "customRole" ? "ob-error-role" : undefined} onChange={(e) => setForm({ ...form, customRoleTitle: e.target.value })} placeholder="Describe your work" />{problem?.field === "customRole" && <FieldError id="ob-error-role">{problem.message}</FieldError>}</label>}{(selected?.specialties ?? []).length > 0 && <div className="specialties"><span>Specialties</span><div>{selected.specialties.map((specialty: any) => <button className={form.specialtyIds.includes(specialty.id) ? "selected" : ""} aria-pressed={form.specialtyIds.includes(specialty.id)} key={specialty.id} onClick={() => setForm({ ...form, specialtyIds: form.specialtyIds.includes(specialty.id) ? form.specialtyIds.filter((id: string) => id !== specialty.id) : [...form.specialtyIds, specialty.id] })}>{form.specialtyIds.includes(specialty.id) && <Check size={13} aria-hidden="true" />}{specialty.name}</button>)}</div></div>}</>; }
function ProfileBoard({ grouped, removed, newKind, newItem, setNewKind, setNewItem, setForm, setRemoved, problem }: any) { function move(id: string, delta: number) { setForm((current: any) => { const index=current.items.findIndex((item: any)=>item.id===id), target=index+delta;if(index<0||target<0||target>=current.items.length)return current;const items=[...current.items];[items[index],items[target]]=[items[target],items[index]];return {...current,items}; }); } return <><PhaseHeading title="Does this sound like your work?" /><div className="profile-board">{grouped.map((group: any) => <section key={group.kind}><header><strong>{group.kind === "responsibility" ? "Responsibilities" : group.kind === "deliverable" ? "Deliverables" : "Evidence sources"}</strong><small>{group.items.length}</small></header>{group.items.map((item: WorkProfileItem) => <div className="profile-item" key={item.id}><span>{item.label}<em>{item.source}</em></span><button aria-label={`Move ${item.label} up`} onClick={() => move(item.id,-1)}><ArrowUp size={14}/></button><button aria-label={`Move ${item.label} down`} onClick={() => move(item.id,1)}><ArrowDown size={14}/></button><button aria-label={`Remove ${item.label}`} onClick={() => {setRemoved((all: WorkProfileItem[])=>[...all,item]);setForm((current: any)=>({...current,items:current.items.filter((entry: any)=>entry.id!==item.id)}));}}><Trash2 size={14}/></button></div>)}{!group.items.length && <p className="empty-group">No items kept in this group.</p>}</section>)}</div>{problem?.field === "items" && <FieldError group>{problem.message}</FieldError>}<div className="add-profile-item"><select value={newKind} onChange={(e)=>setNewKind(e.target.value)}><option value="responsibility">Responsibility</option><option value="deliverable">Deliverable</option><option value="evidence">Evidence source</option></select><input value={newItem} onChange={(e)=>setNewItem(e.target.value)} placeholder="Add your own" /><button disabled={!newItem.trim()} onClick={()=>{const item={id:`user:${newKind}:${Date.now()}`,kind:newKind,label:newItem.trim(),source:"user"};setForm((current:any)=>({...current,items:[...current.items,item]}));setNewItem("");}}><Plus size={15}/> Add</button></div>{removed.length>0&&<button className="restore" onClick={()=>{setForm((current:any)=>({...current,items:[...current.items,...removed]}));setRemoved([]);}}>Restore {removed.length} removed suggestion{removed.length===1?"":"s"}</button>}</>; }
function Prepared({ form, setForm, schedule, authoritativeBreaks, problem }: any) { const [breakDraft,setBreakDraft]=useState(form.schedule.breaks[0] ?? { start: "", end: "" }); const patchBreak=(patch:Partial<{start:string;end:string}>)=>{const next={...breakDraft,...patch};setBreakDraft(next);schedule({breaks:next.start&&next.end?[next]:[]});}; return <><PhaseHeading title="When does work usually happen?" /><div className="day-selector">{DAYS.map((day)=><button key={day.value} className={form.schedule.daysOfWeek.includes(day.value)?"selected":""} onClick={()=>schedule({daysOfWeek:form.schedule.daysOfWeek.includes(day.value)?form.schedule.daysOfWeek.filter((value:number)=>value!==day.value):[...form.schedule.daysOfWeek,day.value]})} aria-pressed={form.schedule.daysOfWeek.includes(day.value)}>{day.label}</button>)}</div>{problem?.field === "days" && <FieldError group>{problem.message}</FieldError>}<div className="schedule-grid"><TimezoneCombobox value={form.timezone} onChange={(timezone)=>setForm({...form,timezone})} error={problem?.field === "timezone" ? problem.message : undefined}/><label><span>Shift starts</span><input type="time" value={form.schedule.shiftStart} onChange={(e)=>schedule({shiftStart:e.target.value})}/></label><label><span>Shift ends</span><input type="time" value={form.schedule.shiftEnd} onChange={(e)=>schedule({shiftEnd:e.target.value})}/></label>{!authoritativeBreaks&&<><label><span>Break starts</span><input type="time" value={breakDraft.start} onChange={(e)=>patchBreak({start:e.target.value})}/></label><label><span>Break ends</span><input type="time" value={breakDraft.end} onChange={(e)=>patchBreak({end:e.target.value})}/></label></>}</div>{authoritativeBreaks&&<p className="policy-note">Break time is derived only from explicit Worktivity OnBreak records for this organization.</p>}<div className="preference-list"><Toggle icon={Bell} title="Desktop notifications" detail="Shift prompts, check-ins, and EOD review" checked={form.desktopNotifications} onChange={(value:boolean)=>setForm({...form,desktopNotifications:value})}/><Toggle icon={Sparkles} title="Voice updates" detail="Use voice when the microphone flow is available" checked={form.voiceUpdatesEnabled} onChange={(value:boolean)=>setForm({...form,voiceUpdatesEnabled:value})}/></div></>; }
function TimezoneCombobox({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) { const [query,setQuery]=useState(value); const [open,setOpen]=useState(false); const [activeIndex,setActiveIndex]=useState(0); const listboxId=useId(); const options=useMemo(()=>supportedTimezones().filter((zone)=>zone.toLowerCase().includes(query.toLowerCase())).slice(0,50),[query]); const choose=(index:number)=>{const zone=options[index];if(!zone)return;onChange(zone);setQuery(zone);setOpen(false);}; const move=(index:number)=>setActiveIndex(Math.max(0,Math.min(options.length-1,index))); return <label className="timezone-combobox"><span>Timezone</span><input role="combobox" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={open&&options[activeIndex]?`${listboxId}-${activeIndex}`:undefined} aria-autocomplete="list" value={query} onFocus={()=>{setOpen(true);setActiveIndex(Math.max(0,options.indexOf(value)))}} onChange={(e)=>{setQuery(e.target.value);setOpen(true);setActiveIndex(0)}} onKeyDown={(e)=>{if(e.key==="Escape"){setOpen(false);return;}if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);move(open?activeIndex+1:0);return;}if(e.key==="ArrowUp"){e.preventDefault();setOpen(true);move(open?activeIndex-1:options.length-1);return;}if(e.key==="Home"){e.preventDefault();setOpen(true);move(0);return;}if(e.key==="End"){e.preventDefault();setOpen(true);move(options.length-1);return;}if(e.key==="Enter"){e.preventDefault();choose(open?activeIndex:0);}if(e.key==="Tab")setOpen(false);}} placeholder="Search city or IANA timezone" aria-invalid={error ? true : undefined} aria-describedby={error ? "ob-error-timezone" : undefined} />{error && <FieldError id="ob-error-timezone">{error}</FieldError>}{open&&<ul id={listboxId} role="listbox">{options.map((zone,index)=><li id={`${listboxId}-${index}`} role="option" aria-selected={zone===value} data-active={index===activeIndex||undefined} key={zone}><button type="button" onMouseDown={(e)=>e.preventDefault()} onMouseMove={()=>setActiveIndex(index)} onClick={()=>choose(index)}>{timezoneLabel(zone)} <small>{zone}</small></button></li>)}</ul>}</label>; }
function Safe({ data, form, setForm, problem }: any) { return <><PhaseHeading title="What you are agreeing to." /><div className="policy-summary"><strong>Work OS uses this information for:</strong><p>{data.policy.purpose}</p><ul><li>Sampled Worktivity screenshots are analysed as neutral activity context.</li><li>{data.screenshotPolicy.retention}</li><li>{data.screenshotPolicy.sensitiveCapture}</li><li>{data.screenshotPolicy.limitation}</li></ul></div><label className="wide-input"><span>Sensitive apps or domains to exclude</span><input value={form.sensitiveAppExclusions} onChange={(e)=>setForm({...form,sensitiveAppExclusions:e.target.value})} placeholder="Banking, personal email, health portals"/></label><div className="consent-box"><label><input type="checkbox" checked={form.acceptWorkOsConsent} aria-invalid={problem?.field === "consent" || undefined} aria-describedby={problem?.field === "consent" ? "ob-error-consent" : undefined} onChange={(e)=>setForm({...form,acceptWorkOsConsent:e.target.checked})}/><span>I accept Work OS tracking and the sampled screenshot-analysis policy above, including encrypted 30-day raw retention, sensitive-capture deletion, and the fact screenshots do not prove productivity or task completion.</span></label><small>{data.policy.version}</small>{problem?.field === "consent" && <FieldError id="ob-error-consent">{problem.message}</FieldError>}</div></>; }
function Connected({ attendance, entering, onEnter }: {attendance?:AttendanceProjection;entering:boolean;onEnter:()=>void}) { const state=attendance?.state??"unknown"; const title=state==="active"?"You’re online.":state==="paused"?"Connected. You’re on a break.":state==="off_shift"?"Connected — waiting for Worktivity.":"Connected — attendance unavailable."; return <div className="connected-state">
  <small>Workspace connected</small>
  <h2 className="phase-heading" tabIndex={-1}>{title}</h2>
  <p>{attendance?.message??"Work OS will keep checking Worktivity in the background without guessing your status."}</p>
  {attendance?.stale&&<div className="stale-status">Last observed status · refresh pending</div>}
  {entering
    ? <div className="entering-state" role="status"><FadeArc size={18} /><span className="entering-copy">Setting up your workspace — syncing your schedule, tasks, and provider context.</span></div>
    : <button className="primary" onClick={onEnter}>Enter My Day <ArrowRight size={16}/></button>}
</div>; }
function Context({label,value}:{label:string;value:string}) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Toggle({icon:Icon,title,detail,checked,onChange}:any) { return <label className="guided-toggle"><Icon size={17}/><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)}/></label>; }

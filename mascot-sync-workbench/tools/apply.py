# Temporary workbench helper. Not included in the product PR.
from pathlib import Path
import sys, shutil, re
root = Path(sys.argv[1]).resolve()
src = root / 'desktop/work-os-companion/src'
payload = Path(__file__).resolve().parent.parent / 'src'
for path in payload.iterdir():
    if path.is_file(): shutil.copyfile(path, src / path.name)

def replace(path, before, after, count=1):
    text = path.read_text()
    found = text.count(before)
    assert found == count, f'{path.name}: expected {count} anchors, got {found}: {before[:100]}'
    path.write_text(text.replace(before, after))

def append(path, text): path.write_text(path.read_text() + '\n' + text + '\n')

replace(src/'types.ts', 'export interface DebugScenario {', 'export interface DebugScenario extends MascotDebugOverrides {')
src_types = src/'types.ts'
src_types.write_text('import type { MascotDebugOverrides } from "./mascotRuntimeModel";\n'+src_types.read_text())
replace(src/'scenarios.ts', '  companionForce: null,', '  companionForce: null,\n  mascotActivity: null,\n  mascotWorkday: null,\n  mascotMotion: "system",\n  mascotReplay: 0,')
anchor = 'export const DEBUG_PRESETS: Array<{ id: string; label: string; description: string; scenario: Partial<DebugScenario> }> = ['
presets = '\n'.join(f'  {{ id: "mascot_{activity}", label: "Mascot: {label}", description: "Visual fixture; no backend writes.", scenario: {{ enabled: true, syncBypass: true, authState: "real", onboardingState: "complete", dayState: "clocked_in", mascotActivity: "{activity}" }} }},' for activity,label in [('idle','Idle'),('working','Working'),('needs-input','Needs input'),('ready','Completed'),('blocked','Failed')])
replace(src/'scenarios.ts', anchor, anchor+'\n'+presets)

# Fix the dashboard bypass and keep a compact mascot visible while on shift.
replace(src/'DashboardSurface.tsx', 'import { Otto } from "./Otto";', 'import { MascotPet, MascotStatus } from "./MascotPet";')
replace(src/'DashboardSurface.tsx', '<Otto pose="sleep" className="dashboard-otto" />', '<MascotPet workday="off-shift" className="dashboard-otto" />')
replace(src/'DashboardSurface.tsx', '<span>{model.schedule.phase === "upcoming" ? "Ready when you are" : "No active workday"}</span>', '<MascotStatus fallback={model.schedule.phase === "upcoming" ? "Ready when you are" : "No active workday"} />')
replace(src/'DashboardSurface.tsx', '<div className="active-status-heading">', '<div className="active-status-heading"><MascotPet className="dashboard-otto-active" workday={model.state === "paused" ? "paused" : observedOnly ? "off-shift" : "active"} />')

replace(src/'OttoPreview.tsx', '<MascotPet ', '<MascotPet isolated ', src.joinpath('OttoPreview.tsx').read_text().count('<MascotPet '))

# Historical speech marks remain unchanged; current launchers opt in.
replace(src/'chat/MascotMark.tsx', 'import { cx } from "./cx";', 'import { cx } from "./cx";\nimport { useMascotRuntimeSnapshot } from "../mascotRuntimeStore";')
replace(src/'chat/MascotMark.tsx', 'crop = MASCOT.chatCrop, className }', 'crop = MASCOT.chatCrop, className, live = false }')
replace(src/'chat/MascotMark.tsx', 'className?: string })', 'className?: string; live?: boolean })')
replace(src/'chat/MascotMark.tsx', '  const Mark = MASCOT.Mark;', '  const runtime = useMascotRuntimeSnapshot();\n  const Mark = MASCOT.Mark;')
replace(src/'chat/MascotMark.tsx', 'pose={pose} tone={tone}', 'pose={live && runtime ? runtime.pose : pose} tone={live && runtime ? runtime.tone : tone}')

app=src/'App.tsx'
replace(app, 'import { MascotPet } from "./MascotPet";', 'import { MascotPet } from "./MascotPet";\nimport { mascotFactsFromDay, useMascotRuntime } from "./useMascotRuntime";')
replace(app, '  const [progressReceipt, setProgressReceipt] = useState<ProgressReceipt | null>(null);', '  const [progressReceipt, setProgressReceipt] = useState<ProgressReceipt | null>(null);\n  const [mascotReceipt, setMascotReceipt] = useState<object | null>(null);\n  useEffect(() => { if (progressReceipt && !progressReceipt.queued) setMascotReceipt(progressReceipt); }, [progressReceipt]);')
replace(app, '  const gate = sessionGate(visibleDay);', '''  const gate = sessionGate(visibleDay);
  useMascotRuntime({
    window: "main",
    scope: debugScenario.enabled ? "debug:scenario" : visibleSession && visibleDay?.access?.personId
      ? `${visibleSession.organizationId}/${visibleDay.access.personId}/${visibleDay.shiftDate}` : "",
    facts: mascotFactsFromDay(visibleDay, !!visibleSession), scenario: debugScenario,
    working: !!composerThinking || interpretation?.status === "loading" || busy || eodRedrafting || !!eodPreparing
      || completingTaskIds.size > 0 || pendingTasks.some((task) => task.status === "syncing"),
    failed: !!error || (!!aiUnavailable && !syncBypass) || pendingTasks.some((task) => task.status === "failed")
      || !!interpretation?.results?.some((result) => result.status === "failed"),
    needsInput: interpretation?.status === "ready" && interpretation.operations.some((op) => op.enabled && isMutatingToolOp(op)),
    receipt: mascotReceipt,
  });''')
replace(app, '      setLeavingTaskIds((current) => new Set([...current, taskId]));', '      setLeavingTaskIds((current) => new Set([...current, taskId]));\n      setMascotReceipt({});')
text=app.read_text()
text,n=re.subn(r'(\bconst \[outcome, (?:deniedResults|denialResults)\] = await Promise\.all\([\s\S]*?\n      \]\);)', r'\1\n      if (outcome.recorded > 0 && !outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});', text)
assert n==2, f'Expected two main filing boundaries, got {n}'
text=text.replace('if (outcome.recorded > 0) {', 'if (outcome.recorded > 0) {\n        if (!outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});')
app.write_text(text)
replace(app, '      debugRef.current = event.payload;\n      setDebugScenario(event.payload);', '''      if (!event.payload || typeof event.payload.enabled !== "boolean") return;
      const next = { ...DEFAULT_DEBUG_SCENARIO, ...event.payload };
      debugRef.current = next;
      setDebugScenario(next);
      void emit("work-os://debug-current", next);''')
text=app.read_text(); text=text.replace('<MascotMark ', '<MascotMark live '); app.write_text(text)

avatar=src/'AvatarApp.tsx'
replace(avatar, 'import { deriveMascotVisualState, type MascotAgentActivity, type MascotWorkdayState } from "./mascotState";', 'import { type MascotAgentActivity, type MascotWorkdayState } from "./mascotState";\nimport { useMascotRuntime, useMascotScenarioMirror } from "./useMascotRuntime";')
replace(avatar, '  const [filing, setFiling] = useState(false);', '  const [filing, setFiling] = useState(false);\n  const debugScenario = useMascotScenarioMirror();\n  const [mascotReceipt, setMascotReceipt] = useState<object | null>(null);')
text=avatar.read_text()
start=text.index('  const agentActivity: MascotAgentActivity =')
end=text.index('  const statusText =',start)
text=text[:start]+'''  const mascotVisual = useMascotRuntime({
    window: "avatar",
    scope: debugScenario.enabled ? "debug:scenario" : desktopSession && facts.personId && facts.shiftDate
      ? `${desktopSession.organizationId}/${facts.personId}/${facts.shiftDate}` : "",
    scenario: debugScenario,
    facts: { ...facts, connected: connected === true && facts.loaded,
      promptKind: contextualPrompt.kind, promptRequired: attentionDue },
    working: thinking || filing,
    failed: daySyncState === "error" || !!lastEntry?.toolResults?.some((result) => result.status === "failed")
      || (lastEntry?.role === "system" && /^(e-|agenda-error-)/.test(lastEntry.id)),
    needsInput: attentionDue || !!agendaReview || !!lastEntry?.operations?.some((op) => op.enabled && isMutatingToolOp(op)),
    completed: readyPulse,
    receipt: mascotReceipt,
  });
  const agentActivity: MascotAgentActivity = mascotVisual.activity;
  const workdayState: MascotWorkdayState = mascotVisual.workday;
''' + text[end:]
text=text.replace('      const results = [...outcome.results, ...rejectionResults];', '      const results = [...outcome.results, ...rejectionResults];\n      if (outcome.recorded > 0 && !results.some((result) => result.status !== "recorded" && result.status !== "denied")) setMascotReceipt({});')
assert 'setMascotReceipt({})' in text
text=text.replace('<MascotMark ', '<MascotMark live ')
avatar.write_text(text)

debug=src/'DebugWindow.tsx'
replace(debug, 'import { emit, listen } from "@tauri-apps/api/event";', 'import { emit, listen } from "./tauriEvents";\nimport { MascotDebugControls } from "./MascotDebugControls";')
replace(debug, '  const [scenario, setScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);', '  const [scenario, setScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);\n  const scenarioRef = useRef(scenario);\n  scenarioRef.current = scenario;')
text=debug.read_text(); start=text.index('  useEffect(() => {\n    if (!isTauri()) return;'); end=text.index('\n  const visible =',start)
text=text[:start]+'''  useEffect(() => {
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const register = (off: () => void) => { if (disposed) off(); else cleaners.push(off); };
    void listen<DebugScenario>("work-os://debug-current", (event) => {
      if (disposed || !event.payload || typeof event.payload.enabled !== "boolean") return;
      const next = { ...DEFAULT_DEBUG_SCENARIO, ...event.payload };
      scenarioRef.current = next;
      setScenario(next);
    }).then((off) => {
      register(off);
      if (!disposed) void emit("work-os://debug-request");
    }).catch(() => undefined);
    void listen<DiagnosticEvent>("work-os://diagnostics", (event) => {
      if (disposed || pausedRef.current) return;
      setEvents((current) => [...current.slice(-1999), event.payload]);
    }).then(register).catch(() => undefined);
    if (isTauri()) void diagnosticsSnapshot().then((value) => { if (!disposed) setEvents(value); }).catch(() => undefined);
    return () => { disposed = true; cleaners.forEach((off) => off()); };
  }, []);
''' +text[end:]
text=text.replace('const next = { ...scenario, ...patch };', 'const next = { ...scenarioRef.current, ...patch };\n    scenarioRef.current = next;')
text=text.replace('      <div className="debug-footer-actions">', '      <MascotDebugControls scenario={scenario} onChange={update} />\n      <div className="debug-footer-actions">')
assert '<MascotDebugControls scenario=' in text
debug.write_text(text)

guard=root/'test/work-os-companion-mascot.test.mts'
replace(guard, 'assert.match(avatar, /deriveMascotVisualState/);', 'assert.match(avatar, /useMascotRuntime/);')
append(guard, '''const dashboard = read("DashboardSurface.tsx");
assert.doesNotMatch(dashboard, /from "\\.\\/Otto"/);
assert.doesNotMatch(dashboard, /<Otto\\b/);
assert.match(dashboard, /<MascotPet/);
assert.match(app, /useMascotRuntime/);
assert.match(read("DebugWindow.tsx"), /<MascotDebugControls/);
assert.match(read("MascotPet.tsx"), /useMascotRuntimeSnapshot/);''')
static=root/'test/work-os-desktop-static.test.mts'
text=static.read_text().replace('assert.match(avatar, /deriveMascotVisualState/);', 'assert.match(avatar, /useMascotRuntime/);')
static.write_text(text)

changelog=root/'desktop/work-os-companion/CHANGELOG.md'
text=changelog.read_text(); at=text.index('\n')
changelog.write_text(text[:at+1]+'''\n## Unreleased - mascot synchronization

- Studio Otto now appears in the My Day readiness hero and active workday header.
- The dashboard, current chat launcher and floating companion share scenario-aware mascot activity, failure, completion and workday presentation.
- The scenario debugger includes mascot activity/context overrides, reduced motion, replay, interrupt and failure/recovery sequences, a 35-state matrix and per-window readouts.
- Mascot previews are visual-only and reset with scenario mode; they do not complete tasks or create receipts.
''' + text[at+1:])
print('Applied mascot synchronization patch to isolated worktree:',root)

from pathlib import Path
import re, sys
root=Path(sys.argv[1]); src=root/'desktop/work-os-companion/src'
# Keep release bullets as short user-facing changes.
p=root/'desktop/work-os-companion/CHANGELOG.md'; text=p.read_text()
text=text.replace('- The dashboard, current chat launcher and floating companion share scenario-aware mascot activity, failure, completion and workday presentation.', '- Dashboard and floating Otto now follow the same activity and workday states.')
text=text.replace('- The scenario debugger includes mascot activity/context overrides, reduced motion, replay, interrupt and failure/recovery sequences, a 35-state matrix and per-window readouts.', '- Test all mascot states, reduced motion and recovery sequences in the scenario debugger.')
text=text.replace('- Mascot previews are visual-only and reset with scenario mode; they do not complete tasks or create receipts.', '- Mascot previews reset with scenario mode and never write real receipts.')
p.write_text(text)
# A wrapped select's option text must not become part of its control name.
p=src/'MascotDebugControls.tsx'; text=p.read_text()
for field,name in [('mascotActivity','Mascot activity'),('mascotWorkday','Mascot workday'),('mascotMotion','Mascot motion')]:
 old=f'<select value={{scenario.{field}'
 assert old in text
 text=text.replace(old, f'<select aria-label="{name}" value={{scenario.{field}')
text=text.replace('void emit("work-os://mascot-request", { window: "debug" });', 'void emit("work-os://mascot-request", { window: "debug" }).catch(() => undefined);')
p.write_text(text)
p=src/'DebugWindow.tsx'; text=p.read_text()
text=text.replace('<select value={scenario.dayState}', '<select aria-label="Shift state" value={scenario.dayState}')
p.write_text(text)
# The event shim already has a DEV-only allowlist. Register the application's
# scenario listeners in browser fixtures as well as the native WebView.
p=src/'App.tsx'; text=p.read_text(); at=text.index('"work-os://debug-request"')
start=text.rfind('  useEffect(() => {',0,at); end=text.index('  }, []);',at)+len('  }, []);')
block=text[start:end]
assert 'work-os://debug-scenario' in block
print('Original scenario bridge:\n'+block)
replacement='''  useEffect(() => {
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const register = (off: () => void) => { if (disposed) off(); else cleaners.push(off); };
    void listen<DebugScenario>("work-os://debug-scenario", (event) => {
      if (disposed || !event.payload || typeof event.payload.enabled !== "boolean") return;
      const next = { ...DEFAULT_DEBUG_SCENARIO, ...event.payload };
      debugRef.current = next;
      setDebugScenario(next);
      void emit("work-os://debug-current", next).catch(() => undefined);
    }).then(register).catch(() => undefined);
    void listen("work-os://debug-request", () => {
      if (!disposed) void emit("work-os://debug-current", debugRef.current).catch(() => undefined);
    }).then(register).catch(() => undefined);
    return () => { disposed = true; cleaners.forEach((off) => off()); };
  }, []);'''
text=text[:start]+replacement+text[end:];p.write_text(text)
# Telemetry is best-effort during native window teardown.
p=src/'useMascotRuntime.ts'; text=p.read_text()
text=text.replace('import { emit, listen } from "./tauriEvents";', 'import { emit as emitEvent, listen } from "./tauriEvents";')
text=text.replace('const LEASE_MS = 20_000;', 'const emit = (event: string, payload?: unknown) => emitEvent(event, payload).catch(() => undefined);\nconst LEASE_MS = 20_000;')
p.write_text(text)
print('Finalized debugger names, lifecycle-safe handshake and release copy.')

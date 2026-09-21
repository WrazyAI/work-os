from pathlib import Path
import sys
root=Path(sys.argv[1]); src=root/'desktop/work-os-companion/src'
def change(path, old, new):
 text=path.read_text(); assert text.count(old)==1, f'{path.name}: missing exact anchor {old[:80]}'
 path.write_text(text.replace(old,new))
p=src/'MascotDebugControls.tsx'
change(p, '  const generation = useRef(0);', '''  const generation = useRef(0);
  const expectedOverride = useRef("");
  const overrideKey = JSON.stringify([scenario.mascotActivity ?? null, scenario.mascotWorkday ?? null, scenario.mascotMotion ?? "system", scenario.mascotReplay ?? 0]);''')
change(p, '  useEffect(() => () => clearTimers(), []);', '''  useEffect(() => {
    // Presets/reset can replace an override without changing the workday.
    // Own scheduled steps update expectedOverride before emitting their patch.
    if (running && overrideKey !== expectedOverride.current) { clearTimers(); setRunning(null); }
  }, [overrideKey, running]);
  useEffect(() => () => clearTimers(), []);''')
change(p, '        latest.current.onChange({ mascotActivity: step.activity, mascotReplay: (latest.current.scenario.mascotReplay ?? 0) + 1 });', '''        const next = { ...latest.current.scenario, mascotActivity: step.activity, mascotReplay: (latest.current.scenario.mascotReplay ?? 0) + 1 };
        expectedOverride.current = JSON.stringify([next.mascotActivity ?? null, next.mascotWorkday ?? null, next.mascotMotion ?? "system", next.mascotReplay ?? 0]);
        latest.current.onChange({ mascotActivity: next.mascotActivity, mascotReplay: next.mascotReplay });''')
change(p, '  const preview = resolveMascotRuntime({ connected: true, sessionState: "active" }, {}, scenario);', '''  const resolved = reported.main ?? reported.avatar;
  // The live window is authoritative in Auto. Before the handshake, explicitly
  // label this isolated sample instead of suggesting it reflects platform truth.
  const preview = resolved ?? resolveMascotRuntime({ connected: false }, {}, scenario);''')
change(p, '<strong>{scenario.enabled ? "Visual simulation" : "Preview inactive"}</strong>', '<strong>{resolved ? scenario.enabled ? "Window-reported simulation" : "Window-reported live state" : "Sample - waiting for window"}</strong>')
change(p, '<strong>Reported by running windows</strong>', '<strong>Last reported by each window</strong>')
# Copy the browser regression harness into the product PR, without test-only
# dependencies in the desktop app. Resolve Playwright externally via NODE_PATH.
source=Path(__file__).parent/'browser.cjs'
if source.exists():
 target=root/'scripts/verify-mascot-sync.cjs'
 text=source.read_text().replace("require('/tmp/otto-browser/node_modules/playwright')", "require('playwright')")
 text='// Start the companion Vite dev server on 127.0.0.1:5173.\n// Run with Playwright available on NODE_PATH; no live credentials required.\n'+text
 target.write_text(text)
print('Applied sequence cancellation, live preview and reproducible browser checks.')

/** One switch control for on/off preferences: the track carries the state, the
 * label states it in words, and the whole control is a single focusable switch.
 * Shared by Settings and the scenario debugger so both speak one vocabulary. */
export function SettingsSwitch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`settings-switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="settings-switch-track" aria-hidden="true"><span className="settings-switch-knob" /></span>
      <span className="settings-switch-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
    </button>
  );
}

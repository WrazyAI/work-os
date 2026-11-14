import { Setting } from "./Setting";
import { SettingsChoice } from "./SettingsChoice";
import type { MascotSize, TextSize, ThemePreference } from "./appearance";

/** The Appearance settings groups: theme, text size, and mascot size. Fully
 * controlled — the owner persists, applies, and restores on failure — so the
 * same component renders in Settings and the dev preview. */
export function AppearanceSettings({ theme, textSize, mascotSize, onTheme, onTextSize, onMascotSize }: {
  theme: ThemePreference;
  textSize: TextSize;
  mascotSize: MascotSize;
  onTheme: (value: ThemePreference) => void;
  onTextSize: (value: TextSize) => void;
  onMascotSize: (value: MascotSize) => void;
}) {
  return <>
    <section className="settings-group" aria-labelledby="settings-appearance-title">
      <header className="settings-group-head"><h3 id="settings-appearance-title">Appearance</h3></header>
      <section className="settings-panel">
        <Setting title="Theme" detail="Choose how Work OS looks on this device.">
          <SettingsChoice<ThemePreference>
            label="Theme"
            value={theme}
            onChange={onTheme}
            options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]}
          />
        </Setting>
      </section>
    </section>
    <section className="settings-group" aria-labelledby="settings-display-title">
      <header className="settings-group-head"><h3 id="settings-display-title">Reading &amp; display</h3></header>
      <section className="settings-panel">
        <Setting title="Text size" detail="Medium makes companion text 15% larger.">
          <SettingsChoice<TextSize>
            label="Text size"
            value={textSize}
            onChange={onTextSize}
            options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }]}
          />
        </Setting>
        <Setting title="Mascot size" detail="Choose how much space Otto takes up across Work OS.">
          <SettingsChoice<MascotSize>
            label="Mascot size"
            value={mascotSize}
            onChange={onMascotSize}
            options={[{ value: "small", label: "Small" }, { value: "large", label: "Large" }]}
          />
        </Setting>
      </section>
    </section>
  </>;
}

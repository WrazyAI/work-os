import { useEffect, useState } from "react";
import { AppearanceSettings } from "./AppearanceSettings";
import { MascotPet } from "./MascotPet";
import { applyAppearance, type MascotSize, type TextSize } from "./appearance";

/** Dev-only fixture for the appearance settings: the real Reading & display
 * group wired to a live document, plus sample text and Otto so the rendered
 * result of each choice is visible without a signed-in workspace. */
export default function SettingsPreview() {
  const [textSize, setTextSize] = useState<TextSize>("small");
  const [mascotSize, setMascotSize] = useState<MascotSize>("large");

  useEffect(() => { applyAppearance({ textSize, mascotSize }); }, [textSize, mascotSize]);

  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 29</p><h1>Settings</h1></div></header>
    <main className="page">
      <AppearanceSettings
        textSize={textSize}
        mascotSize={mascotSize}
        onTextSize={setTextSize}
        onMascotSize={setMascotSize}
      />
      <section className="settings-preview-grid">
        <article className="settings-preview-card">
          <h4>Sample text</h4>
          <p className="settings-preview-sample">Finished the migration, reviewed three task updates, and left a note for tomorrow's handoff.</p>
        </article>
        <article className="settings-preview-card">
          <h4>Otto</h4>
          <MascotPet isolated workday="active" className="settings-preview-pet" />
        </article>
      </section>
    </main>
  </section></div>;
}

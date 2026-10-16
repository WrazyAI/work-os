import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoicePicker } from "./VoicePicker";
import { RECAP_VOICE_OPTIONS } from "./recapSpeech";

const render = (value: string) => renderToStaticMarkup(createElement(VoicePicker, { value, onChange: () => undefined }));

describe("choosing how Otto reads to you", () => {
  it("offers every shipped voice by our own name, never the provider's", () => {
    const markup = render(RECAP_VOICE_OPTIONS[0].id);
    for (const option of RECAP_VOICE_OPTIONS) {
      expect(markup).toContain(`data-voice="${option.id}"`);
      expect(markup).toContain(`>${option.label}<`);
      // The sample itself never appears as text; it is played from the shipped
      // file (recapSpeech.test.ts proves every file exists).
      expect(markup).toContain(`aria-label="Play the ${option.label} sample"`);
    }
    for (const vendor of ["Kore", "Charon", "Leda", "Iapetus", "Gemini", "Google"]) {
      expect(markup).not.toContain(`>${vendor}<`);
    }
  });

  it("marks the chosen voice, and only it, as pressed", () => {
    const chosen = RECAP_VOICE_OPTIONS[2];
    const markup = render(chosen.id);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toContain('class="voice-picker-row is-selected"');
    expect(markup).toContain("Otto reads to you like this");
    expect(markup.match(/Hear it, then choose it/g)).toHaveLength(RECAP_VOICE_OPTIONS.length - 1);
  });

  it("gives every row its own sample, playable without a network round trip", () => {
    const markup = render(RECAP_VOICE_OPTIONS[0].id);
    for (const option of RECAP_VOICE_OPTIONS) {
      expect(markup).toContain(`aria-label="Play the ${option.label} sample"`);
    }
    // The samples are shipped files, not provider URLs.
    expect(markup).not.toMatch(/https?:\/\/(fal|storage|v3b)/);
  });

  it("is reachable from the voice setting, saved and announced to the companion", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(app).toContain("<VoicePicker value={recapVoice}");
    expect(app).toContain("await secureState.saveSettings({ recapVoice: next });");
    expect(app).toContain("void emit(RECAP_VOICE_EVENT, { recapVoice: next });");
    const avatar = readFileSync(new URL("./AvatarApp.tsx", import.meta.url), "utf8");
    expect(avatar).toContain("listen<{ recapVoice?: unknown }>(RECAP_VOICE_EVENT");
    expect(avatar).toContain("setRecapVoice(normalizeRecapVoice(event.payload?.recapVoice))");
    // The vault keeps the field, or a choice would silently vanish.
    const vault = readFileSync(new URL("./vault.ts", import.meta.url), "utf8");
    expect(vault).toContain("recapVoice: settings.recapVoice ?? (typeof current?.recapVoice === \"string\" ? current.recapVoice : undefined)");
  });
});

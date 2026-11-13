import { describe, expect, it } from "vitest";
import { mergeWorkOsSettings } from "./vault";

const base = {
  apiBase: "https://work-os.example", autoCheckUpdates: true, voiceHotkey: true,
  textSize: "small" as const, mascotSize: "large" as const,
  theme: "system" as const, themePromptSeen: false,
};

describe("vault settings", () => {
  it("keeps the theme and prompt history when only text size changes", () => {
    expect(mergeWorkOsSettings({ ...base, theme: "dark", themePromptSeen: true }, { textSize: "medium" }))
      .toMatchObject({ textSize: "medium", theme: "dark", themePromptSeen: true });
  });

  it("writes theme and seen together", () => {
    expect(mergeWorkOsSettings(base, { theme: "light", themePromptSeen: true }))
      .toMatchObject({ theme: "light", themePromptSeen: true });
  });

  it("normalizes a corrupt stored theme to System and seen to false", () => {
    expect(mergeWorkOsSettings({ ...base, theme: "sepia" as never, themePromptSeen: "yes" as never }, {}))
      .toMatchObject({ theme: "system", themePromptSeen: false });
  });

  it("does not mark the prompt seen from an unrelated save", () => {
    expect(mergeWorkOsSettings(base, { mascotSize: "small" }).themePromptSeen).toBe(false);
  });

  it("keeps the saved recap voice through unrelated saves and writes a new one", () => {
    expect(mergeWorkOsSettings({ ...base, recapVoice: "warm" }, { theme: "dark" }).recapVoice).toBe("warm");
    expect(mergeWorkOsSettings(base, { recapVoice: "calm" }).recapVoice).toBe("calm");
  });
});

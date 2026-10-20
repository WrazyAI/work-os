import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the recap read is offered wherever a recap is", () => {
  it("reads in the main window with the same machine as the floating companion", () => {
    const app = read("./App.tsx");
    // One player, built from the shared factory, with the browser adapter that
    // keeps the element alive across the press-to-clip gap.
    expect(app).toContain("createRecapSpeechPlayer({");
    expect(app).toContain("createAudio: browserRecapAudio,");
    expect(app).toContain('fetchClip: (input) => apiRequestAudio("/api/work-os/voice/recap", input),');
    // The Tasks tab offers the control, and stops a read when recording starts.
    expect(app).toContain("onListen={voice ? toggleRecapRead : undefined}");
    expect(app).toContain('listeningId={recapSpeech.status !== "idle" ? recapSpeech.intervalId : null}');
    expect(app).toContain('if (voice && voice.state !== "idle") recapPlayer.stop();');
    // A read that cannot start says why; it is never a silent press.
    expect(app).toContain('{recapSpeechError ? <p className="chat-activity-error" role="alert">{recapSpeechError}</p> : null}');
  });

  it("carries the control through the activity stream the Tasks tab renders", () => {
    const list = read("./ActivityIntervalList.tsx");
    expect(list).toContain("onListen?: (id: string, revision: number | null) => void;");
    expect(list).toContain("listeningId?: string | null;");
    expect(list).toContain("onListen={onListen} listeningId={listeningId}");
  });

  it("uses one player in the floating companion, so two reads can never overlap", () => {
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain("createAudio: browserRecapAudio,");
    expect(avatar).toContain("const [recapPlayer] = useState<RecapSpeechPlayer>");
  });

  it("primes the element inside the press, before the clip is awaited", () => {
    const player = read("./recapSpeechPlayer.ts");
    const start = player.indexOf("const start = async");
    const prime = player.indexOf("prime();", start);
    const fetch = player.indexOf("await deps.fetchClip(input);", start);
    expect(prime).toBeGreaterThan(start);
    expect(prime).toBeLessThan(fetch);
    // The element is reused for the clip rather than recreated after the await.
    expect(player).toContain("element.setSource(objectUrl);");
  });
});

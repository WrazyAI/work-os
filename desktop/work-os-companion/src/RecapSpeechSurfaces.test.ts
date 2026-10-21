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

  it("opens the player inside the press, before the clip is awaited", () => {
    const player = read("./recapSpeechPlayer.ts");
    const start = player.indexOf("const start = async");
    const open = player.indexOf("audio = deps.createAudio();", start);
    const fetch = player.indexOf("await deps.fetchClip(input);", start);
    expect(open).toBeGreaterThan(start);
    expect(open).toBeLessThan(fetch);
    // The clip is decoded into that same player after the await.
    expect(player).toContain("await element.load(clip.bytes, clip.mimeType);");
    // Web Audio, not a media element whose gesture would expire.
    expect(player).toContain("new Constructor();");
  });
});

describe("a read that takes too long", () => {
  it("says so past the usual window, offers Cancel, and never suppresses the request", () => {
    const player = read("./recapSpeechPlayer.ts");
    expect(player).toContain("RECAP_SLOW_AFTER_MS = 20_000");
    expect(player).toContain("if (mine === token && snapshot.status === \"loading\") publish({ slow: true });");
    // Cancelling a wait is not an abort: the clip is still wanted for Try again.
    expect(player).toContain("const cancelledWait = snapshot.status === \"loading\" ? snapshot.intervalId : null;");
    expect(player).not.toContain("AbortController");
  });

  it("shows the quiet line and an underlined way out, then Try again with a refresh icon", () => {
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain("Taking longer than usual");
    expect(avatar).toContain('className="avatar-bubble-cancel"');
    expect(avatar).toContain("Try again");
    expect(avatar).toContain("RotateCcw");
    expect(avatar).toContain("const recapRetry = pendingRecap !== null && recapSpeech.retryIntervalId === pendingRecap.id;");
    const css = read("./avatar.css");
    expect(css).toContain(".avatar-bubble-cancel");
    expect(css).toContain("text-decoration: underline");
  });

  it("flashes the mascot's own warning state for half a second on failure or cancel", () => {
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain("const flashRecapFailure = useCallback(() => {");
    expect(avatar).toContain("setTimeout(() => setRecapFlash(false), 500)");
    expect(avatar).toContain("failed: recapFlash || daySyncState");
    // Only leaving a wait flashes; stopping a read that already plays does not.
    expect(avatar).toContain('if (recapPlayer.snapshot().status === "loading") flashRecapFailure();');
  });
});

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
    expect(app).toContain('if (voice && voice.state !== "idle")');
    expect(app).toContain("employeeAudioLease.current?.release();");
    expect(app).toContain("requestOttoAudio(requested.scope, requested.epoch");
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
    // Every identified actor (employee or administrator) takes the speech lease
    // before a read; direct playback remains only for the pre-session window.
    expect(avatar.match(/const requestedContext = currentAvatarAudioContext\(\);/g) ?? []).toHaveLength(2);
    expect(avatar).not.toContain("if (!adminOttoContextRef.current) {");
    expect(avatar).toContain("avatarPlaybackAllowed(recapLease.current, currentAvatarAudioContext())");
    expect(avatar).toContain("avatarPlaybackAllowed(nextStepsLease.current, currentAvatarAudioContext())");
  });

  it("opens the player inside the press, before the clip is awaited", () => {
    const player = read("./recapSpeechPlayer.ts");
    const start = player.indexOf("const start = async");
    const open = player.indexOf("element = deps.createAudio();", start);
    const fetch = player.indexOf("await deps.fetchClip(", start);
    expect(open).toBeGreaterThan(start);
    expect(open).toBeLessThan(fetch);
    expect(player).toContain("reviewKey");
    expect(player).toContain("onReviewChanged");
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

describe("the grown bubble stays inside its window", () => {
  it("grows for the retry view too, so its two actions are never clamped", () => {
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain("recapSpeech.status !== \"idle\" || recapSpeech.retryIntervalId !== null");
    expect(avatar).toContain("data-recap-reading={recapSpeech.status !== \"idle\" || recapSpeech.retryIntervalId !== null");
  });

  it("fills the window, reserves the pill strip, and lets the bubble take the slack", () => {
    const css = read("./avatar.css");
    expect(css).toContain("height: 100%;");
    expect(css).toContain("padding-bottom: 26px;");
    expect(css).toContain("flex: 1 1 auto;");
    expect(css).toContain("flex-wrap: wrap;");
  });

  it("keeps one marker, for attention only — no shift-progress wedge", () => {
    const css = read("./avatar.css");
    expect(css).not.toContain("avatar-badge-progress");
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain('{showBadge && <span className="avatar-badge" aria-hidden="true" />}');
  });
});

describe("the next-steps card is never cut off", () => {
  it("gives the card height back through its list instead of overflowing the window", () => {
    const css = read("./avatar.css");
    // The card is the grown surface itself; without min-height:0 the
    // bottom-anchored column pushed its header above the top of the screen.
    expect(css).toMatch(/\[data-next-steps\]\) \.avatar-compact \.avatar-next-steps \{[\s\S]{0,220}?min-height: 0;/);
    expect(css).toMatch(/\.avatar-compact \.avatar-next-steps-list \{[\s\S]{0,120}?flex: 1 1 auto;/);
  });

  it("keeps one resting anchor across every resize and the close", () => {
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain("const grownAnchorRef = useRef<{ x: number; y: number } | null>(null);");
    expect(avatar).toContain("const resting = stored ?? { x: logical.x, y: logical.y };");
    expect(avatar).toContain("nextStepsWindow(moment, bounds, resting, measuredNextStepsHeight)");
    // A second growth must not treat the already-moved top as the anchor.
    expect(avatar).not.toContain("nextStepsWindow(moment, bounds, { x: logical.x, y: logical.y }");
    expect(avatar).toContain("if (!grown && stored) grownAnchorRef.current = null;");
  });

  it("grows the window for the card's measured height, not the row estimate", () => {
    const bubble = read("./NextStepsBubble.tsx");
    expect(bubble).toContain("onHeightChange?: (height: number) => void;");
    // Chrome plus the list's natural rows: a squeezed list must not measure
    // itself as short and shrink the window straight back.
    expect(bubble).toContain("node.offsetHeight - list.offsetHeight");
    expect(bubble).toContain("Math.min(rows, cap)");
    const avatar = read("./AvatarApp.tsx");
    expect(avatar).toContain("const measuredNextStepsHeight = nextStepsCardSize");
    expect(avatar).toContain("nextStepsWindow(moment, bounds, resting, measuredNextStepsHeight)");
    expect(avatar).toContain("onHeightChange={receiveNextStepsHeight}");
  });

  it("lets the card own the pose while a queued prompt waits behind it", () => {
    const avatar = read("./AvatarApp.tsx");
    // The prompt is behind the card, so it must not make the orb alert for an
    // ask that is not on screen; it takes the pose back when the card closes.
    expect(avatar).toContain("const nextStepsOpen = nextStepsMoment !== null;");
    expect(avatar).toContain("const promptLeads = attentionDue && !nextStepsOpen;");
    expect(avatar).toContain("promptRequired: promptLeads, eodOutstanding: eodDue");
    expect(avatar).toContain("avatarAttentionFixture || promptLeads");
  });

  it("ends a moment with nothing actionable in the success beat", () => {
    const avatar = read("./AvatarApp.tsx");
    const empty = avatar.indexOf('if (nextStepsMoment.status === "empty")');
    const close = avatar.indexOf("setNextStepsCelebration(true);", empty);
    expect(empty).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(empty);
    // The beat leads over a queued ask; the ask keeps its own surface and
    // returns as soon as the 2.9s celebration is over.
    expect(avatar).toContain("needsInput: !nextStepsCelebration && (");
  });
});

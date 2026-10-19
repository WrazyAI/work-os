import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  baseAudioMime,
  normalizeLanguage,
  readVoiceUpload,
  supportedAudioMime,
  TRANSCRIBE_MAX_BYTES,
  transcribeAudio,
  TRANSCRIBE_MIME_TYPES,
  voiceInputConfigured,
} from "../src/lib/aiTranscribe";
import {
  formatRecordingClock,
  levelFromWaveform,
  pickRecorderMime,
  recorderFileExtension,
  VOICE_FAILURE_COPY,
  VOICE_HOTKEY_LABEL,
  VOICE_MAX_RECORDING_MS,
  VOICE_MIN_RECORDING_MS,
} from "../src/modules/work-os/useVoiceInput";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/* ── Transcription client ────────────────────────────────────────────────── */

test("voice input is configured only when the FAL key is present", () => {
  const previous = process.env.FAL_API_KEY;
  delete process.env.FAL_API_KEY;
  assert.equal(voiceInputConfigured(), false);
  process.env.FAL_API_KEY = "  ";
  assert.equal(voiceInputConfigured(), false);
  process.env.FAL_API_KEY = "key-id:key-secret";
  assert.equal(voiceInputConfigured(), true);
  if (previous === undefined) delete process.env.FAL_API_KEY;
  else process.env.FAL_API_KEY = previous;
});

test("audio container guards accept every recorder output the provider supports", () => {
  assert.equal(baseAudioMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(baseAudioMime("AUDIO/MP4"), "audio/mp4");
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/mpeg", "audio/wav", "audio/flac"]) {
    assert.equal(supportedAudioMime(mime), true, `${mime} should be accepted`);
  }
  assert.equal(supportedAudioMime("video/webm"), false);
  assert.equal(supportedAudioMime("application/octet-stream"), false);
  assert.equal(supportedAudioMime(""), false);
  assert.ok(TRANSCRIBE_MIME_TYPES.length >= 8);
});

test("the requested language falls back to English instead of sending junk", () => {
  assert.equal(normalizeLanguage("fr"), "fr");
  assert.equal(normalizeLanguage("EN"), "en");
  assert.equal(normalizeLanguage("klingon"), "en");
  assert.equal(normalizeLanguage(undefined), "en");
  assert.equal(normalizeLanguage({ language: "de" }), "en");
});

test("a recording is sent to the provider as an inline data URI with the key kept server-side", async () => {
  const previousKey = process.env.FAL_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FAL_API_KEY = "key-id:key-secret";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ text: "  Shipped the audit fix.  " }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await transcribeAudio({ bytes: new Uint8Array([1, 2, 3]), mime: "audio/webm", language: "fr" });
    assert.deepEqual(result, { ok: true, text: "Shipped the audit fix.", model: "fal-ai/cohere-transcribe" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://fal.run/fal-ai/cohere-transcribe");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Key key-id:key-secret");
    const body = JSON.parse(String(calls[0].init.body)) as { audio_url: string; language: string; punctuation: boolean };
    assert.equal(body.audio_url, `data:audio/webm;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
    assert.equal(body.language, "fr");
    assert.equal(body.punctuation, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = previousKey;
  }
});

test("every provider failure degrades to a truthful reason instead of empty text", async () => {
  const previousKey = process.env.FAL_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FAL_API_KEY = "key-id:key-secret";
  const bytes = new Uint8Array([1, 2, 3]);

  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  };

  try {
    assert.deepEqual(await transcribeAudio({ bytes: new Uint8Array(), mime: "audio/webm" }), { ok: false, reason: "empty_audio" });
    assert.deepEqual(await transcribeAudio({ bytes: new Uint8Array(TRANSCRIBE_MAX_BYTES + 1), mime: "audio/webm" }), { ok: false, reason: "too_large" });
    assert.deepEqual(await transcribeAudio({ bytes, mime: "video/webm" }), { ok: false, reason: "unsupported_audio" });
    assert.deepEqual(await transcribeAudio({ bytes, mime: "" }), { ok: false, reason: "unsupported_audio" });

    respond({}, 402);
    const outOfCredit = await transcribeAudio({ bytes, mime: "audio/webm" });
    assert.equal(outOfCredit.ok, false);
    assert.equal(outOfCredit.ok === false ? outOfCredit.reason : "", "provider_error");
    assert.match(outOfCredit.ok === false ? outOfCredit.detail ?? "" : "", /out of credit/i);

    respond({ error: "boom" }, 500);
    assert.equal((await transcribeAudio({ bytes, mime: "audio/webm" })).ok, false);

    respond({ text: 42 });
    assert.deepEqual(await transcribeAudio({ bytes, mime: "audio/webm" }), { ok: false, reason: "malformed" });

    respond({ text: "   " });
    assert.deepEqual(await transcribeAudio({ bytes, mime: "audio/webm" }), { ok: false, reason: "empty_audio" });

    globalThis.fetch = (async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }) as typeof fetch;
    assert.deepEqual(await transcribeAudio({ bytes, mime: "audio/webm" }), { ok: false, reason: "timeout" });

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    const offline = await transcribeAudio({ bytes, mime: "audio/webm" });
    assert.equal(offline.ok === false ? offline.reason : "", "provider_error");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = previousKey;
  }
});

test("an unconfigured deployment never reaches the provider", async () => {
  const previousKey = process.env.FAL_API_KEY;
  const previousFetch = globalThis.fetch;
  delete process.env.FAL_API_KEY;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  try {
    assert.deepEqual(await transcribeAudio({ bytes: new Uint8Array([1]), mime: "audio/webm" }), { ok: false, reason: "not_configured" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) process.env.FAL_API_KEY = previousKey;
  }
});

/* ── Recorder helpers ───────────────────────────────────────────────────── */

test("the recorder negotiates the first container the provider accepts", () => {
  assert.equal(pickRecorderMime(() => true), "audio/webm;codecs=opus");
  assert.equal(pickRecorderMime((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderMime(() => false), "");
  assert.equal(recorderFileExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(recorderFileExtension("audio/ogg"), "ogg");
  assert.equal(recorderFileExtension("audio/mp4"), "m4a");
});

test("the recording clock and level meter report real values", () => {
  assert.equal(formatRecordingClock(0), "0:00");
  assert.equal(formatRecordingClock(7_400), "0:07");
  assert.equal(formatRecordingClock(72_000), "1:12");
  assert.equal(formatRecordingClock(-5), "0:00");
  assert.equal(levelFromWaveform(new Uint8Array(8).fill(128)), 0);
  assert.equal(levelFromWaveform(new Uint8Array(8).fill(255)), 1);
  assert.ok(levelFromWaveform(new Uint8Array(8).fill(176)) > 0);
});

test("the capture window is bounded on both ends", () => {
  assert.equal(VOICE_MAX_RECORDING_MS, 120_000);
  assert.equal(VOICE_MIN_RECORDING_MS, 500);
  assert.equal(VOICE_HOTKEY_LABEL, "Ctrl + M");
  assert.ok(Object.keys(VOICE_FAILURE_COPY).length >= 6);
});

/* ── Upload parsing ─────────────────────────────────────────────────────── */

test("a recorder part is read with or without a declared type", async () => {
  const typed = new FormData();
  typed.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" }), "voice.webm");
  const typedRead = await readVoiceUpload(typed);
  assert.equal(typedRead.ok, true);
  assert.equal(typedRead.ok === true ? typedRead.mime : "", "audio/webm");
  assert.deepEqual(typedRead.ok === true ? [...typedRead.bytes] : [], [1, 2, 3]);

  /* Chrome reports the type on the blob; the separate `mime` field is the
     fallback for a part that arrives untyped. */
  const untyped = new FormData();
  untyped.append("audio", new Blob([new Uint8Array([9])]), "voice.webm");
  untyped.append("mime", "audio/webm");
  const untypedRead = await readVoiceUpload(untyped);
  assert.equal(untypedRead.ok === true ? untypedRead.mime : "", "audio/webm");

  const nothing = new FormData();
  nothing.append("mime", "audio/webm");
  assert.deepEqual(await readVoiceUpload(nothing), { ok: false, reason: "empty_audio" });

  const silent = new FormData();
  silent.append("audio", new Blob([], { type: "audio/webm" }), "voice.webm");
  assert.deepEqual(await readVoiceUpload(silent), { ok: false, reason: "empty_audio" });

  const wrong = new FormData();
  wrong.append("audio", new Blob([new Uint8Array([1])], { type: "video/webm" }), "voice.webm");
  assert.deepEqual(await readVoiceUpload(wrong), { ok: false, reason: "unsupported_audio" });

  const huge = new FormData();
  huge.append("audio", new Blob([new Uint8Array(TRANSCRIBE_MAX_BYTES + 1)], { type: "audio/webm" }), "voice.webm");
  assert.deepEqual(await readVoiceUpload(huge), { ok: false, reason: "too_large" });
});

/* ── Route contract ─────────────────────────────────────────────────────── */

test("the transcribe route is authenticated, flag-gated, and size-guarded", () => {
  const route = read("src/app/api/work-os/voice/transcribe/route.ts");
  assert.match(route, /requireWorkOsAccess\(/);
  assert.match(route, /authorization: req\.headers\.get\("authorization"\)/);
  assert.match(route, /organizationId: req\.headers\.get\("x-work-os-organization-id"\)/);
  assert.match(route, /feature: VOICE_FEATURE_FLAG/);
  assert.match(route, /const VOICE_FEATURE_FLAG = "voice_input"/);
  assert.match(route, /requirePerson: true/);
  assert.match(route, /readVoiceUpload\(form\)/);
  assert.match(route, /voiceInputConfigured\(\)/);
  assert.doesNotMatch(route, /console\.log|FAL_API_KEY/);
  /* Every other Work OS route funnels unexpected throws through jsonError; a
     bare 500 has no error field for the client to show. */
  assert.match(route, /import \{ jsonError, requireWorkOsAccess \} from "@\/lib\/work-os-api"/);
  assert.match(route, /\} catch \(error\) \{[\s\S]{0,240}?return jsonError\(error\);/);
});

test("voice input is a real organization feature with a live readiness check", () => {
  assert.match(read("src/app/api/work-os/organization/route.ts"), /"voice_input"/);
  const readiness = read("src/lib/work-os-readiness.ts");
  assert.match(readiness, /voice_input: asFlag\(flags\.voice_input\)/);
  assert.match(readiness, /runtime\.fal_key_missing/);
  assert.match(readiness, /FAL_API_KEY is required for Work OS voice input transcription/);
  const migration = read("supabase/migrations/0054_work_os_voice_input.sql");
  assert.match(migration, /"voice_input": true/);
  assert.match(migration, /employee_companion' = 'true'/);
  assert.match(migration, /not \(coalesce\(feature_flags, '\{\}'::jsonb\) \? 'voice_input'\)/);
});

/* ── Composer contract ──────────────────────────────────────────────────── */

test("the companion composer swaps send for record only on an empty draft", () => {
  const composer = read("desktop/work-os-companion/src/chat/ChatComposer.tsx");
  assert.match(composer, /const showRecord = !!voice && voice\.supported && !voiceMode && !value\.trim\(\)/);
  assert.match(composer, /aria-label=\{showRecord \?/);
  assert.match(composer, /onClick=\{showRecord \? \(\) => voice\?\.start\(\) : send\}/);
  assert.match(composer, /aria-keyshortcuts=\{showRecord && hotkeyLabel \? "Control\+M" : "Enter"\}/);
  assert.match(composer, /<Mic size=\{16\}/);
  /* The capture row keeps the composer's grid and offers stop + cancel. */
  assert.match(composer, /aria-label="Stop recording"/);
  assert.match(composer, /aria-label="Cancel recording"/);
  assert.match(composer, /Hold \{hotkeyLabel/);
  assert.match(composer, /data-voice-state=\{voiceState\}/);
  /* Escape abandons a capture, a settled transcript hands the caret back to
     the field, and the live region announces the state. */
  assert.match(composer, /if \(capturing\) voice\?\.cancel\(\)/);
  assert.match(composer, /previousVoiceState\.current === "transcribing" && voiceState === "idle"/);
  assert.match(composer, /Recording your voice update/);
  assert.match(composer, /Transcribed\. Review the text before sending\./);
  assert.doesNotMatch(composer, /VOICE_FAILURE_COPY|TRANSCRIBE_MAX_BYTES/);
});

test("the web check-in composer carries the same voice contract", () => {
  const composer = read("src/modules/work-os/CheckInComposer.tsx");
  assert.match(composer, /const showRecord = voiceEnabled && voice\.supported && !capturing && !transcribing && !value\.trim\(\)/);
  assert.match(composer, /Record update/);
  assert.match(composer, /<Mic size=\{14\} \/> Record update/);
  assert.match(composer, /<Square size=\{13\} fill="currentColor" \/> Stop/);
  assert.match(composer, /aria-keyshortcuts="Control\+M"/);
  assert.match(composer, /event\.key !== "m" && event\.key !== "M"/);
  assert.match(composer, /voiceRef\.current\.stop\(\)/);
  assert.match(composer, /Hold \{VOICE_HOTKEY_LABEL\} to talk/);
  assert.match(composer, /Transcribed — review it, then send\./);
  const employee = read("src/modules/work-os/employee/EmployeeToday.tsx");
  assert.match(employee, /voiceEnabled=\{voiceAvailable\}/);
  assert.match(employee, /<CheckInComposer/);
});

test("both recorders keep the same capture contract", () => {
  const web = read("src/modules/work-os/useVoiceInput.ts");
  const companion = read("desktop/work-os-companion/src/chat/voiceInput.ts");
  for (const helper of ["pickRecorderMime", "recorderFileExtension", "formatRecordingClock", "levelFromWaveform"]) {
    assert.match(web, new RegExp(`export function ${helper}\\(`));
    assert.match(companion, new RegExp(`export function ${helper}\\(`));
  }
  assert.match(web, /export const VOICE_MAX_RECORDING_MS = 120_000;/);
  assert.match(companion, /export const VOICE_MAX_RECORDING_MS = 120_000;/);
  assert.match(web, /export const VOICE_MIN_RECORDING_MS = 500;/);
  assert.match(companion, /export const VOICE_MIN_RECORDING_MS = 500;/);
  assert.match(web, /export const VOICE_HOTKEY_LABEL = "Ctrl \+ M";/);
  assert.match(companion, /export const VOICE_HOTKEY_LABEL = "Ctrl \+ M";/);
  /* The same meter weights, so the two surfaces read identically. */
  assert.match(read("desktop/work-os-companion/src/chat/ChatComposer.tsx"), /const VOICE_METER_BARS = \[0\.45, 0\.75, 1, 0\.75, 0\.45\];/);
  assert.match(read("src/modules/work-os/CheckInComposer.tsx"), /const METER_BARS = \[0\.45, 0\.75, 1, 0\.75, 0\.45\];/);
  /* Neither recorder captures anything at rest. */
  for (const source of [web, companion]) {
    assert.doesNotMatch(source, /useEffect\(\(\) => \{ void start/);
    assert.match(source, /getUserMedia/);
  }
});

test("the voice surfaces use semantic tokens and no decorative recording loop", () => {
  const css = read("desktop/work-os-companion/src/chat/chat.css");
  assert.match(css, /\.chat-voice-meter-bar/);
  assert.match(css, /background: var\(--color-signal-strong\)/);
  assert.match(css, /\.chat-voice-note\.is-receipt \{ color: var\(--color-accent-ink\); \}/);
  /* The meter follows data, and under reduced motion it stops easing. */
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.chat-voice-meter-bar \{ transition: height 90ms linear; \}/);
  const composer = read("desktop/work-os-companion/src/chat/ChatComposer.tsx");
  assert.doesNotMatch(composer, /animate-\[?pulse|animate-pulse/);
});

test("the companion registers a real hold-to-talk shortcut with a per-window ACL grant", () => {
  const rust = read("desktop/work-os-companion/src-tauri/src/lib.rs");
  assert.match(rust, /Code::KeyM/);
  assert.match(rust, /Modifiers::CONTROL/);
  assert.match(rust, /ShortcutState::Pressed/);
  assert.match(rust, /ShortcutState::Released/);
  assert.match(rust, /work-os:\/\/voice\/start/);
  assert.match(rust, /work-os:\/\/voice\/stop/);
  /* The press owns the route, so a release can never land on the other window. */
  assert.match(rust, /struct VoiceHotkeyRoute/);
  assert.match(rust, /route\.0\.lock\(\)\.ok\(\)\.and_then\(\|mut current\| current\.take\(\)\)/);
  assert.match(read("desktop/work-os-companion/src-tauri/Cargo.toml"), /tauri-plugin-global-shortcut = "~2\.3\.2"/);
  assert.match(read("desktop/work-os-companion/src-tauri/permissions/allow-voice-commands.toml"), /set_voice_hotkey/);
  assert.match(read("desktop/work-os-companion/src-tauri/capabilities/default.json"), /allow-voice-commands/);
});

test("the companion answers WebView2 microphone permission for its own origin only", () => {
  const rust = read("desktop/work-os-companion/src-tauri/src/lib.rs");
  assert.match(rust, /COREWEBVIEW2_PERMISSION_KIND_MICROPHONE/);
  assert.match(rust, /COREWEBVIEW2_PERMISSION_STATE_ALLOW/);
  assert.match(rust, /add_PermissionRequested/);
  assert.match(rust, /tauri:\/\/localhost/);
  assert.match(rust, /allow_microphone_capture\(&window\)/);
  assert.match(read("desktop/work-os-companion/src-tauri/Cargo.toml"), /webview2-com = "0\.38"/);
});

test("hold-to-talk is a stored, truthful per-device preference", () => {
  const vault = read("desktop/work-os-companion/src/vault.ts");
  assert.match(vault, /voiceHotkey: boolean;/);
  assert.match(vault, /const voiceHotkey = settings\?\.voiceHotkey !== false;/);
  assert.match(vault, /voiceHotkey: settings\.voiceHotkey \?\? current\?\.voiceHotkey !== false,/);
  const app = read("desktop/work-os-companion/src/App.tsx");
  assert.match(app, /void applyVoiceHotkey\(settings\.voiceHotkey\)/);
  assert.match(app, /invoke<\{ enabled: boolean; error: string \| null \}>\("set_voice_hotkey", \{ enabled \}\)/);
  const personalSettings = read("desktop/work-os-companion/src/PersonalSettings.tsx");
  assert.match(personalSettings, /Hold-to-talk \(Ctrl \+ M\)/);
  /* A refused registration reports the real state instead of toggling anyway. */
  assert.match(app, /if \(applied !== enabled\) return;/);
});

test("the client outlasts the server's provider timeout", () => {
  /* The route bounds the provider at 25s — inside the edge proxy's own
     deadline, so its opaque 504 page can never replace the honest error. A
     client that gave up sooner would abandon a clip still being transcribed. */
  assert.match(read("src/lib/aiTranscribe.ts"), /TRANSCRIBE_TIMEOUT_MS = 25_000/);
  for (const path of ["src/modules/work-os/useVoiceInput.ts", "desktop/work-os-companion/src/chat/voiceInput.ts"]) {
    const source = read(path);
    assert.match(source, /const VOICE_UPLOAD_TIMEOUT_MS = 35_000;/);
    assert.match(source, /AbortSignal\.timeout\(VOICE_UPLOAD_TIMEOUT_MS\)/);
  }
});

test("the mic waits for the server build, not just the workspace flag", () => {
  /* A companion that ships ahead of its server must not offer a record control
     the deployment cannot serve: it waits for the capability, not the flag. */
  const day = read("src/app/api/work-os/me/day/route.ts");
  assert.match(day, /capabilities: \{ voice_input: voiceInputConfigured\(\) \}/);
  assert.match(day, /import \{ voiceInputConfigured \} from "@\/lib\/aiTranscribe"/);

  const employee = read("src/modules/work-os/employee/EmployeeToday.tsx");
  assert.match(employee, /const voiceAvailable = day\.data\?\.access\?\.featureFlags\?\.voice_input === true/);
  assert.match(employee, /&& day\.data\?\.access\?\.capabilities\?\.voice_input === true;/);
  assert.match(employee, /useCheckInVoice\(input, setInput, voiceAvailable\)/);
  assert.match(employee, /voiceEnabled=\{voiceAvailable\}/);

  const dock = read("desktop/work-os-companion/src/App.tsx");
  assert.match(dock, /const voiceAvailable = visibleDay\?\.access\?\.featureFlags\?\.voice_input === true/);
  assert.match(dock, /&& visibleDay\?\.access\?\.capabilities\?\.voice_input === true;/);
  assert.match(dock, /enabled: voiceAvailable,/);
  assert.match(dock, /voice=\{voiceAvailable \? voice : undefined\}/);

  const floating = read("desktop/work-os-companion/src/AvatarApp.tsx");
  assert.match(floating, /voiceAvailable: day\?\.access\?\.featureFlags\?\.voice_input === true && day\?\.access\?\.capabilities\?\.voice_input === true,/);
  assert.match(floating, /enabled: facts\.voiceAvailable,/);
  assert.match(floating, /voice=\{facts\.voiceAvailable \? voice : undefined\}/);

  /* The day payload is where the capability arrives, so both clients must be
     able to read it. */
  assert.match(read("desktop/work-os-companion/src/types.ts"), /capabilities\?: \{ voice_input\?: boolean \}/);
  assert.match(read("desktop/work-os-companion/src/avatarFixture.ts"), /voiceAvailable: boolean;/);
});

test("the companion refreshes the capability from the server on every day load", () => {
  const floating = read("desktop/work-os-companion/src/AvatarApp.tsx");
  assert.match(floating, /voiceAvailable: day\?\.access\?\.featureFlags\?\.voice_input === true && day\?\.access\?\.capabilities\?\.voice_input === true,/);
  /* The fixture stands in for a deployment that can transcribe. */
  const fixture = read("desktop/work-os-companion/src/avatarFixture.ts");
  assert.match(fixture, /voiceAvailable: true,/);
});

test("hold-to-talk is routed by focus, so only the window in use records", () => {
  const rust = read("desktop/work-os-companion/src-tauri/src/lib.rs");

  /* Focus, not the companion's visibility: the floating companion is visible
     almost always, so a visibility test would hand it every hold and steal
     focus from the window the employee was typing in. */
  assert.match(rust, /fn main_window_state/);
  assert.match(rust, /let focused = window\.is_focused\(\)/);
  /* A window the employee cannot see is never the target: a minimized window
     can still report focus on Windows, and a capture recorded there is
     invisible and its suspended webview never finishes the upload. */
  assert.match(rust, /fn main_window_state[\s\S]{0,400}is_minimized/);
  assert.match(rust, /fn voice_route[\s\S]{0,400}focused && !hidden/);
  const routing = rust.slice(rust.indexOf("fn voice_route"), rust.indexOf("fn focus_voice_target"));
  assert.doesNotMatch(routing, /is_visible/, "the routing rule must not depend on visibility");

  /* The non-target window is never raised: focusing the target only shows the
     floating companion, and the main window is left exactly as it was. */
  assert.match(rust, /fn focus_voice_target[\s\S]{0,400}?if target == "avatar" \{\s*\n\s*show_avatar\(app\.clone\(\)\);\s*\n\s*\}/);
  assert.doesNotMatch(rust, /fn focus_voice_target[\s\S]{0,400}?show_main/);

  /* A hold owns the capture: the other window gives up whatever it was doing
     before the target starts, so two recorders can never be live at once. */
  assert.match(rust, /let other = if target == "avatar" \{ "main" \} else \{ "avatar" \};/);
  assert.ok(rust.includes('emit_to(other, "work-os://voice/cancel", voice_event(other))'), "the other window is told to stop, addressed");
  const press = rust.slice(rust.indexOf("ShortcutState::Pressed"), rust.indexOf("ShortcutState::Released"));
  assert.ok(
    press.indexOf('"work-os://voice/cancel"') < press.indexOf('"work-os://voice/start"'),
    "the other window must be told to stop before the target starts",
  );

  /* A release with no recorded press stops both, so a capture cannot outlive
     the hold that opened it. */
  assert.ok(rust.includes('emit_to("main", "work-os://voice/stop", voice_event("main"))'));
  assert.ok(rust.includes('emit_to("avatar", "work-os://voice/stop", voice_event("avatar"))'));

  /* Routing is recorded in the debugger, so a report of a duplicate capture
     can be checked against what the host actually did. */
  assert.match(rust, /diagnostics::host_event\(\s*\n\s*app,\s*\n\s*"voice\.hotkey",/);
  assert.match(rust, /Hold-to-talk start routed to the \{target\} window/);
});

test("a routed voice event is addressed, so only one window ever acts on it", () => {
  /* Tauri's emit filter short-circuits for a listener registered with the
     default target (`match_any_or_filter`: `*target == EventTarget::Any`), so
     `emit_to` reached *both* windows and both started recording. The event now
     carries its address, and the listener also names its window so the filter
     applies. */
  const rust = read("desktop/work-os-companion/src-tauri/src/lib.rs");
  assert.match(rust, /fn voice_event\(target: &str\) -> serde_json::Value \{\s*\n\s*serde_json::json!\(\{ "target": target \}\)/);
  for (const line of rust.split("\n")) {
    if (!line.includes("work-os://voice/")) continue;
    assert.ok(line.includes("voice_event("), `every voice emit must carry its address: ${line.trim()}`);
  }

  const hook = read("desktop/work-os-companion/src/chat/voiceInput.ts");
  assert.match(hook, /export function isVoiceEventFor\(payload: unknown, label: string\): boolean \{\s*\n\s*return \(payload as \{ target\?: unknown \} \| null\)\?\.target === label;/);

  /* Both windows: check the address, and name themselves as the target. */
  for (const path of ["desktop/work-os-companion/src/App.tsx", "desktop/work-os-companion/src/AvatarApp.tsx"]) {
    const source = read(path);
    assert.match(source, /import \{ isVoiceEventFor, useVoiceInput, VOICE_HOTKEY_LABEL \} from "\.\/chat\/voiceInput";/);
    assert.match(source, /const label = .*getCurrentWindow\(\)\.label.*;/);
    assert.match(source, /if \(!isVoiceEventFor\(event\.payload, label\)\) return;/);
    assert.match(source, /\}, \{ target: label \}\)/);
    assert.ok(!source.includes('listen("work-os://voice/start", () => voiceRef.current.start'), "the raw untargeted listener must be gone");
  }

  /* The shim must forward the target, or the listener stays `Any`. */
  assert.match(read("desktop/work-os-companion/src/tauriEvents.ts"), /options\?: ListenOptions,/);
  assert.match(read("desktop/work-os-companion/src/tauriEvents.ts"), /tauriListen<T>\(event, handler, options\)/);
});

test("a hold always opens the microphone once the previous clip is in flight", () => {
  /* The reported unreliability: Ctrl + M did nothing whenever a press landed
     inside the previous upload's 1-3s window, because start() refused any
     state that was not idle. Only a *live* capture is refused now — taking
     that over would let the old recorder's teardown clear the newer capture's
     media references and leave a microphone open. */
  for (const path of ["desktop/work-os-companion/src/chat/voiceInput.ts", "src/modules/work-os/useVoiceInput.ts"]) {
    const source = read(path);
    assert.ok(!source.includes('if (startingRef.current || state !== "idle") return;'), `${path}: the idle-only guard must be gone`);
    assert.match(source, /if \(state === "recording" \|\| state === "requesting"\) \{?/);
    /* Transcription is never a reason to refuse. */
    assert.ok(!/state !== "idle"/.test(source), `${path}: must not refuse while transcribing`);
  }

  /* A settled older capture must not move the state out from under a newer
     one, and an older microphone request must abort instead of opening a
     second recorder. */
  const companion = read("desktop/work-os-companion/src/chat/voiceInput.ts");
  assert.match(companion, /const captureIdRef = useRef\(0\);/);
  assert.match(companion, /const captureId = \(captureIdRef\.current \+= 1\);/);
  assert.match(companion, /const finish = useCallback\(\(cancelled: boolean, captureId: number\)/);
  assert.match(companion, /recorder\.onstop = \(\) => finish\(cancelledRef\.current, captureId\);/);
  assert.match(companion, /if \(captureId === captureIdRef\.current\) setState\("idle"\);/);
  assert.match(companion, /if \(ownerCheck\) setState\("transcribing"\)|if \(ownsComposer\(\)\) setState\("transcribing"\)/);
  assert.match(companion, /captureId !== captureIdRef\.current/);
  /* Every refusal is named, so a silent no-op can never happen again. */
  assert.match(companion, /diagnostics\.info\("voice\.refused"/);
  assert.match(companion, /diagnostics\.info\("voice\.capture", "Voice capture started"/);
  assert.match(companion, /tookOver: "transcript"/);

  const web = read("src/modules/work-os/useVoiceInput.ts");
  assert.match(web, /const captureIdRef = useRef\(0\);/);
  assert.match(web, /const finish = useCallback\(\(cancelled: boolean, captureId: number\)/);
  assert.match(web, /captureId === captureIdRef\.current/);
});

test("a capture cannot be started twice in one window", () => {
  const companion = read("desktop/work-os-companion/src/chat/voiceInput.ts");
  for (const [path, source] of [["companion", companion], ["web", read("src/modules/work-os/useVoiceInput.ts")]] as const) {
    /* The guard is a ref set synchronously before anything is awaited: two
       start requests in one tick would both read the same stale render state. */
    assert.match(source, /const startingRef = useRef\(false\);/);
    /* The double-start guard still runs before any await. */
    const guardAt = source.indexOf("if (startingRef.current)");
    const claimAt = source.indexOf("startingRef.current = true;");
    assert.ok(guardAt !== -1 && claimAt > guardAt, `${path}: the guard must precede the claim`);
    /* Every path that abandons a start releases it, or the microphone could
       never be opened again. */
    assert.ok(source.split("startingRef.current = false").length >= 7, "every failure path must release the guard");
  }
  /* The capture names the surface it came from, for the debugger. */
  assert.match(companion, /diagnostics\.info\("voice\.capture", "Voice capture started", \{/);
  assert.match(read("desktop/work-os-companion/src/App.tsx"), /surface: "dock",/);
  assert.match(read("desktop/work-os-companion/src/AvatarApp.tsx"), /surface: "floating",/);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDebugSession } from "../api";
import {
  AdminOttoSpeechChangedError,
  AdminOttoSpeechQuotaError,
  claimAdminOttoDelivery,
  fetchAdminOttoContext,
  fetchAdminOttoInbox,
  fetchAdminOttoPeople,
  fetchAdminOttoPreferences,
  fetchAdminOttoRecap,
  fetchAdminOttoThread,
  transcribeAdminOttoAudio,
  saveAdminOttoPreferences,
  sendAdminOttoChat,
  speakAdminOttoRecap,
  updateAdminOttoDelivery,
} from "./api";

const session = {
  token: "test-token",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  organizationId: "org-1",
  apiBase: "https://api.test",
};

const recap = {
  intervalId: "interval-1",
  eventId: "event-1",
  person: { id: "person-1", displayName: "Ada", active: true, timezone: "UTC" },
  reviewVersion: 2,
  reviewKey: "key-2",
  sourceRevision: 4,
  scriptHash: "hash-2",
  reviewStatus: "amended" as const,
  reviewedAt: "2026-10-24T11:00:00.000Z",
  windowStart: "2026-10-24T10:00:00.000Z",
  windowEnd: "2026-10-24T11:00:00.000Z",
  timezone: "UTC",
  original: { headline: "Reviewed the queue", detail: "Read the queue.", activities: ["Read the queue"] },
  employeeFeedback: null,
  speechLines: [{ text: "Reviewed the queue.", time: null }],
  coverage: [],
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string>, body: init.body };
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { search: "" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDebugSession(null);
});

describe("admin Otto typed API adapter", () => {
  it("sends context, inbox, claim, preferences and chat through the typed admin routes", async () => {
    setDebugSession(session);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({
        schemaVersion: 1,
        scope: { userId: "user-1", organizationId: "org-1", mode: "admin" },
        personId: null,
        voiceAvailable: true,
        transcriptionAvailable: false,
      }))
      .mockResolvedValueOnce(json({
        schemaVersion: 1, items: [], nextCursor: null, total: 0, asOf: "2026-10-24T12:00:00.000Z",
        coverage: [], unread: 0, catchupPending: false,
      }))
      .mockResolvedValueOnce(json({
        schemaVersion: 1,
        lease: { token: "lease-1", expiresAt: "2026-10-24T12:00:30.000Z", eventIds: ["event-1"], pendingCount: 4 },
      }))
      .mockResolvedValueOnce(json({ schemaVersion: 1, ok: true }))
      .mockResolvedValueOnce(json({ schemaVersion: 1, mode: "selected", personIds: ["person-1"], revision: 2, activated: true }))
      .mockResolvedValueOnce(json({ schemaVersion: 1, mode: "all", personIds: [], revision: 3, activated: true }))
      .mockResolvedValueOnce(json({
        schemaVersion: 1, conversationId: "conversation-1", turnId: "turn-1", reply: "Two open tasks.",
        result: { kind: "tasks", page: { items: [], nextCursor: null, total: 2, asOf: "2026-10-24T12:00:00.000Z", coverage: [] }, people: [] },
        contextVersion: 1,
      }))
      .mockResolvedValueOnce(json({
        schemaVersion: 1, conversationId: "conversation-1", contextVersion: 1, turns: [], result: null, resultStatus: "unavailable",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminOttoContext()).resolves.toMatchObject({ personId: null, voiceAvailable: true });
    await expect(fetchAdminOttoInbox({ cursor: "cursor-1", limit: 12 })).resolves.toMatchObject({ unread: 0 });
    await expect(claimAdminOttoDelivery({ deviceId: "device-1", windowId: "main" }))
      .resolves.toMatchObject({ token: "lease-1", pendingCount: 4 });
    await expect(updateAdminOttoDelivery({
      eventIds: ["event-1"], action: "presented", leaseToken: "lease-1",
    })).resolves.toBeUndefined();
    await expect(fetchAdminOttoPreferences()).resolves.toMatchObject({ mode: "selected", revision: 2 });
    await expect(saveAdminOttoPreferences({ mode: "all", personIds: [], expectedRevision: 2 }))
      .resolves.toMatchObject({ revision: 3 });
    await expect(sendAdminOttoChat({ conversationId: null, requestId: "request-1", text: "unfinished work" }))
      .resolves.toMatchObject({ conversationId: "conversation-1", contextVersion: 1 });
    await expect(fetchAdminOttoThread("conversation-1")).resolves.toMatchObject({ resultStatus: "unavailable" });

    expect(requestAt(fetchMock, 0).url).toBe("https://api.test/api/work-os/admin/otto/context");
    expect(requestAt(fetchMock, 0).init.method).toBe("POST");
    expect(requestAt(fetchMock, 1).url).toBe("https://api.test/api/work-os/admin/otto/inbox?limit=12&cursor=cursor-1");
    expect(requestAt(fetchMock, 2).url).toBe("https://api.test/api/work-os/admin/otto/inbox/claim");
    expect(JSON.parse(String(requestAt(fetchMock, 2).body))).toEqual({ deviceId: "device-1", windowId: "main" });
    expect(requestAt(fetchMock, 3).init.method).toBe("PUT");
    expect(JSON.parse(String(requestAt(fetchMock, 3).body))).toEqual({
      eventIds: ["event-1"], action: "presented", leaseToken: "lease-1",
    });
    expect(requestAt(fetchMock, 4).url).toBe("https://api.test/api/work-os/admin/otto/preferences");
    expect(requestAt(fetchMock, 5).init.method).toBe("PUT");
    expect(requestAt(fetchMock, 6).init.method).toBe("POST");
    expect(JSON.parse(String(requestAt(fetchMock, 6).body))).toEqual({
      schemaVersion: 1, conversationId: null, requestId: "request-1", text: "unfinished work",
    });
    expect(requestAt(fetchMock, 7).url).toBe("https://api.test/api/work-os/admin/otto/chat?conversationId=conversation-1");

    for (let index = 0; index < fetchMock.mock.calls.length; index += 1) {
      const { headers } = requestAt(fetchMock, index);
      expect(headers.Authorization).toBe("Bearer test-token");
      expect(headers["X-Work-OS-Organization-Id"]).toBe("org-1");
    }
  });

  it("reads a bounded active people directory page", async () => {
    setDebugSession(session);
    const fetchMock = vi.fn().mockResolvedValueOnce(json({
      schemaVersion: 1,
      items: [
        { id: "person-1", displayName: "Ada Okafor", active: true, timezone: "Europe/Berlin" },
        { id: "person-2", displayName: "Ben Sato", active: false, timezone: "UTC" },
      ],
      nextCursor: "people-next",
      total: 52,
      asOf: "2026-10-27T12:00:00.000Z",
      coverage: ["Active directory"],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminOttoPeople({ limit: 50, cursor: "people-first" })).resolves.toMatchObject({
      items: [
        { id: "person-1", displayName: "Ada Okafor", active: true, timezone: "Europe/Berlin" },
        { id: "person-2", displayName: "Ben Sato", active: false, timezone: "UTC" },
      ],
      nextCursor: "people-next",
      total: 52,
    });
    expect(requestAt(fetchMock, 0).url).toBe(
      "https://api.test/api/work-os/admin/otto/people?limit=50&cursor=people-first",
    );
    expect(requestAt(fetchMock, 0).init.method).toBe("GET");
  });

  it("reads saved people by explicit bounded ids", async () => {
    setDebugSession(session);
    const fetchMock = vi.fn().mockResolvedValueOnce(json({
      schemaVersion: 1,
      items: [
        { id: "person-1", displayName: "Ivy Former", active: false, timezone: "UTC" },
        { id: "person-2", displayName: "Ada Okafor", active: true, timezone: "Europe/Berlin" },
      ],
      nextCursor: null,
      total: 2,
      asOf: "2026-10-27T12:00:00.000Z",
      coverage: ["Saved same-organization people by explicit id."],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminOttoPeople({ ids: ["person-1", "person-2"] })).resolves.toMatchObject({
      items: [
        { id: "person-1", displayName: "Ivy Former", active: false },
        { id: "person-2", displayName: "Ada Okafor", active: true },
      ],
      nextCursor: null,
      total: 2,
    });
    expect(requestAt(fetchMock, 0).url).toBe(
      "https://api.test/api/work-os/admin/otto/people?ids=person-1%2Cperson-2",
    );
  });

  it("rejects a people page without the shared schema envelope", async () => {
    setDebugSession(session);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ items: [], total: 0 })));
    await expect(fetchAdminOttoPeople()).rejects.toThrow("schema version");
  });

  it("reads an exact reviewed recap", async () => {
    setDebugSession(session);
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ schemaVersion: 1, recap }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAdminOttoRecap("interval-1")).resolves.toMatchObject({ reviewKey: "key-2", reviewVersion: 2 });
    expect(requestAt(fetchMock, 0).url).toBe("https://api.test/api/work-os/admin/otto/recaps/interval-1");
  });

  it("streams reviewed speech with its canonical lines", async () => {
    setDebugSession(session);
    const lines = [{ text: "Reviewed the queue.", time: null }];
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "audio/wav",
        "x-work-os-recap-voice": "Kore",
        "x-work-os-recap-review-key": "key-2",
        "x-work-os-recap-script-hash": "hash-2",
        "x-work-os-recap-lines": encodeURIComponent(JSON.stringify(lines)),
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const clip = await speakAdminOttoRecap({ intervalId: "interval-1", reviewKey: "key-2", voice: "Kore" });
    expect(clip.mimeType).toBe("audio/wav");
    expect(clip.bytes.byteLength).toBe(3);
    expect(clip.voice).toBe("Kore");
    expect(clip.lines).toEqual(lines);
    const request = requestAt(fetchMock, 0);
    expect(request.url).toBe("https://api.test/api/work-os/admin/otto/recaps/interval-1/speech");
    expect(JSON.parse(String(request.body))).toEqual({ schemaVersion: 1, reviewKey: "key-2", voice: "Kore" });
    expect(JSON.stringify(request.body)).not.toContain("Reviewed the queue");
  });

  it("uploads an admin clip without a person mapping", async () => {
    setDebugSession(session);
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ schemaVersion: 1, text: "Reviewed the queue.", model: "fal" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeAdminOttoAudio(new Blob([new Uint8Array([1, 2])], { type: "audio/webm" }));
    expect(result).toEqual({ text: "Reviewed the queue.", model: "fal" });
    const request = requestAt(fetchMock, 0);
    expect(request.url).toBe("https://api.test/api/work-os/admin/otto/transcribe");
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBeInstanceOf(FormData);
    expect((request.init.body as FormData).get("audio")).toBeInstanceOf(Blob);
    expect(request.headers["Content-Type"]).toBeUndefined();
  });

  it("surfaces a stale review with its current recap", async () => {
    setDebugSession(session);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({
      schemaVersion: 1, error: "This recap changed. Refresh it before listening.",
      reason: "review_changed", recap: { ...recap, reviewVersion: 3, reviewKey: "key-3" },
    }, 409)));
    const failure = speakAdminOttoRecap({ intervalId: "interval-1", reviewKey: "key-2" });
    await expect(failure).rejects.toBeInstanceOf(AdminOttoSpeechChangedError);
    await failure.catch((error: AdminOttoSpeechChangedError) => {
      expect(error.current.reviewKey).toBe("key-3");
      expect(error.status).toBe(409);
    });
  });

  it("surfaces speech quota with the server retry window", async () => {
    setDebugSession(session);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({
      schemaVersion: 1, error: "Too many recaps are being read aloud.", reason: "quota_exceeded",
    }, 429, { "Retry-After": "17" })));
    const failure = speakAdminOttoRecap({ intervalId: "interval-1", reviewKey: "key-2" });
    await expect(failure).rejects.toBeInstanceOf(AdminOttoSpeechQuotaError);
    await failure.catch((error: AdminOttoSpeechQuotaError) => {
      expect(error.retryAfterSeconds).toBe(17);
    });
  });

  it("rejects a response without the shared schema version", async () => {
    setDebugSession(session);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ personId: null })));
    await expect(fetchAdminOttoContext()).rejects.toThrow(/schema/i);
  });
});

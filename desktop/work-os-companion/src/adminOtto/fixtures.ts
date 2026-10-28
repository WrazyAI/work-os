import type {
  AdminRead,
  FollowSettings,
  InboxItem,
  InboxPage,
  Page,
  PersonRef,
  ReviewedRecap,
} from "../../../../src/modules/work-os/admin-otto/contracts";
import type { AdminOttoFollowTransport } from "./AdminOttoSettings";
import { AdminOttoApiError } from "./api";

/** Token-free administration fixtures. Every value here is synthetic: no live
 * account, provider, database, or native service is contacted. They exist so
 * rendered QA and the component tests exercise the same payload shapes the
 * Task 8 adapters parse. */
export const FIXTURE_REVIEWED_RECAP: ReviewedRecap = {
  intervalId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  person: {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Synthetic Ada",
    active: true,
    timezone: "UTC",
  },
  reviewVersion: 2,
  reviewKey: "review-fixture-key-2",
  sourceRevision: 7,
  scriptHash: "fixture-script-hash-2",
  reviewStatus: "amended",
  reviewedAt: "2026-10-26T12:00:00.000Z",
  windowStart: "2026-10-26T10:00:00.000Z",
  windowEnd: "2026-10-26T11:00:00.000Z",
  timezone: "UTC",
  original: {
    headline: "Compared the layouts",
    detail: "Inspected a local preview and adjusted the task table.",
    activities: ["Opened the local preview", "Reviewed the task table"],
  },
  employeeFeedback: "The prototype was local, not deployed.",
  recordUrl: "/work-os/admin/people/33333333-3333-4333-8333-333333333333?recap=11111111-1111-4111-8111-111111111111",
  speechLines: [
    { text: "Original AI summary.", time: null },
    { text: "Compared the layouts", time: null },
    { text: "Inspected a local preview and adjusted the task table.", time: null },
    { text: "Employee correction.", time: null },
    { text: "The prototype was local, not deployed.", time: null },
  ],
  coverage: ["AI-inferred activity, employee reviewed; not task completion or attendance."],
};

export const FIXTURE_CONFIRMED_RECAP: ReviewedRecap = {
  ...FIXTURE_REVIEWED_RECAP,
  intervalId: "44444444-4444-4444-8444-444444444444",
  eventId: "55555555-5555-4555-8555-555555555555",
  reviewVersion: 1,
  reviewKey: "review-fixture-key-confirmed",
  reviewStatus: "confirmed",
  employeeFeedback: null,
  speechLines: [
    { text: "Compared the layouts", time: null },
    { text: "Inspected a local preview and adjusted the task table.", time: null },
  ],
  reviewedAt: "2026-10-26T11:30:00.000Z",
  windowStart: "2026-10-26T09:00:00.000Z",
  windowEnd: "2026-10-26T10:00:00.000Z",
};

export function fixtureInboxItem(index = 0, recap: ReviewedRecap = FIXTURE_REVIEWED_RECAP): InboxItem {
  const suffix = String(index + 1).padStart(4, "0");
  return {
    deliveryId: `66666666-6666-4666-8666-6666666666${suffix.slice(-2)}`,
    recap: index === 0 ? recap : {
      ...FIXTURE_CONFIRMED_RECAP,
      intervalId: `77777777-7777-4777-8777-7777777777${suffix.slice(-2)}`,
      eventId: `88888888-8888-4888-8888-8888888888${suffix.slice(-2)}`,
      person: { ...FIXTURE_CONFIRMED_RECAP.person, displayName: `Synthetic Teammate ${index + 1}` },
    },
    seenAt: null,
    listenedAt: index === 1 ? "2026-10-26T12:05:00.000Z" : null,
  };
}

export function fixtureInboxPage(input: {
  count?: number;
  total?: number;
  nextCursor?: string | null;
  unread?: number;
  catchupPending?: boolean;
  recap?: ReviewedRecap;
  offset?: number;
} = {}): InboxPage {
  const count = Math.max(0, input.count ?? 1);
  const offset = Math.max(0, input.offset ?? 0);
  const items = Array.from({ length: count }, (_, index) => fixtureInboxItem(offset + index, input.recap));
  const total = Math.max(count, input.total ?? count);
  return {
    items,
    nextCursor: input.nextCursor === undefined ? (count < total ? "fixture-next-page" : null) : input.nextCursor,
    total,
    asOf: "2026-10-26T12:10:00.000Z",
    coverage: ["30-day reviewed-recap arrivals"],
    unread: input.unread ?? count,
    catchupPending: input.catchupPending ?? false,
  };
}

export function fixtureTaskResult(): AdminRead {
  return {
    kind: "tasks",
    page: {
      items: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          title: "Ship the admin recap inbox",
          assignees: [{ id: "33333333-3333-4333-8333-333333333333", displayName: "Synthetic Ada", active: true, timezone: "UTC" }],
          parentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          parentTitle: "Prepare the admin rollout",
          createdDate: "2026-10-20",
          effectiveDueDate: "2026-10-28",
          status: "open",
          recordUrl: "/work-os/admin/tasks?task=99999999-9999-4999-8999-999999999999",
        },
      ],
      nextCursor: null,
      total: 4,
      asOf: "2026-10-26T12:10:00.000Z",
      coverage: ["Open tasks assigned to the selected people"],
    },
    people: [FIXTURE_REVIEWED_RECAP.person],
  };
}

export function fixtureRecordsResult(): AdminRead {
  return {
    kind: "records",
    page: {
      items: [
        {
          id: "record-fixture-1",
          personId: FIXTURE_REVIEWED_RECAP.person.id,
          source: "reviewed_recap",
          occurredAt: "2026-10-26T11:00:00.000Z",
          localDate: "2026-10-26",
          text: "Reviewed the local preview.",
          recordUrl: `/work-os/admin/people/${FIXTURE_REVIEWED_RECAP.person.id}?recap=${FIXTURE_REVIEWED_RECAP.intervalId}`,
        },
      ],
      nextCursor: null,
      total: 1,
      asOf: "2026-10-26T12:10:00.000Z",
      coverage: ["Reviewed recaps in the selected range"],
    },
    windows: [{ personId: FIXTURE_REVIEWED_RECAP.person.id, timezone: "UTC", from: "2026-10-20", through: "2026-10-26" }],
  };
}

/** A local answer for the administration chat. No provider or workspace
 * request leaves the preview. */
export const ADMIN_FIXTURE_TRANSPORT = {
  send: async (input: { conversationId: string | null; requestId?: string; text: string }) => ({
    conversationId: input.conversationId ?? "admin-fixture-conversation",
    turnId: `admin-fixture-turn-${input.text.length}`,
    reply: "This local fixture answers without contacting the workspace. It shows the read-only task result below.",
    result: fixtureTaskResult(),
    contextVersion: 1,
  }),
  load: async (conversationId: string) => ({
    conversationId,
    contextVersion: 1,
    turns: [],
    result: null,
    resultStatus: "unavailable" as const,
  }),
  inbox: async () => fixtureInboxPage({ count: 2, total: 25, nextCursor: "fixture-next-page", unread: 2 }),
};

/* --- Per-admin follow settings fixture -----------------------------------
   The Settings group talks to the Task 8 GET/PUT preferences routes and the
   bounded `/admin/otto/people` directory. The dev harness has no backend, so
   these local routes model the same state machine: a revision that another
   device can advance, All including newly active people, Selected none
   staying Selected none, active-only directory pages, and field-level failures.
   Every value is synthetic; no live account, provider, database, or native
   service is contacted. */

export const ADMIN_OTTO_FOLLOW_INACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const ADMIN_OTTO_FOLLOW_INACTIVE_PERSON: PersonRef = {
  id: ADMIN_OTTO_FOLLOW_INACTIVE_ID,
  displayName: "Ivy Former",
  active: false,
  timezone: "Europe/Berlin",
};

const FOLLOW_ACTIVE_PEOPLE: PersonRef[] = [
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", displayName: "Ada Okafor", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", displayName: "Ben Sato", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", displayName: "Chloe Marin", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", displayName: "Daniel Osei", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5", displayName: "Elif Kaya", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6", displayName: "Farid Haddad", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7", displayName: "Grace Lin", active: true, timezone: "Europe/Berlin" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8", displayName: "Hugo Berg", active: true, timezone: "Europe/Berlin" },
];

const FOLLOW_PAGED_PEOPLE: PersonRef[] = Array.from({ length: 120 }, (_, index) => {
  const label = String(index + 1).padStart(3, "0");
  const suffix = String(index + 1).padStart(12, "0");
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${suffix}`,
    displayName: `Teammate ${label}`,
    active: true,
    timezone: "Europe/Berlin",
  };
});

export const ADMIN_OTTO_FOLLOW_SCENARIOS = [
  "all",
  "selected-none",
  "selected-inactive",
  "directory-error",
  "save-error",
  "conflict",
  "pagination",
] as const;
export type AdminOttoFollowFixtureScenario = (typeof ADMIN_OTTO_FOLLOW_SCENARIOS)[number];

export type AdminOttoFollowFixture = {
  transport: AdminOttoFollowTransport;
  /** The fixture server's current state. Unlike the UI draft, this changes only
   * on a successful PUT. */
  state: () => FollowSettings;
  setDirectoryFailure: (value: boolean) => void;
  /** Model a failed GET without changing the saved server state. */
  setPreferencesFailure: (value: boolean) => void;
  /** Model another device's successful save after this device loaded. */
  simulateOtherDevice: (input: { mode: "all" | "selected"; personIds: string[] }) => void;
};

function fixturePeopleFor(scenario: AdminOttoFollowFixtureScenario): PersonRef[] {
  return scenario === "pagination" || scenario === "selected-inactive" ? FOLLOW_PAGED_PEOPLE : FOLLOW_ACTIVE_PEOPLE;
}

function fixturePreferencesFor(scenario: AdminOttoFollowFixtureScenario): FollowSettings {
  if (scenario === "selected-none") return { mode: "selected", personIds: [], revision: 3, activated: true };
  if (scenario === "selected-inactive") {
    return { mode: "selected", personIds: [ADMIN_OTTO_FOLLOW_INACTIVE_ID], revision: 2, activated: true };
  }
  if (scenario === "directory-error") {
    return { mode: "selected", personIds: [FOLLOW_ACTIVE_PEOPLE[0]!.id], revision: 1, activated: true };
  }
  return { mode: "all", personIds: [], revision: 0, activated: true };
}

function fixtureStorageKey(account: string, scenario: AdminOttoFollowFixtureScenario): string {
  // The route state is part of the key so a deterministic scenario preview is
  // never polluted by a save made in another fixture scenario.
  return `work-os.admin-otto-follow-fixture.v1.${account}.${scenario}`;
}

function storedFixtureSettings(account: string, scenario: AdminOttoFollowFixtureScenario): FollowSettings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(fixtureStorageKey(account, scenario));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<FollowSettings> | null;
    if (!value || (value.mode !== "all" && value.mode !== "selected")) return null;
    if (!Array.isArray(value.personIds) || value.personIds.some((id) => typeof id !== "string")) return null;
    if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision)) return null;
    return {
      mode: value.mode,
      personIds: value.personIds,
      revision: value.revision,
      activated: value.activated === true,
    };
  } catch {
    return null;
  }
}

function storeFixtureSettings(account: string, scenario: AdminOttoFollowFixtureScenario, settings: FollowSettings) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(fixtureStorageKey(account, scenario), JSON.stringify(settings));
  } catch {
    // A blocked storage area only means the fixture starts fresh on reload.
  }
}

export function createAdminOttoFollowFixture(input: {
  account?: string;
  scenario?: AdminOttoFollowFixtureScenario;
  /** Keep saves across a reload/another dev tab, exactly as one server would. */
  persist?: boolean;
  reset?: boolean;
} = {}): AdminOttoFollowFixture {
  const account = input.account ?? "preview";
  const scenario = input.scenario ?? "all";
  const persist = input.persist === true;
  if (input.reset && persist && typeof localStorage !== "undefined") {
    // A deliberate reset URL clears the previous fixture run. A reload used to
    // prove persistence must omit this param.
    try { localStorage.removeItem(fixtureStorageKey(account, scenario)); } catch { /* no storage */ }
  }
  let state: FollowSettings = (persist ? storedFixtureSettings(account, scenario) : null) ?? fixturePreferencesFor(scenario);
  const active = fixturePeopleFor(scenario);
  const savedChoices = [...active, ADMIN_OTTO_FOLLOW_INACTIVE_PERSON];
  let directoryFailure = scenario === "directory-error";
  let preferencesFailure = false;
  let conflictPending = scenario === "conflict";

  const write = (next: FollowSettings) => {
    state = next;
    if (persist) storeFixtureSettings(account, scenario, next);
  };
  const assertRevision = (expectedRevision: number) => {
    if (expectedRevision !== state.revision) {
      throw new AdminOttoApiError(
        "Follow preferences changed on another device. Reload before saving.",
        409,
        "preferences_conflict",
      );
    }
  };
  const save = async (inputSave: { mode: "all" | "selected"; personIds: string[]; expectedRevision: number }) => {
    if (conflictPending) {
      // The other device saved between this device's GET and Save.
      conflictPending = false;
      write({ mode: "selected", personIds: [active[1]!.id], revision: state.revision + 1, activated: true });
    }
    assertRevision(inputSave.expectedRevision);
    if (scenario === "save-error") {
      throw new AdminOttoApiError("That follow selection could not be saved.", 400, "preferences_invalid");
    }
    const known = new Set([...active.map((person) => person.id), ...state.personIds, ADMIN_OTTO_FOLLOW_INACTIVE_ID]);
    if (inputSave.personIds.some((id) => !known.has(id))) {
      throw new AdminOttoApiError("Every selected employee must belong to this organization.", 400, "preferences_invalid");
    }
    const saved: FollowSettings = {
      mode: inputSave.mode,
      personIds: [...new Set(inputSave.personIds)],
      revision: state.revision + 1,
      activated: true,
    };
    write(saved);
    return saved;
  };
  const loadPeople = async (page: { cursor?: string; limit?: number; ids?: string[] } = {}): Promise<Page<PersonRef>> => {
    if (directoryFailure) throw new Error("The employee directory could not be loaded.");
    if (page.ids) {
      const wanted = [...new Set(page.ids)];
      const items = savedChoices.filter((person) => wanted.includes(person.id))
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
      return {
        items,
        nextCursor: null,
        total: items.length,
        asOf: "2026-10-27T12:00:00.000Z",
        coverage: ["Synthetic saved same-organization people by explicit id; no live account was contacted."],
      };
    }
    const limit = Math.max(1, Math.min(100, Math.trunc(page.limit ?? 50)));
    const match = /^people:(\d+)$/.exec(page.cursor ?? "");
    const offset = Math.max(0, Number(match?.[1] ?? 0));
    const items = active.slice(offset, offset + limit);
    const next = offset + items.length;
    return {
      items,
      nextCursor: next < active.length ? `people:${next}` : null,
      total: active.length,
      asOf: "2026-10-27T12:00:00.000Z",
      coverage: ["Synthetic active directory; no live account or provider was contacted."],
    };
  };

  return {
    transport: {
      loadPreferences: async () => {
        if (preferencesFailure) throw new Error("The latest follow settings could not be loaded.");
        return { ...state, personIds: [...state.personIds] };
      },
      savePreferences: save,
      loadPeople,
    },
    state: () => ({ ...state, personIds: [...state.personIds] }),
    setDirectoryFailure: (value) => { directoryFailure = value; },
    setPreferencesFailure: (value) => { preferencesFailure = value; },
    simulateOtherDevice: ({ mode, personIds }) => {
      write({ mode, personIds: [...new Set(personIds)], revision: state.revision + 1, activated: true });
    },
  };
}

/** Synthetic speech for fixture QA. It is the shipped warm sample, not a live
 * synthesis, and every preview surface labels it as local. */
export async function adminFixtureSpeak(input: { intervalId: string; reviewKey: string; voice?: string }) {
  const response = await fetch("/voices/warm.mp3");
  if (!response.ok) throw new Error("The local speech sample is unavailable.");
  return {
    bytes: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") ?? "audio/mpeg",
    voice: input.voice ?? "Kore",
    reviewKey: input.reviewKey,
    scriptHash: FIXTURE_REVIEWED_RECAP.scriptHash,
    lines: FIXTURE_REVIEWED_RECAP.speechLines,
  };
}

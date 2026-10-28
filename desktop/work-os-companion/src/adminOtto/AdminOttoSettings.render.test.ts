import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowSettings, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { setDebugSession } from "../api";
import { PersonalSettings, type PersonalSettingsProps } from "../PersonalSettings";
import SettingsPage from "../admin/SettingsPage";
import { NotificationProvider } from "../NotificationFlyouts";
import {
  AdminOttoSettings,
  adminOttoFollowInvalidationKeys,
  createAdminOttoFollowController,
  type AdminOttoFollowController,
} from "./AdminOttoSettings";
import { adminOttoFollowChangedEvent } from "./followSignal";
import { sendAdminOttoChat } from "./api";
import {
  ADMIN_OTTO_FOLLOW_INACTIVE_ID,
  createAdminOttoFollowFixture,
  type AdminOttoFollowFixture,
} from "./fixtures";

const scope: OttoScope = { userId: "admin-1", organizationId: "org-1", mode: "admin" };
const noop = () => undefined;

function controllerFor(
  fixture: AdminOttoFollowFixture,
  extras: { invalidate?: () => void; onSaved?: (settings: FollowSettings) => void } = {},
): AdminOttoFollowController {
  return createAdminOttoFollowController({
    scope,
    transport: fixture.transport,
    invalidate: extras.invalidate,
    onSaved: extras.onSaved,
  });
}

async function ready(fixture: AdminOttoFollowFixture) {
  const controller = controllerFor(fixture);
  await controller.start();
  return controller;
}

function renderWithProvider(node: ReturnType<typeof createElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

function renderGroup(controller: AdminOttoFollowController) {
  return renderWithProvider(createElement(AdminOttoSettings, { scope, controller }));
}

function personalProps(overrides: Partial<PersonalSettingsProps> = {}): PersonalSettingsProps {
  return {
    hasPersonalRecord: false,
    tourScope: "admin",
    onReplayTour: noop,
    onOpenProfile: noop,
    autoStart: false,
    onAutoStart: noop,
    voiceHotkeyEnabled: true,
    voiceHotkeyError: null,
    onVoiceHotkey: noop,
    recapVoice: "warm",
    onRecapVoice: noop,
    autoCheckUpdates: true,
    onAutoCheckUpdates: noop,
    updateDetail: "You're on the latest version.",
    updateStatus: "idle",
    installedVersion: "0.4.94",
    onCheckForUpdates: noop,
    onDownloadUpdate: noop,
    onInstallUpdate: noop,
    onOpenWhatsNew: noop,
    pageGuideAutoOpen: true,
    onPageGuideAutoOpen: noop,
    textSize: "small",
    mascotSize: "large",
    onTextSize: noop,
    onMascotSize: noop,
    queueCount: 0,
    queueAttentionCount: 0,
    sessionApiBase: "https://app.wrazyos.com",
    onSignOut: noop,
    memory: { facts: [], loading: false, error: null },
    onOpenMemory: noop,
    onRetryMemory: noop,
    onOpenDebugger: noop,
    onExportDiagnostics: noop,
    onResetOnboarding: noop,
    busy: false,
    ...overrides,
  };
}

function renderPersonal(controller: AdminOttoFollowController, overrides: Partial<PersonalSettingsProps> = {}) {
  return renderWithProvider(createElement(PersonalSettings, {
    ...personalProps(overrides),
    adminOttoSettings: createElement(AdminOttoSettings, { scope, controller }),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setDebugSession(null);
});

describe("admin Otto recap follows", () => {
  it("all_is_default_for_unmapped_admin", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const controller = await ready(fixture);
    expect(controller.snapshot().preferences).toMatchObject({ mode: "all", personIds: [] });

    const markup = renderPersonal(controller, { hasPersonalRecord: false });
    expect(markup).toContain("Recap follows");
    expect(markup).toContain("All active employees");
    expect(markup).toContain("including people who join later");
    expect(markup).toContain("All active employees");
    expect(markup).not.toContain("Search employees");
    // The account's own workday groups stay absent; the follow group does not.
    expect(markup).not.toContain("Profile settings");
    expect(markup).not.toContain("Workday");
  });

  it("selected_none_says_no_alerts", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const controller = await ready(fixture);
    controller.setMode("selected");

    // A draft is not a save: the server still reports All until Save.
    expect(fixture.state()).toMatchObject({ mode: "all" });
    expect(renderGroup(controller)).toContain("No recap alerts");
    expect(renderGroup(controller)).toContain("will not receive reviewed recap alerts for any employee");

    await controller.save();
    expect(fixture.state()).toMatchObject({ mode: "selected", personIds: [] });
    expect(controller.snapshot().draft).toMatchObject({ mode: "selected", selectedPersonIds: [], dirty: false });

    // A fresh controller (a reload or another device) reads the same none.
    const reloaded = await ready(fixture);
    expect(reloaded.snapshot().draft).toMatchObject({ mode: "selected", selectedPersonIds: [] });
    expect(renderGroup(reloaded)).toContain("No recap alerts");
  });

  it("failed_directory_not_empty", async () => {
    const fixture = createAdminOttoFollowFixture({ scenario: "directory-error", persist: false });
    const controller = await ready(fixture);
    expect(controller.snapshot().preferences).toMatchObject({ mode: "selected" });
    expect(controller.snapshot().directoryError).toContain("directory");
    expect(controller.snapshot().directory).toEqual([]);

    const failed = renderGroup(controller);
    expect(failed).toContain("employee directory could not be loaded");
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("No active employees");

    fixture.setDirectoryFailure(false);
    await controller.retryDirectory();
    expect(controller.snapshot().directoryError).toBeNull();
    expect(controller.snapshot().directory.length).toBeGreaterThan(0);
    expect(renderGroup(controller)).toContain("Ada Okafor");
  });

  it("inactive_saved_choice_shown_but_disabled", async () => {
    // The active directory is larger than one page: the saved inactive choice
    // must appear from the explicit ids read without paging the whole roster.
    const fixture = createAdminOttoFollowFixture({ scenario: "selected-inactive", persist: false });
    const controller = await ready(fixture);
    expect(controller.snapshot().draft.selectedPersonIds).toContain(ADMIN_OTTO_FOLLOW_INACTIVE_ID);
    expect(controller.snapshot().directory.length).toBe(50);
    expect(controller.snapshot().directoryComplete).toBe(false);
    expect(controller.snapshot().nextCursor).not.toBeNull();
    expect(controller.snapshot().savedPeople).toContainEqual(expect.objectContaining({
      id: ADMIN_OTTO_FOLLOW_INACTIVE_ID,
      displayName: "Ivy Former",
      active: false,
    }));

    const markup = renderGroup(controller);
    expect(markup).toContain("Ivy Former");
    expect(markup).toContain("No longer active");
    expect(markup).toContain("excluded from delivery");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('checked=""');
    expect(markup).not.toContain("aaaaaaaa");
    // An inactive-only saved selection is effectively no delivery, so the
    // summary must say so instead of counting the retained id as active.
    expect(markup).toContain("No recap alerts");
    expect(markup).not.toContain("1 employee selected for recap alerts");

    controller.setSearch("ivy");
    expect(renderGroup(controller)).toContain("Ivy Former");

    // Saving keeps the saved inactive id so a later reactivation does not
    // silently lose the administrator's choice.
    await controller.save();
    expect(fixture.state().personIds).toContain(ADMIN_OTTO_FOLLOW_INACTIVE_ID);
  });

  it("save_error_preserves_draft", async () => {
    const fixture = createAdminOttoFollowFixture({ scenario: "save-error", persist: false });
    const controller = await ready(fixture);
    const before = fixture.state();
    const chosen = controller.snapshot().directory[0]!.id;
    controller.setMode("selected");
    controller.togglePerson(chosen);
    expect(controller.snapshot().draft.dirty).toBe(true);

    await controller.save();
    expect(controller.snapshot().saveError).toBeTruthy();
    expect(controller.snapshot().draft).toMatchObject({
      mode: "selected",
      selectedPersonIds: [chosen],
      dirty: true,
    });
    expect(fixture.state()).toEqual(before);

    const markup = renderGroup(controller);
    expect(markup).toContain(controller.snapshot().saveError!);
    expect(markup).toContain('checked=""');
  });

  it("other_device_revision_conflict_requires_reload", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const controller = await ready(fixture);
    const mine = controller.snapshot().directory[0]!.id;
    const theirs = controller.snapshot().directory[1]!.id;
    controller.setMode("selected");
    controller.togglePerson(mine);
    fixture.simulateOtherDevice({ mode: "selected", personIds: [theirs] });

    await controller.save();
    expect(controller.snapshot().conflict).toBe(true);
    expect(controller.snapshot().saveError).toContain("Reload");
    expect(controller.snapshot().draft.selectedPersonIds).toEqual([mine]);
    expect(controller.snapshot().preferences?.revision).toBe(0);
    expect(renderGroup(controller)).toContain("Reload");

    // Every draft edit must preserve the conflict and its recovery control;
    // Save stays disabled until a successful reload.
    controller.setSearch("Ben");
    controller.setMode("all");
    controller.setMode("selected");
    controller.togglePerson(theirs);
    expect(controller.snapshot().conflict).toBe(true);
    expect(controller.snapshot().saveError).toContain("Reload");
    const conflicted = renderGroup(controller);
    expect(conflicted).toContain("Reload newer choices");
    expect(conflicted).toContain("Follow settings changed on another device");
    expect(conflicted).toMatch(/class="settings-follow-save"[^>]*disabled/);

    await controller.reload();
    expect(controller.snapshot().conflict).toBe(false);
    expect(controller.snapshot().preferences?.revision).toBe(1);
    expect(controller.snapshot().draft.selectedPersonIds).toEqual([theirs]);
  });

  it("failed_reload_keeps_the_conflict_and_retry_visible", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const controller = await ready(fixture);
    const mine = controller.snapshot().directory[0]!.id;
    const theirs = controller.snapshot().directory[1]!.id;
    controller.setMode("selected");
    controller.togglePerson(mine);
    fixture.simulateOtherDevice({ mode: "selected", personIds: [theirs] });
    await controller.save();
    expect(controller.snapshot().conflict).toBe(true);

    fixture.setPreferencesFailure(true);
    await controller.reload();
    expect(controller.snapshot().conflict).toBe(true);
    expect(controller.snapshot().preferencesError).toContain("could not be loaded");
    expect(controller.snapshot().preferences?.revision).toBe(0);
    const failed = renderGroup(controller);
    expect(failed).toContain("Reload newer choices");
    expect(failed).toContain("could not be loaded");
    expect(failed).toMatch(/class="settings-follow-save"[^>]*disabled/);

    fixture.setPreferencesFailure(false);
    await controller.reload();
    expect(controller.snapshot().conflict).toBe(false);
    expect(controller.snapshot().preferencesError).toBeNull();
    expect(controller.snapshot().preferences?.revision).toBe(1);
    expect(controller.snapshot().draft.selectedPersonIds).toEqual([theirs]);
  });

  it("edits_during_save_keep_the_newer_draft", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const base = fixture.transport;
    let release!: () => void;
    const deferred: AdminOttoFollowController = createAdminOttoFollowController({
      scope,
      transport: {
        ...base,
        savePreferences: (input) => new Promise((resolve, reject) => {
          release = () => { void base.savePreferences(input).then(resolve, reject); };
        }),
      },
    });
    await deferred.start();
    const first = deferred.snapshot().directory[0]!.id;
    const second = deferred.snapshot().directory[1]!.id;
    deferred.setMode("selected");
    deferred.togglePerson(first);
    const saving = deferred.save();
    await Promise.resolve();
    expect(deferred.snapshot().saving).toBe(true);

    // UI controls are disabled while saving, but a programmatic or late edit
    // is still preserved and marked unsaved instead of silently discarded.
    const during = renderGroup(deferred);
    expect(during).toMatch(/type="checkbox"[^>]*disabled/);
    expect(during).toMatch(/type="search"[^>]*disabled/);
    expect(during).toMatch(/role="radio"[^>]*disabled/);
    deferred.togglePerson(second);
    expect(deferred.snapshot().draft.selectedPersonIds).toEqual([first, second]);

    release();
    await saving;
    expect(fixture.state().personIds).toEqual([first]);
    expect(deferred.snapshot().draft.selectedPersonIds).toEqual([first, second]);
    expect(deferred.snapshot().draft.dirty).toBe(true);
    expect(deferred.snapshot().savedNotice).toContain("Newer edits");
    expect(renderGroup(deferred)).toContain("Newer edits");
  });

  it("failed_post_save_refresh_offers_a_retry", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const base = fixture.transport;
    let loads = 0;
    const controller = createAdminOttoFollowController({
      scope,
      transport: {
        ...base,
        loadPreferences: async () => {
          loads += 1;
          if (loads === 2) throw new Error("The latest follow settings could not be loaded.");
          return base.loadPreferences();
        },
      },
    });
    await controller.start();
    controller.setMode("selected");
    await controller.save();
    expect(controller.snapshot().conflict).toBe(false);
    expect(controller.snapshot().preferencesError).toContain("could not be loaded");
    expect(controller.snapshot().savedNotice).toContain("saved");
    expect(renderGroup(controller)).toContain("Retry settings");

    await controller.retryPreferences();
    expect(controller.snapshot().preferencesError).toBeNull();
    expect(controller.snapshot().draft.dirty).toBe(false);
  });

  it("follow_filter_does_not_limit_named_queries", async () => {
    const fixture = createAdminOttoFollowFixture({ scenario: "selected-none", persist: false });
    const controller = await ready(fixture);
    expect(controller.snapshot().draft).toMatchObject({ mode: "selected", selectedPersonIds: [] });
    expect(renderGroup(controller)).toContain("asking about someone by name still works");

    vi.stubGlobal("window", { location: { search: "" } });
    setDebugSession({
      token: "test-token",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      organizationId: "org-1",
      apiBase: "https://api.test",
    });
    const maria = { id: "person-maria", displayName: "Maria Chen", active: true, timezone: "UTC" };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 1,
      conversationId: "conversation-1",
      turnId: "turn-1",
      reply: "Maria has one open task.",
      result: {
        kind: "tasks",
        page: {
          items: [{
            id: "task-1",
            title: "Maria's open task",
            assignees: [maria],
            parentId: null,
            createdDate: null,
            effectiveDueDate: null,
            status: "open",
            recordUrl: "/work-os/admin/tasks?task=task-1",
          }],
          nextCursor: null,
          total: 1,
          asOf: "2026-10-27T12:00:00.000Z",
          coverage: [],
        },
        people: [maria],
      },
      contextVersion: 1,
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendAdminOttoChat({
      conversationId: null,
      requestId: "request-named",
      text: "Show Maria's unfinished tasks.",
    });
    expect(result.result).toMatchObject({ kind: "tasks", people: [maria] });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({
      schemaVersion: 1,
      conversationId: null,
      requestId: "request-named",
      text: "Show Maria's unfinished tasks.",
    });
    expect(JSON.stringify(body)).not.toContain("personIds");
    expect(JSON.stringify(body)).not.toContain("selected");
  });

  it("save_signals_other_windows_with_ids_and_context_only", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const saved: FollowSettings[] = [];
    let invalidated = 0;
    const controller = controllerFor(fixture, {
      invalidate: () => { invalidated += 1; },
      onSaved: (settings) => saved.push(settings),
    });
    await controller.start();
    const chosen = controller.snapshot().directory[0]!.id;
    controller.setMode("selected");
    controller.togglePerson(chosen);
    await controller.save();

    expect(invalidated).toBe(1);
    expect(saved).toHaveLength(1);
    const keys = adminOttoFollowInvalidationKeys(scope);
    expect(keys[0]?.slice(0, 5)).toEqual(["work-os", "admin", "otto", "org-1", "admin-1"]);
    expect(keys[1]?.at(-1)).toBe("inbox");
    expect(keys[2]?.at(-1)).toBe("people");
    const signal = adminOttoFollowChangedEvent(scope, saved[0]!);
    expect(signal).toEqual({
      scope,
      mode: "selected",
      personIds: [chosen],
      revision: 1,
    });
    expect(JSON.stringify(signal)).not.toContain("displayName");
    expect(JSON.stringify(signal)).not.toContain("activated");
  });

  it("selected_none_can_be_saved_while_the_directory_is_unavailable", async () => {
    const fixture = createAdminOttoFollowFixture({ scenario: "directory-error", persist: false });
    const controller = await ready(fixture);
    const chosen = controller.snapshot().draft.selectedPersonIds[0]!;
    controller.togglePerson(chosen);
    expect(controller.snapshot().draft).toMatchObject({ mode: "selected", selectedPersonIds: [] });
    const markup = renderGroup(controller);
    expect(markup).toContain("No recap alerts");
    expect(markup).toMatch(/class="settings-follow-save"(?![^>]*disabled)/);
    await controller.save();
    expect(fixture.state()).toMatchObject({ mode: "selected", personIds: [] });
  });

  it("directory_pagination_search_and_keyboard", async () => {
    const fixture = createAdminOttoFollowFixture({ scenario: "pagination", persist: false });
    const controller = await ready(fixture);
    expect(controller.snapshot().directory.length).toBe(50);
    expect(controller.snapshot().nextCursor).not.toBeNull();
    await controller.loadMore();
    await controller.loadMore();
    expect(controller.snapshot().directory.length).toBe(120);
    expect(controller.snapshot().nextCursor).toBeNull();
    expect(controller.snapshot().directoryComplete).toBe(true);

    controller.setMode("selected");
    controller.setSearch("Teammate 120");
    const filtered = renderGroup(controller);
    expect(filtered).toContain("Teammate 120");
    expect(filtered).not.toContain("Teammate 001");
    expect(filtered).toContain('type="search"');
    expect(filtered).toContain('aria-label="Search employees"');
    expect(filtered).toContain('type="checkbox"');
    expect(filtered).toContain("1 match in 120 loaded of 120 employees");

    controller.setSearch("nobody");
    const noMatch = renderGroup(controller);
    expect(noMatch).toContain("No loaded employees match");
    expect(noMatch).toContain("0 matches in 120 loaded of 120 employees");
    expect(noMatch).toContain("Save");
    // The All/Selected choice keeps one radio-group tab stop and arrow-key
    // semantics, while every checklist control stays natively reachable.
    expect(noMatch).toContain('role="radiogroup"');
    expect(noMatch).toContain('aria-label="All active employees"');
    expect(noMatch).toContain('aria-label="Selected employees"');
    expect(noMatch).toMatch(/data-value="selected"[^>]*aria-checked="true"[^>]*tabindex="0"/);
    expect(noMatch).toMatch(/data-value="all"[^>]*aria-checked="false"[^>]*tabindex="-1"/);
    expect(noMatch).not.toMatch(/type="(search|checkbox)"[^>]*tabindex="-1"/);
    expect(noMatch).not.toContain('role="dialog"');
    // The checklist is flat on the Settings surface: no option cards, nested
    // list card, or second form shell.
    expect(noMatch).not.toContain("settings-follow-option");
    expect(noMatch).not.toContain("settings-follow-list-wrap");
    expect(noMatch).toContain('<div class="settings-follow">');
    expect(noMatch).toContain("Employees who can send recap alerts");
    const group = noMatch.slice(noMatch.indexOf('<section class="settings-group"'));
    expect(group).toContain('aria-labelledby="settings-follow-title"');
    const body = group.slice(group.indexOf("</header>") + "</header>".length);
    expect(body.startsWith('<section class="settings-panel"')).toBe(true);
  });

  it("lays the group under the account settings and inside the admin page", async () => {
    const fixture = createAdminOttoFollowFixture({ persist: false });
    const controller = await ready(fixture);
    const node = createElement(AdminOttoSettings, { scope, controller });
    const markup = renderWithProvider(
      createElement(NotificationProvider, null,
        createElement(SettingsPage, { personalSettings: node })),
    );
    expect(markup.indexOf("Recap follows")).toBeGreaterThan(-1);
    expect(markup.indexOf("Recap follows")).toBeLessThan(markup.indexOf("Workspace status"));
  });

  it("two_admin_accounts_use_independent_revisions", async () => {
    const alpha = createAdminOttoFollowFixture({ account: "alpha", persist: false });
    const beta = createAdminOttoFollowFixture({ account: "beta", persist: false });
    const alphaController = await ready(alpha);
    const betaController = await ready(beta);

    alphaController.setMode("selected");
    await alphaController.save();
    expect(alpha.state()).toMatchObject({ mode: "selected", revision: 1 });
    expect(beta.state()).toMatchObject({ mode: "all", revision: 0 });
    expect(betaController.snapshot().draft.mode).toBe("all");

    expect(renderGroup(alphaController)).toContain("No recap alerts");
    expect(renderGroup(betaController)).toContain("All active employees");
  });
});

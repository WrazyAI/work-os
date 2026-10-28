import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FollowSettings,
  OttoScope,
  Page,
  PersonRef,
} from "../../../../src/modules/work-os/admin-otto/contracts";
import { emit } from "../tauriEvents";
import {
  AdminOttoApiError,
  fetchAdminOttoPeople,
  fetchAdminOttoPreferences,
  saveAdminOttoPreferences,
} from "./api";
import { ADMIN_OTTO_FOLLOW_CHANGED_EVENT, adminOttoFollowChangedEvent } from "./followSignal";
import { adminOttoKeys } from "./queryKeys";

/** One bounded page of the active directory. This is the route's default and
 * comfortably below its hard maximum of 100; Load more asks for the next page
 * instead of issuing an unbounded request. */
export const ADMIN_OTTO_FOLLOW_PAGE_SIZE = 50;
export const ADMIN_OTTO_FOLLOW_MAX_SAVED_PEOPLE = 100;

/** Exactly the actor/organization-scoped reads a saved follow filter can
 * change: the settings themselves, every followed-inbox page, and the bounded
 * directory. Nothing here is a shared global settings key. */
export function adminOttoFollowInvalidationKeys(scope: OttoScope) {
  const keys = adminOttoKeys(scope);
  return [keys.preferences, keys.inboxRoot, keys.peopleRoot] as const;
}

export type AdminOttoFollowTransport = {
  loadPreferences: () => Promise<FollowSettings>;
  savePreferences: (input: {
    mode: "all" | "selected";
    personIds: string[];
    expectedRevision: number;
  }) => Promise<FollowSettings>;
  loadPeople: (input?: { cursor?: string; limit?: number; ids?: string[] }) => Promise<Page<PersonRef>>;
};

export type AdminOttoFollowDraft = {
  mode: "all" | "selected";
  selectedPersonIds: string[];
  search: string;
  /** True until Save persists this draft. Nothing in this component autosaves. */
  dirty: boolean;
};

export type AdminOttoFollowSnapshot = {
  preferences: FollowSettings | null;
  directory: PersonRef[];
  /** The explicitly requested saved choices, including same-organization
   * inactive people. This is not a second active directory or feed. */
  savedPeople: PersonRef[];
  savedPeopleLoading: boolean;
  savedPeopleError: string | null;
  directoryTotal: number;
  nextCursor: string | null;
  directoryComplete: boolean;
  loadingPreferences: boolean;
  loadingDirectory: boolean;
  loadingMore: boolean;
  preferencesError: string | null;
  directoryError: string | null;
  draft: AdminOttoFollowDraft;
  saving: boolean;
  saveError: string | null;
  /** The server revision moved under this draft; only an explicit reload clears
   * it, so a newer choice on another device is never overwritten. */
  conflict: boolean;
  savedNotice: string | null;
};

export type AdminOttoFollowController = {
  snapshot: () => AdminOttoFollowSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => Promise<void>;
  retryPreferences: () => Promise<void>;
  retryDirectory: () => Promise<void>;
  retrySavedPeople: () => Promise<void>;
  loadMore: () => Promise<void>;
  setMode: (mode: "all" | "selected") => void;
  setSearch: (value: string) => void;
  togglePerson: (personId: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
  dispose: () => void;
};

const DEFAULT_TRANSPORT: AdminOttoFollowTransport = {
  loadPreferences: fetchAdminOttoPreferences,
  savePreferences: saveAdminOttoPreferences,
  loadPeople: fetchAdminOttoPeople,
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof AdminOttoApiError
    && error.status === 409
    && error.reason === "preferences_conflict";
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(left);
  return right.every((id) => ids.has(id));
}

/** The follow group's unsaved draft, directory pages, and revision fence.
 *
 * The component owns no server state of its own: this controller is the one
 * place a save, reload, retry, or page append changes what the group shows.
 * Tests drive the same controller the component mounts; the fixture transport
 * models the Task 8 routes without a live account. */
export function createAdminOttoFollowController(input: {
  scope: OttoScope;
  transport?: AdminOttoFollowTransport;
  invalidate?: () => void;
  onSaved?: (settings: FollowSettings) => void;
  /** A ready snapshot for static previews and tests, so a render never invents
   * server state. */
  initial?: {
    preferences?: FollowSettings;
    directory?: Page<PersonRef>;
  };
}): AdminOttoFollowController {
  const transport = input.transport ?? DEFAULT_TRANSPORT;
  const initial = input.initial;
  let state: AdminOttoFollowSnapshot = {
    preferences: initial?.preferences ?? null,
    directory: initial?.directory?.items ?? [],
    savedPeople: [],
    savedPeopleLoading: false,
    savedPeopleError: null,
    directoryTotal: initial?.directory?.total ?? 0,
    nextCursor: initial?.directory?.nextCursor ?? null,
    directoryComplete: !!initial?.directory && initial.directory.nextCursor === null,
    loadingPreferences: !initial?.preferences,
    loadingDirectory: !initial?.directory,
    loadingMore: false,
    preferencesError: null,
    directoryError: null,
    draft: {
      mode: initial?.preferences?.mode ?? "all",
      selectedPersonIds: initial?.preferences ? [...initial.preferences.personIds] : [],
      search: "",
      dirty: false,
    },
    saving: false,
    saveError: null,
    conflict: false,
    savedNotice: null,
  };
  let started = !!initial?.preferences && !!initial?.directory;
  let disposed = false;
  let preferenceGeneration = 0;
  let directoryGeneration = 0;
  let savedPeopleGeneration = 0;
  const listeners = new Set<() => void>();
  const emitChange = () => { for (const listener of listeners) listener(); };
  const set = (patch: Partial<AdminOttoFollowSnapshot>) => {
    state = { ...state, ...patch, draft: patch.draft ?? state.draft };
    emitChange();
  };
  const patchDraft = (patch: Partial<AdminOttoFollowDraft>, dirty = true) => {
    state = {
      ...state,
      draft: { ...state.draft, ...patch, dirty: patch.dirty ?? dirty },
      // A revision conflict is a server fence, not a transient field error:
      // editing the draft must never hide the only recovery control.
      saveError: state.conflict ? state.saveError : null,
      savedNotice: null,
    };
    emitChange();
  };
  const applyPreferences = (settings: FollowSettings, search = state.draft.search) => {
    state = {
      ...state,
      preferences: settings,
      draft: {
        mode: settings.mode,
        selectedPersonIds: [...settings.personIds],
        search,
        dirty: false,
      },
      loadingPreferences: false,
      preferencesError: null,
      saving: false,
      saveError: null,
      conflict: false,
      savedNotice: null,
    };
    emitChange();
  };
  const readSavedPeople = async (personIds: string[]) => {
    const ids = [...new Set(personIds.filter((id) => typeof id === "string" && id))]
      .slice(0, ADMIN_OTTO_FOLLOW_MAX_SAVED_PEOPLE);
    const generation = ++savedPeopleGeneration;
    if (!ids.length) {
      set({ savedPeople: [], savedPeopleLoading: false, savedPeopleError: null });
      return;
    }
    set({ savedPeopleLoading: true, savedPeopleError: null });
    try {
      const page = await transport.loadPeople({ ids });
      if (disposed || generation !== savedPeopleGeneration) return;
      set({
        savedPeople: page.items,
        savedPeopleLoading: false,
        savedPeopleError: null,
      });
    } catch (error) {
      if (disposed || generation !== savedPeopleGeneration) return;
      set({
        savedPeopleLoading: false,
        savedPeopleError: messageOf(error, "Saved employee names could not be loaded."),
      });
    }
  };
  const loadSavedPeopleFor = (settings: FollowSettings) => {
    void readSavedPeople(settings.personIds);
  };
  const readPreferences = async () => {
    const generation = ++preferenceGeneration;
    // The conflict fence stays until a GET succeeds and applyPreferences adopts
    // its revision. Clearing it before the request would re-enable Save with a
    // stale expectedRevision if the reload failed.
    set({
      loadingPreferences: true,
      preferencesError: null,
      ...(state.conflict ? {} : { saveError: null }),
    });
    try {
      const settings = await transport.loadPreferences();
      if (disposed || generation !== preferenceGeneration) return;
      applyPreferences(settings);
      loadSavedPeopleFor(settings);
    } catch (error) {
      if (disposed || generation !== preferenceGeneration) return;
      set({
        loadingPreferences: false,
        preferencesError: messageOf(error, "Your follow settings could not be loaded."),
      });
    }
  };
  const readDirectory = async (cursor: string | null, append: boolean) => {
    const generation = ++directoryGeneration;
    set(append
      ? { loadingMore: true, directoryError: null }
      : { loadingDirectory: true, directoryError: null });
    try {
      const page = await transport.loadPeople({ ...(cursor ? { cursor } : {}), limit: ADMIN_OTTO_FOLLOW_PAGE_SIZE });
      if (disposed || generation !== directoryGeneration) return;
      const seen = new Set(append ? state.directory.map((person) => person.id) : []);
      const items = append
        ? [...state.directory, ...page.items.filter((person) => {
            if (seen.has(person.id)) return false;
            seen.add(person.id);
            return true;
          })]
        : page.items;
      state = {
        ...state,
        directory: items,
        directoryTotal: Math.max(page.total, page.items.length, append ? state.directoryTotal : 0),
        nextCursor: page.nextCursor,
        directoryComplete: page.nextCursor === null,
        loadingDirectory: false,
        loadingMore: false,
        directoryError: null,
      };
      emitChange();
    } catch (error) {
      if (disposed || generation !== directoryGeneration) return;
      set({
        loadingDirectory: false,
        loadingMore: false,
        directoryError: messageOf(error, "The employee directory could not be loaded."),
      });
    }
  };
  const start = async () => {
    // StrictMode mounts, disposes, and mounts the same controller again. A real
    // unmount never calls start a second time, so reopening here keeps the
    // development double-mount from stranding the group on its loading line.
    if (disposed) {
      disposed = false;
      started = false;
    }
    if (started) return;
    started = true;
    await Promise.allSettled([readPreferences(), readDirectory(null, false)]);
  };

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      disposed = false;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    async retryPreferences() {
      await readPreferences();
    },
    async retryDirectory() {
      await readDirectory(null, false);
    },
    async retrySavedPeople() {
      await readSavedPeople(state.draft.selectedPersonIds);
    },
    async loadMore() {
      if (disposed || state.loadingMore || state.loadingDirectory || !state.nextCursor) return;
      await readDirectory(state.nextCursor, true);
    },
    setMode(mode) {
      if (mode === state.draft.mode) return;
      patchDraft({ mode });
    },
    setSearch(value) {
      if (value === state.draft.search) return;
      // Search is a local view over loaded pages, never persisted.
      patchDraft({ search: value }, state.draft.dirty);
    },
    togglePerson(personId) {
      if (!personId || state.draft.mode !== "selected") return;
      const selected = state.draft.selectedPersonIds.includes(personId)
        ? state.draft.selectedPersonIds.filter((id) => id !== personId)
        : [...state.draft.selectedPersonIds, personId];
      patchDraft({ selectedPersonIds: selected });
    },
    async save() {
      if (disposed || state.saving || state.conflict || !state.preferences || !state.draft.dirty) return;
      const preferences = state.preferences;
      const submitted: AdminOttoFollowDraft = { ...state.draft, selectedPersonIds: [...state.draft.selectedPersonIds] };
      set({ saving: true, saveError: null, savedNotice: null });
      try {
        const saved = await transport.savePreferences({
          mode: submitted.mode,
          personIds: submitted.selectedPersonIds,
          expectedRevision: preferences.revision,
        });
        if (disposed) return;
        // The PUT is the save; the GET is the authoritative state the group
        // must show next. A failed re-read never invents local success.
        let fresh = saved;
        let refreshFailed = false;
        try {
          fresh = await transport.loadPreferences();
        } catch {
          refreshFailed = true;
        }
        if (disposed) return;
        const current = state.draft;
        const draftChangedDuringSave = current.mode !== submitted.mode
          || !sameIds(current.selectedPersonIds, submitted.selectedPersonIds);
        if (draftChangedDuringSave) {
          // A late/programmatic edit is never discarded by the response. The
          // server revision is adopted, but the newer draft remains dirty.
          state = {
            ...state,
            preferences: fresh,
            loadingPreferences: false,
            saving: false,
            saveError: null,
            conflict: false,
            preferencesError: refreshFailed
              ? "Saved, but the latest follow settings could not be loaded."
              : null,
            savedNotice: refreshFailed
              ? "Saved your earlier changes. Newer edits are still a draft; retry to confirm the server state."
              : "Saved your earlier changes. Newer edits are still a draft.",
            draft: { ...current, dirty: true },
          };
          emitChange();
        } else {
          applyPreferences(fresh, current.search);
          set({
            savedNotice: refreshFailed
              ? "Follow settings saved. Retry to confirm the latest server state."
              : "Follow settings saved.",
            ...(refreshFailed
              ? { preferencesError: "Saved, but the latest follow settings could not be loaded." }
              : {}),
          });
        }
        loadSavedPeopleFor(fresh);
        input.invalidate?.();
        input.onSaved?.(fresh);
      } catch (error) {
        if (disposed) return;
        if (isRevisionConflict(error)) {
          set({
            saving: false,
            conflict: true,
            saveError: "Follow settings changed on another device. Reload to see the newer choices before saving.",
          });
          return;
        }
        set({
          saving: false,
          saveError: messageOf(error, "Follow settings could not be saved. Your draft is still here."),
        });
      }
    },
    async reload() {
      if (disposed) return;
      await readPreferences();
    },
    dispose() {
      disposed = true;
      // A disposed controller is idle, not permanently spent: StrictMode's
      // second setup calls start() again with the same instance.
      started = false;
      preferenceGeneration += 1;
      directoryGeneration += 1;
      savedPeopleGeneration += 1;
      listeners.clear();
    },
  };
}

export type AdminOttoSettingsProps = {
  scope: OttoScope;
  /** The Task 8 adapters by default. The dev previews pass a local fixture
   * transport; the production shell never does. */
  transport?: AdminOttoFollowTransport;
  /** Test/preview seam: render and drive the exact controller the component
   * would have created itself. */
  controller?: AdminOttoFollowController;
};

/** The account's own recap-follow group.
 *
 * It is one shared settings group in the two-column Settings anatomy: the
 * heading sits in the label column and one content child holds the note, the
 * All/Selected choice, the searchable checklist, and Save. Following decides
 * which reviewed recaps alert this administrator; it never changes workspace
 * access or limits a named on-demand query. */
export function AdminOttoSettings({ scope, transport, controller: supplied }: AdminOttoSettingsProps): ReactElement {
  const queryClient = useQueryClient();
  const [controller] = useState<AdminOttoFollowController>(() => supplied ?? createAdminOttoFollowController({
    scope,
    transport,
    invalidate: () => {
      // A saved filter changes which arrivals exist. Invalidate the scoped
      // preferences/inbox/directory prefixes; the open controller is refreshed
      // by the same IDs-only signal, never by copying a settings object.
      for (const queryKey of adminOttoFollowInvalidationKeys(scope)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onSaved: (settings) => {
      // App and Avatar consume this through the production event adapter to
      // refresh the existing inbox/delivery source for their live scope.
      void emit(ADMIN_OTTO_FOLLOW_CHANGED_EVENT, adminOttoFollowChangedEvent(scope, settings));
    },
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);

  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);

  // A controller supplied for one scope must never be reused after the account
  // changes; the shell keys this component by account.
  const preferences = state.preferences;
  const search = state.draft.search.trim().toLowerCase();
  const activeMatches = search
    ? state.directory.filter((person) => person.displayName.toLowerCase().includes(search))
    : state.directory;
  const activeIds = new Set(state.directory.map((person) => person.id));
  const savedById = new Map(state.savedPeople.map((person) => [person.id, person]));
  const inactiveSaved = state.draft.selectedPersonIds.flatMap((personId) => {
    if (activeIds.has(personId)) return [];
    const saved = savedById.get(personId);
    if (saved) return saved.active ? [] : [saved];
    // The explicit ids read has not answered yet; do not mislabel an active
    // saved choice that sits beyond the loaded directory page. Once it has
    // failed or the directory is complete, retain an honest fallback row.
    if (!state.savedPeopleLoading && (state.savedPeopleError || state.directoryComplete)) {
      return [{
        id: personId,
        displayName: "Saved employee (name unavailable)",
        active: false,
        timezone: "UTC",
      }];
    }
    return [];
  }).filter((person) => !search || person.displayName.toLowerCase().includes(search));
  const selectedActiveCount = state.draft.selectedPersonIds.filter((personId) => {
    const saved = savedById.get(personId);
    return saved ? saved.active : activeIds.has(personId);
  }).length;
  const savedChoicesUnknown = state.draft.selectedPersonIds
    .some((personId) => !activeIds.has(personId) && !savedById.has(personId));
  const savedChoicesPending = state.savedPeopleLoading && savedChoicesUnknown;
  const savedChoicesUnavailable = !!state.savedPeopleError && savedChoicesUnknown;
  const directoryUnavailable = !!state.directoryError && state.directory.length === 0;
  const directoryBlocksSave = state.draft.mode === "selected"
    && directoryUnavailable
    && selectedActiveCount > 0;
  const canSave = !!preferences
    && preferences.activated
    && state.draft.dirty
    && !state.saving
    && !state.loadingPreferences
    && !state.conflict
    && !state.preferencesError
    && !savedChoicesUnavailable
    && !directoryBlocksSave;

  return (
    <section className="settings-group" aria-labelledby="settings-follow-title">
      <header className="settings-group-head">
        <h3 id="settings-follow-title">Recap follows</h3>
      </header>
      <section className="settings-panel" aria-busy={state.loadingPreferences || (state.draft.mode === "selected" && state.loadingDirectory)}>
        <div className="settings-follow">
          <p className="settings-group-note">
            Choose which reviewed recaps alert you here. Following never changes what you can open.
            Following filters never limit on-demand queries by name. Recap alerts are separate from the
            voice this device reads them in.
          </p>

          {state.loadingPreferences && !preferences ? (
            <p className="settings-follow-status" role="status">Loading follow settings…</p>
          ) : null}

          {state.preferencesError && !state.conflict ? (
            <div className="settings-follow-error" role="alert">
              <p>
                {preferences
                  ? "The latest follow settings could not be loaded. Your saved choices remain shown."
                  : "Your follow settings could not be loaded. Nothing was changed."}
              </p>
              <p className="settings-follow-quiet">{state.preferencesError}</p>
              <button type="button" className="quiet-action" onClick={() => void controller.retryPreferences()}>
                Retry settings
              </button>
            </div>
          ) : null}

          {state.conflict ? (
            <div className="settings-follow-error settings-follow-conflict" role="alert">
              <p>
                {state.saveError
                  ?? "Follow settings changed on another device. Reload to see the newer choices before saving."}
              </p>
              {state.preferencesError ? <p className="settings-follow-quiet">{state.preferencesError}</p> : null}
              <button
                type="button"
                className="quiet-action"
                disabled={state.loadingPreferences}
                onClick={() => void controller.reload()}
              >
                {state.loadingPreferences ? "Reloading…" : "Reload newer choices"}
              </button>
            </div>
          ) : null}

          {preferences ? (
            <>
              {!preferences.activated ? (
                <div className="settings-follow-note">
                  <p>
                    Recap follows turn on after Otto finishes setting up this administrator&apos;s inbox.
                    Check again when it is ready.
                  </p>
                  <button type="button" className="quiet-action" onClick={() => void controller.retryPreferences()}>
                    Check again
                  </button>
                </div>
              ) : null}

              <fieldset className="settings-follow-choice">
                <legend>Who should send recap alerts</legend>
                <label className={`settings-follow-option${state.draft.mode === "all" ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name={`admin-otto-follow-mode:${scope.userId}`}
                    value="all"
                    aria-label="All active employees"
                    checked={state.draft.mode === "all"}
                    disabled={state.saving}
                    onChange={() => controller.setMode("all")}
                  />
                  <span>
                    <b>All active employees</b>
                    <small>Every active employee, including people who join later.</small>
                  </span>
                </label>
                <label className={`settings-follow-option${state.draft.mode === "selected" ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name={`admin-otto-follow-mode:${scope.userId}`}
                    value="selected"
                    aria-label="Selected employees"
                    checked={state.draft.mode === "selected"}
                    disabled={state.saving}
                    onChange={() => controller.setMode("selected")}
                  />
                  <span>
                    <b>Selected employees</b>
                    <small>Only the people you tick. Selected none means no recap alerts.</small>
                  </span>
                </label>
              </fieldset>

              {state.draft.mode === "selected" ? (
                <div className="settings-follow-selected">
                  {savedChoicesPending ? (
                    <p className="settings-follow-status" role="status">Checking saved choices…</p>
                  ) : savedChoicesUnavailable ? (
                    <p className="settings-follow-status" role="status">
                      Saved choices need attention before the alert count can be confirmed.
                    </p>
                  ) : selectedActiveCount === 0 ? (
                    <p className="settings-follow-alert" role="status">
                      <b>No recap alerts.</b> You will not receive reviewed recap alerts for any employee.
                    </p>
                  ) : (
                    <p className="settings-follow-status" role="status">
                      {selectedActiveCount} employee{selectedActiveCount === 1 ? "" : "s"} selected for recap alerts.
                    </p>
                  )}

                  {directoryUnavailable ? (
                    <div className="settings-follow-error" role="alert">
                      <p>The employee directory could not be loaded. Your follows are unchanged; no empty roster was assumed.</p>
                      <p className="settings-follow-quiet">{state.directoryError}</p>
                      <button type="button" className="quiet-action" onClick={() => void controller.retryDirectory()}>Retry directory</button>
                    </div>
                  ) : null}

                  {state.loadingDirectory && !state.directory.length ? (
                    <p className="settings-follow-status" role="status">Loading the employee directory…</p>
                  ) : null}

                  {state.savedPeopleError ? (
                    <div className="settings-follow-error" role="alert">
                      <p>Saved employee names could not be loaded. Your saved choices are still retained.</p>
                      <p className="settings-follow-quiet">{state.savedPeopleError}</p>
                      <button type="button" className="quiet-action" onClick={() => void controller.retrySavedPeople()}>
                        Retry saved names
                      </button>
                    </div>
                  ) : null}

                  {!state.loadingDirectory && !directoryUnavailable ? (
                    <>
                      <label className="settings-follow-search">
                        <Search size={14} aria-hidden="true" />
                        <input
                          type="search"
                          value={state.draft.search}
                          aria-label="Search employees"
                          placeholder="Search employees by name"
                          disabled={state.saving}
                          onChange={(event) => controller.setSearch(event.target.value)}
                        />
                      </label>
                      <div className="settings-follow-list-wrap">
                        <ul className="settings-follow-list" aria-label="Employees who can send recap alerts">
                          {inactiveSaved.map((person) => (
                            <li key={person.id} className="is-inactive">
                              <label className="settings-follow-person">
                                <input type="checkbox" checked disabled onChange={() => undefined} />
                                <span>
                                  <b>{person.displayName || "Saved employee"}</b>
                                  <small>No longer active · excluded from delivery</small>
                                </span>
                              </label>
                            </li>
                          ))}
                          {activeMatches.map((person) => (
                            <li key={person.id}>
                              <label className="settings-follow-person">
                                <input
                                  type="checkbox"
                                  checked={state.draft.selectedPersonIds.includes(person.id)}
                                  disabled={state.saving}
                                  onChange={() => controller.togglePerson(person.id)}
                                />
                                <span>
                                  <b>{person.displayName || "Unnamed employee"}</b>
                                  <small>{person.timezone || "Timezone unavailable"}</small>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        {!activeMatches.length && !inactiveSaved.length ? (
                          <p className="settings-follow-empty">
                            {search ? "No loaded employees match this search." : "No active employees are in this directory yet."}
                          </p>
                        ) : null}
                      </div>
                      <div className="settings-follow-directory-foot">
                        <span className="settings-follow-quiet">
                          {search
                            ? `${activeMatches.length} match${activeMatches.length === 1 ? "" : "es"} in ${state.directory.length} loaded of ${state.directoryTotal || state.directory.length} employees`
                            : `Showing ${state.directory.length} of ${state.directoryTotal || state.directory.length} employees`}
                        </span>
                        {state.nextCursor ? (
                          <button
                            type="button"
                            className="quiet-action"
                            disabled={state.loadingMore || state.saving}
                            onClick={() => void controller.loadMore()}
                          >
                            {state.loadingMore ? "Loading…" : "Load more employees"}
                          </button>
                        ) : null}
                      </div>
                      {state.directoryError && state.directory.length ? (
                        <div className="settings-follow-error" role="alert">
                          <p>The next directory page could not be loaded. The employees already shown and your follows are unchanged.</p>
                          <p className="settings-follow-quiet">{state.directoryError}</p>
                          <button type="button" className="quiet-action" onClick={() => void controller.retryDirectory()}>Retry directory</button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="settings-follow-note">
                  All active employees, including new hires, send their reviewed recaps here. Choosing
                  Selected saves only the employees you tick; choosing none saves an explicit empty list
                  and never falls back to All.
                </p>
              )}

              <div className="settings-follow-actions">
                <span className="settings-follow-quiet">
                  Changes stay as a draft until you choose Save.
                </span>
                <button
                  type="button"
                  className="settings-follow-save"
                  disabled={!canSave}
                  onClick={() => void controller.save()}
                >
                  {state.saving ? "Saving…" : "Save"}
                </button>
              </div>

              {state.saveError && !state.conflict ? (
                <div className="settings-follow-error" role="alert">
                  <p>{state.saveError}</p>
                </div>
              ) : null}
              {state.savedNotice ? <p className="settings-follow-success" role="status">{state.savedNotice}</p> : null}
            </>
          ) : null}

          <p className="settings-follow-quiet">
            Follows affect recap alerts only. They do not grant or remove access to any employee record.
          </p>
        </div>
      </section>
    </section>
  );
}



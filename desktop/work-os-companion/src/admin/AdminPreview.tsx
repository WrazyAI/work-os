import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setDebugSession } from "../api";
import AdminWorkspace, { type AdminNotifications } from "./AdminWorkspace";
import { AdminOttoChat } from "../adminOtto/AdminOttoChat";
import { AdminOttoSettings } from "../adminOtto/AdminOttoSettings";
import { adminPreviewNotifications, adminPreviewOverview, seedAdminFixtures } from "./adminFixtures";
import type { AdminSection, AdminSectionFocus, SessionResponse } from "./types";
import type { AdminOttoPendingAction } from "../../../../src/modules/work-os/admin-otto/contracts";
import { ADMIN_FIXTURE_TRANSPORT, ADMIN_OTTO_FOLLOW_SCENARIOS, FIXTURE_ACTIONS, adminFixtureSpeak, createAdminOttoFollowFixture, fixtureInboxPage, FIXTURE_CONFIRMED_RECAP, FIXTURE_REVIEWED_RECAP } from "../adminOtto/fixtures";
import type { AdminOttoFollowFixtureScenario } from "../adminOtto/fixtures";
import { AdminOttoSpeechChangedError } from "../adminOtto/api";
import { createLocalAudioBus, createOttoAudioBroker, createOttoAudioRequester, installOttoAudioRequester } from "../adminOtto/audioOwner";
import { useAdminOttoRecapAudio } from "../adminOtto/useAdminOttoRecapAudio";
import { parseAdminRecordHref } from "../adminOtto/recordLinks";

const PREVIEW_SESSION: SessionResponse = {
  organizationId: "org-preview",
  role: "admin",
  personId: "p-admin",
  userId: "user-preview",
  featureFlags: { employee_companion: true, desktop_companion: true },
};

const SECTIONS: AdminSection[] = ["overview", "people", "tasks", "review", "insights", "evidence", "settings"];
const SCOPE = { userId: PREVIEW_SESSION.userId, organizationId: PREVIEW_SESSION.organizationId, mode: "admin" as const };
/** The fixture New chat is a real action: it answers locally, so rendered QA
 * never sends a request or needs a live admin account. */
export const PREVIEW_ADMIN_OTTO_TRANSPORT = ADMIN_FIXTURE_TRANSPORT;

/** Dev-only rendered-QA fixture for the administration workspace: the real
 * shell and pages driven by seeded API-shaped fixtures. Deep-link a section or
 * a fixture state: `?preview-admin&section=insights&state=empty`, or
 * `state=sparse` for the deliberately partial payloads the data seam must
 * normalize. With `&api=stub`, a fabricated desktop session is registered so
 * write flows (review decisions, toggles, screenshot reasons) reach the API
 * layer, where rendered QA can stub the response; without it, writes stay
 * honestly "not connected" and no request leaves the preview. This page mounts
 * the workspace alone, so shell-level surfaces cannot be exercised here; boot
 * the real shell with `?admin-shell[&overlay=whats-new|profile|guide|memory&otto=chat]`
 * instead (see `src/adminShell.ts`). */
export default function AdminPreview() {
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section");
  const initialSection = SECTIONS.find((value) => value === requested) ?? "overview";
  const requestedState = params.get("state");
  const state = requestedState === "empty" ? "empty" : requestedState === "sparse" ? "sparse" : "dense";
  const ottoState = params.get("otto") ?? "";
  const requestedSettings = params.get("settings");
  const settingsState: AdminOttoFollowFixtureScenario = ADMIN_OTTO_FOLLOW_SCENARIOS.find((state) => state === requestedSettings) ?? "all";
  const settingsAccount = params.get("settings-account") === "two" ? "two" : "one";
  const [followFixture] = useState(() => createAdminOttoFollowFixture({
    account: settingsAccount,
    scenario: settingsState,
    persist: true,
    reset: params.get("settings-reset") === "1",
  }));
  const [followScope] = useState(() => ({
    ...SCOPE,
    userId: settingsAccount === "two" ? "user-preview-two" : SCOPE.userId,
  }));
  const stubApi = params.get("api") === "stub";
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [focus, setFocus] = useState<AdminSectionFocus>({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [ottoOpen, setOttoOpen] = useState(!!ottoState);
  const [ottoTab, setOttoTab] = useState<"chat" | "recaps">(ottoState && ottoState !== "chat" ? "recaps" : "chat");
  const [ottoTabRequest, setOttoTabRequest] = useState<{ tab: "chat" | "recaps"; token: number }>({ tab: "chat", token: 0 });
  const [ottoConversation, setOttoConversation] = useState<string | null>(null);
  const [ottoResetToken, setOttoResetToken] = useState(0);
  const [fixtureActions, setFixtureActions] = useState<AdminOttoPendingAction[]>(() => FIXTURE_ACTIONS.map((action) => ({ ...action })));
  const fixtureWorkflow = {
    id: "admin-fixture-workflow",
    steps: fixtureActions.map((pendingAction, index) => ({ index, label: pendingAction.display?.title ?? pendingAction.summary, status: "ready" as const, pendingAction })),
  };
  const inboxFixture = async (input: { cursor?: string; limit?: number } = {}) => {
    if (ottoState === "loading") return new Promise<never>(() => undefined);
    if (ottoState === "error") throw new Error("The reviewed-recap inbox could not be reached.");
    if (ottoState === "slow") await new Promise((resolve) => setTimeout(resolve, 1_800));
    const empty = ottoState === "empty" || state === "empty";
    return fixtureInboxPage({
      count: empty ? 0 : 2,
      total: empty ? 0 : ottoState === "multiple" ? 25 : 2,
      nextCursor: empty || ottoState !== "multiple" || input.cursor ? null : "fixture-next-page",
      unread: empty ? 0 : 2,
      offset: input.cursor ? 2 : 0,
    });
  };
  const fixtureTransport = {
    ...ADMIN_FIXTURE_TRANSPORT,
    send: ottoState === "cards" || ottoState === "partial"
      ? async (input: { conversationId: string | null; text: string }) => ({
          conversationId: input.conversationId ?? "admin-fixture-conversation",
          turnId: `admin-fixture-cards-${input.text.length}`,
          reply: ottoState === "partial" ? "Example Task 1 was created. Example Task 2 still needs attention." : "Both tasks are ready to review.",
          result: null,
          workflow: { ...fixtureWorkflow, steps: ottoState === "partial"
            ? [{ ...fixtureWorkflow.steps[0], status: "recorded" as const, pendingAction: { ...fixtureWorkflow.steps[0].pendingAction!, status: "recorded" as const }, message: "Task created" },
              { ...fixtureWorkflow.steps[1], pendingAction: { ...fixtureWorkflow.steps[1].pendingAction!, status: "unknown" as const } }]
            : fixtureWorkflow.steps },
          contextVersion: 1,
        })
      : ottoState === "mixed"
        ? async (input: { conversationId: string | null; text: string }) => ({
            conversationId: input.conversationId ?? "admin-fixture-conversation",
            turnId: "admin-fixture-mixed",
            reply: "I found the team's open tasks and prepared one change.",
            result: null,
            workflow: { id: "admin-fixture-mixed", steps: [
              { index: 0, label: "Tasks", status: "recorded" as const, result: { kind: "tasks" as const, page: { items: [{ id: "fixture-task", title: "Review onboarding copy", assignees: [FIXTURE_REVIEWED_RECAP.person], parentId: null, createdDate: "2026-10-20", effectiveDueDate: "2026-11-05", status: "open" as const, recordUrl: `/work-os/admin/tasks?task=fixture-task` }], nextCursor: null, total: 1, asOf: "2026-11-04T12:00:00Z", coverage: ["Open tasks"] }, people: [FIXTURE_REVIEWED_RECAP.person] } },
              { index: 1, label: "Example Task 1", status: "ready" as const, pendingAction: fixtureActions[0] },
            ] },
            contextVersion: 1,
          })
        : ADMIN_FIXTURE_TRANSPORT.send,
    confirm: async (action: AdminOttoPendingAction) => {
      const next: AdminOttoPendingAction = { ...action, status: "recorded", recordUrl: "/work-os/admin/tasks?task=fixture-task" };
      setFixtureActions((current) => current.map((entry) => entry.previewId === action.previewId ? { ...entry, status: "recorded" } : entry));
      return next;
    },
    status: async (action: AdminOttoPendingAction) => action,
    inbox: inboxFixture,
  };
  const staleOnce = useRef(true);
  const fixtureSpeak = ottoState === "stale"
    ? async (input: { intervalId: string; reviewKey: string; voice?: string }) => {
        if (staleOnce.current) {
          staleOnce.current = false;
          throw new AdminOttoSpeechChangedError("This recap changed.", FIXTURE_CONFIRMED_RECAP);
        }
        return adminFixtureSpeak(input);
      }
    : adminFixtureSpeak;
  const audio = useAdminOttoRecapAudio({
    scope: SCOPE,
    epoch: 1,
    voice: "Kore",
    enabled: true,
    speak: fixtureSpeak,
    onListened: async () => undefined,
  });
  // The standalone page has no App shell to install the main broker, so it
  // installs the same local requester/broker pair. Audio is still the shipped
  // synthetic sample; nothing reaches a provider.
  useEffect(() => {
    const local = createLocalAudioBus();
    const broker = createOttoAudioBroker({ local });
    const requester = createOttoAudioRequester({ windowId: "main", bus: local });
    void broker.start();
    const uninstall = installOttoAudioRequester(requester);
    return () => {
      uninstall();
      requester.dispose();
      void broker.stop();
    };
  }, []);
  // The Admin tab resolves inside this preview; the Employee rows belong to
  // the employee workspace, which this page does not mount, so those actions
  // only close the panel and stay honest no-ops here.
  const notifications: AdminNotifications = {
    ...adminPreviewNotifications(state),
    loading: false,
    error: null,
    open: notificationsOpen,
    onToggle: () => setNotificationsOpen((current) => !current),
    onClose: () => setNotificationsOpen(false),
    onSelect: () => setNotificationsOpen(false),
    onOpenMemory: () => setNotificationsOpen(false),
    onOpenRecap: () => setNotificationsOpen(false),
    onOpenOverdue: () => setNotificationsOpen(false),
    onRetry: () => undefined,
    defaultTab: "admin",
    admin: {
      overview: adminPreviewOverview(state),
      loading: false,
      error: null,
      onRetry: () => undefined,
      onNavigate: (next, nextFocus) => {
        setSection(next);
        setFocus(nextFocus ?? {});
        setNotificationsOpen(false);
      },
    },
  };
  useMemo(() => {
    seedAdminFixtures(queryClient, state);
  }, [queryClient, state]);
  useEffect(() => {
    if (!stubApi) return;
    setDebugSession({
      token: "preview-local",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      organizationId: "org-preview",
      apiBase: "",
    });
    return () => setDebugSession(null);
  }, [stubApi]);
  return (
    <>
      <AdminWorkspace
        session={PREVIEW_SESSION}
        notifications={notifications}
        section={section}
        focus={focus}
        onNavigate={(next, nextFocus) => { setSection(next); setFocus(nextFocus ?? {}); }}
        onSwitchToEmployee={() => undefined}
        onNewChat={() => { setOttoConversation(null); setOttoResetToken((value) => value + 1); setOttoTab("chat"); setOttoTabRequest((current) => ({ tab: "chat", token: current.token + 1 })); setOttoOpen(true); }}
        onOpenRecaps={() => { setOttoTab("recaps"); setOttoTabRequest((current) => ({ tab: "recaps", token: current.token + 1 })); setOttoOpen(true); }}
        onSignOut={() => undefined}
        personalSettings={(
          <AdminOttoSettings
            key={`preview-follows:${followScope.userId}`}
            scope={followScope}
            transport={followFixture.transport}
          />
        )}
      />
      {ottoOpen ? (
        <AdminOttoChat
          scope={SCOPE}
          conversationId={ottoConversation}
          initialTab={ottoTab}
          tabRequest={ottoTabRequest}
          initialRecap={ottoState === "single" ? FIXTURE_REVIEWED_RECAP : null}
          resetToken={ottoResetToken}
          initialInbox={ottoState === "loading" || ottoState === "error" ? null : fixtureInboxPage({
            count: ottoState === "empty" || state === "empty" ? 0 : 2,
            total: ottoState === "empty" || state === "empty" ? 0 : ottoState === "multiple" ? 25 : 2,
            nextCursor: ottoState === "multiple" ? "fixture-next-page" : null,
            unread: ottoState === "empty" || state === "empty" ? 0 : 2,
          })}
          arrival={ottoState === "single"
            ? { count: 1, unread: 1, eventIds: [FIXTURE_REVIEWED_RECAP.eventId], recap: FIXTURE_REVIEWED_RECAP }
            : ottoState === "multiple"
              ? { count: 3, unread: 3, eventIds: [], recap: null }
              : null}
          playback={audio.playback}
          recapUpdates={audio.recapUpdates}
          onListen={(recap) => void audio.listen(recap)}
          onStopListening={audio.stop}
          onOpenRecord={(url) => {
            const target = parseAdminRecordHref(url);
            if (!target) return;
            setSection(target.section);
            setFocus(target.focus);
            setOttoOpen(false);
          }}
          transcriptionEnabled
          transcribe={async () => ({ text: "This preview has no microphone transcription; the draft was not sent." })}
          transport={{
            ...fixtureTransport,
            inbox: inboxFixture,
          }}
          onConversation={setOttoConversation}
          onClose={() => setOttoOpen(false)}
        />
      ) : null}
    </>
  );
}

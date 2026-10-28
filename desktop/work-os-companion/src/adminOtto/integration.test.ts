import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recapArrivalCopy } from "./notifications";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Supplemental wiring checks for the shell seams that cannot be exercised as a
 * pure unit (the boot hooks and two Tauri windows). The behavior itself is
 * covered by the executable mode, delivery, API and boot-plan tests; these
 * assertions catch a future edit that leaves the controllers unplugged.
 */
describe("admin Otto shell wiring", () => {
  const app = read("../App.tsx");
  const avatar = read("../AvatarApp.tsx");
  const adminWorkspace = read("../admin/AdminWorkspace.tsx");
  const adminOttoChat = read("./AdminOttoChat.tsx");
  const adminPreview = read("../admin/AdminPreview.tsx");
  const personalSettings = read("../PersonalSettings.tsx");
  const sidebar = read("../SidebarNav.tsx");

  it("admin notice copy states a count but never a recap body", () => {
    expect(recapArrivalCopy(1)).toEqual({
      title: "Reviewed recaps are ready",
      body: "1 reviewed recap is waiting in the administration inbox.",
    });
    expect(recapArrivalCopy(3).body).toBe("3 reviewed recaps are waiting in the administration inbox.");
    expect(JSON.stringify(recapArrivalCopy(3))).not.toMatch(/headline|activities|reviewedAt|recap:/);
  });

  it("boots the admin shell from authoritative context and gates personal reads", () => {
    expect(app).toContain("planAdminOttoBootstrap(");
    expect(app).toContain("fetchAdminOttoContext");
    expect(app).toMatch(/useDayQuery\(\{ enabled: employeeBootstrapEnabled/);
    expect(app).toMatch(/useOnboardingQuery\(\{ enabled: employeeBootstrapEnabled/);
    expect(app).toContain("adminOtto: workSessionQuery.data?.role === \"admin\"");
    expect(app).toMatch(/personalBootstrapFlags\(\{\s+syncBypass,/);
    expect(app).toContain("adminOttoRoleAllowed");
    expect(app).toContain("enabled: signedIn && !syncBypass && adminOttoRoleAllowed");
    expect(app).toContain("personalBootstrapAccess");
    expect(app).toContain("runPersonalBootstrapRefresh");
  });

  it("wires New chat to the shared admin chat instead of a no-op", () => {
    expect(app).toContain("<AdminOttoChat");
    expect(app).toContain("onNewChat={openAdminOtto}");
    expect(app).toContain("onOpenRecord={openAdminRecord}");
    expect(adminWorkspace).toContain("onNewChat={() => onNewChat?.()}");
    expect(sidebar).toContain("sidebar-new-chat");
    // The host callback and its writeback are stable: a stale render snapshot
    // cannot put the old conversation id back into App after New chat.
    expect(app).toContain("const handleAdminOttoConversation = useCallback");
    expect(app).toContain("onConversation={handleAdminOttoConversation}");
    expect(adminOttoChat).toContain("syncAdminOttoConversation({");
    expect(adminOttoChat).toContain("renderConversationId: chat.conversationId");
    expect(adminOttoChat).not.toContain("if (chat.conversationId && chat.conversationId !== conversationRef.current)");
    // The surface rendered for administration is not the employee composer and
    // never offers its proposal/decision controls.
    expect(app).not.toMatch(/onNewChat=\{\(\) => undefined\}/);
    expect(app).toContain("transcribeAdminOttoAudio");
  });

  it("mounts the follow group in the account settings slot on both admin hosts", () => {
    expect(app).toContain("<AdminOttoSettings");
    expect(app).toContain("adminOttoSettings={surface === \"admin\"");
    expect(personalSettings).toContain("adminOttoSettings?: ReactNode");
    expect(personalSettings).toContain("{adminOttoSettings}");
    expect(adminPreview).toContain("<AdminOttoSettings");
    expect(adminPreview).toContain("personalSettings={(");
  });

  it("consumes the follow signal in both windows through the production adapter", () => {
    expect(app).toContain("listenAdminOttoFollowChanged(");
    expect(app).toContain("adminOttoFollowChangedAppliesTo(changed, current)");
    expect(app).toContain("setAdminOttoFollowRevision");
    expect(app).toContain("followRevision={adminOttoFollowRevision}");
    expect(adminOttoChat).toContain("followRevision = 0");
    expect(adminOttoChat).toContain("inboxRevision + arrivalRevision + followRevision");
    expect(avatar).toContain("listenAdminOttoFollowChanged(");
    expect(avatar).toContain("adminOttoFollowChangedAppliesTo(changed, current.scope)");
    expect(avatar).toContain("adminDeliveryRef.current?.pollNow(\"manual\")");
  });

  it("wires the mode controller to abort/clear and to publish only scope+epoch", () => {
    expect(app).toContain("createOttoModeController({");
    expect(app).toContain("switchMode(next)");
    expect(app).toContain("ottoContextEvent(snapshot)");
    expect(app).toContain("adminOttoChangedEvent({");
    expect(app).not.toMatch(/emit\(OTTO_CONTEXT_EVENT, snapshot\)/);
  });

  it("starts delivery in both windows and keeps the shared epoch", () => {
    for (const source of [app, avatar]) {
      expect(source).toContain("startAuthorizedAdminRecapDelivery({");
      expect(source).toContain("startDeliveryOwnership({");
    }
    expect(avatar).toContain("OTTO_CONTEXT_EVENT");
    expect(avatar).toContain("presentAdminRecapArrival");
    expect(avatar).toContain("adminOttoChangedEvent");
    expect(app).toContain("listen<Record<string, unknown>>(OTTO_CHANGED_EVENT");
    expect(app).toContain("presentAdminOttoArrival");
    expect(app).toContain("notifications.persistent(\"admin-otto-recap-arrival\"");
    expect(app).toContain("openAdminOttoSurface({ tab: \"recaps\", recap, listen: true })");
    expect(app).toContain("deliveryOwnershipKey(snapshot)");
    expect(avatar).toContain("createAvatarContextController({");
    expect(avatar).toContain("avatarContextController.isCurrent(context)");
    expect(app).toContain("requestOttoAudioStop");
    expect(app).toContain("requestOttoAudio(requested.scope, requested.epoch");
    expect(app).toContain("audioScope={workSessionQuery.data");
    expect(app).toContain("controller.pollNow(\"reconnect\")");
  });
});

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AvatarApp from "./AvatarApp";
import ErrorBoundary from "./ErrorBoundary";
import OnboardingPreview from "./OnboardingPreview";
import ConnectPreview from "./ConnectPreview";
import AvatarPreview from "./AvatarPreview";
import ChatPreview from "./ChatPreview";
import EodPreview from "./EodPreview";
import InsightsSynthesisPreview from "./InsightsSynthesisPreview";
import InsightsPreview from "./InsightsPreview";
import AdminPreview from "./admin/AdminPreview";
import EodOutstandingPreview from "./EodOutstandingPreview";
import ActivityIntervalPreview from "./ActivityIntervalPreview";
import TasksPreview from "./TasksPreview";
import TaskDesignGallery from "./TaskDesignGallery";
import TodayPreview from "./TodayPreview";
import PlanningPreview from "./PlanningPreview";
import LoadingPreview from "./LoadingPreview";
import SkeletonsPreview from "./SkeletonsPreview";
import OttoPreview from "./OttoPreview";
import MemoryPreview from "./MemoryPreview";
import SettingsPreview from "./SettingsPreview";
import ProfilePreview from "./ProfilePreview";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import { installBootTrace } from "./bootTrace";
import { NotificationProvider } from "./NotificationFlyouts";
import { QueryClientProvider } from "@tanstack/react-query";
import { restoreWorkOsQueryCache, startWorkOsQueryPersistence, workOsQueryClient } from "./queryClient";
import "./styles.css";
import "./sessionGate.css";
import "./workspace-redesign.css";
import "./dashboard-overhaul.css";
import "./sidebar.css";
import "./task-design-gallery.css";
import "./loading.css";
import "./onboarding-stage.css";
import "./onboarding-form.css";
import "./otto.css";
import "./signal-spirit.css";
import "./work-os-chat.css";
import "./chat/chat.css";
import "./avatar.css";
import "./accessibility.css";
import "./chat/conversation.css";
import "./chat/tool-surfaces.css";
import "./adminOtto/adminOtto.css";

installDiagnosticErrorHandlers();
installBootTrace();
diagnostics.info("app.webview.start", "WebView booting", { search: window.location.search, origin: window.location.origin, userAgent: navigator.userAgent });

const params = new URLSearchParams(window.location.search);
if (params.get("window") === "avatar") {
  document.documentElement.classList.add("avatar-window");
  document.body.classList.add("avatar-window");
}
const Root = params.get("window") === "avatar" ? AvatarApp
  : import.meta.env.DEV && params.has("preview-connect") ? ConnectPreview
  : import.meta.env.DEV && params.has("preview-onboarding") ? OnboardingPreview
    : import.meta.env.DEV && params.has("preview-avatar") ? AvatarPreview
    : import.meta.env.DEV && params.has("preview-chat") ? ChatPreview
    : import.meta.env.DEV && params.has("preview-task-options") ? TaskDesignGallery
      : import.meta.env.DEV && params.has("preview-tasks") ? TasksPreview
        : import.meta.env.DEV && params.has("preview-today") ? TodayPreview
          : import.meta.env.DEV && params.has("preview-loading") ? LoadingPreview
              : import.meta.env.DEV && params.has("preview-skeletons") ? SkeletonsPreview
                : import.meta.env.DEV && (params.has("preview-otto") || params.has("preview-mascot") || params.has("preview-signal-spirit")) ? OttoPreview
                : import.meta.env.DEV && params.has("preview-memory") ? MemoryPreview
                : import.meta.env.DEV && params.has("preview-settings") ? SettingsPreview
                  : import.meta.env.DEV && params.has("preview-profile") ? ProfilePreview
                : import.meta.env.DEV && params.has("preview-plan") ? PlanningPreview
            : import.meta.env.DEV && params.has("preview-eod") ? EodPreview
                : import.meta.env.DEV && params.has("preview-admin") ? AdminPreview
: import.meta.env.DEV && params.has("preview-insights") ? InsightsPreview
              : import.meta.env.DEV && params.has("preview-insights-synthesis") ? InsightsSynthesisPreview
                : import.meta.env.DEV && params.has("preview-outstanding") ? EodOutstandingPreview
                  : import.meta.env.DEV && params.has("preview-activity-intervals") ? ActivityIntervalPreview
              : App;

if (params.get("window") !== "avatar") startWorkOsQueryPersistence(workOsQueryClient);
// Restore runs in parallel with boot: the vault gate keeps screens hidden
// until session/vault reads settle, so hydration lands before real data use.
void restoreWorkOsQueryCache(workOsQueryClient);
/* DEV-only: `?frame=320x430` renders the surface at a fixed size, so a surface
 * that lives in a resized desktop window (the companion's grown reading bubble,
 * for instance) can be reviewed at its true proportions in a browser. */
function frameFromSearch(): { width: number; height: number } | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("frame");
  const match = value?.match(/^(\d{3,4})x(\d{3,4})$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}
const frame = frameFromSearch();

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={workOsQueryClient}><NotificationProvider><ErrorBoundary>{frame
  ? <div
      data-dev-frame={`${frame.width}x${frame.height}`}
      style={{
        width: frame.width,
        height: frame.height,
        overflow: "hidden",
        margin: "12px auto",
        outline: "1px dashed rgba(140,140,140,.6)",
      } as import("react").CSSProperties}
    ><Root /></div>
  : <Root />}</ErrorBoundary></NotificationProvider></QueryClientProvider></React.StrictMode>);

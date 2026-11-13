import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
const AvatarApp = lazy(() => import("./AvatarApp"));
import ErrorBoundary from "./ErrorBoundary";
const OnboardingPreview = lazy(() => import("./OnboardingPreview"));
const ConnectPreview = lazy(() => import("./ConnectPreview"));
const AvatarPreview = lazy(() => import("./AvatarPreview"));
const ChatPreview = lazy(() => import("./ChatPreview"));
const EodPreview = lazy(() => import("./EodPreview"));
const InsightsSynthesisPreview = lazy(() => import("./InsightsSynthesisPreview"));
const InsightsPreview = lazy(() => import("./InsightsPreview"));
const AdminPreview = lazy(() => import("./admin/AdminPreview"));
const EodOutstandingPreview = lazy(() => import("./EodOutstandingPreview"));
const ActivityIntervalPreview = lazy(() => import("./ActivityIntervalPreview"));
const TasksPreview = lazy(() => import("./TasksPreview"));
const TaskDesignGallery = lazy(() => import("./TaskDesignGallery"));
const TodayPreview = lazy(() => import("./TodayPreview"));
const PlanningPreview = lazy(() => import("./PlanningPreview"));
const LoadingPreview = lazy(() => import("./LoadingPreview"));
const SkeletonsPreview = lazy(() => import("./SkeletonsPreview"));
const OttoPreview = lazy(() => import("./OttoPreview"));
const MemoryPreview = lazy(() => import("./MemoryPreview"));
const SettingsPreview = lazy(() => import("./SettingsPreview"));
const ProfilePreview = lazy(() => import("./ProfilePreview"));
import { FirstLightSurface } from "./BootHandoff";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import { installBootTrace } from "./bootTrace";
import { NotificationProvider } from "./NotificationFlyouts";
import { QueryClientProvider } from "@tanstack/react-query";
import { startWorkOsQueryPersistence, workOsQueryClient } from "./queryClient";
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
import "./window-chrome.css";
import "./theme.css";

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

if (params.get("window") !== "avatar") {
  startWorkOsQueryPersistence(workOsQueryClient);
}
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

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={workOsQueryClient}><NotificationProvider><ErrorBoundary><Suspense fallback={params.get("window") === "avatar" ? null : <FirstLightSurface stage="Opening Work OS" />}>{frame
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
  : <Root />}</Suspense></ErrorBoundary></NotificationProvider></QueryClientProvider></React.StrictMode>);

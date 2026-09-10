import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AvatarApp from "./AvatarApp";
import ErrorBoundary from "./ErrorBoundary";
import OnboardingPreview from "./OnboardingPreview";
import AvatarPreview from "./AvatarPreview";
import ChatPreview from "./ChatPreview";
import EodPreview from "./EodPreview";
import TasksPreview from "./TasksPreview";
import TodayPreview from "./TodayPreview";
import PlanningPreview from "./PlanningPreview";
import LoadingPreview from "./LoadingPreview";
import SkeletonsPreview from "./SkeletonsPreview";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import { NotificationProvider } from "./NotificationFlyouts";
import { QueryClientProvider } from "@tanstack/react-query";
import { restoreWorkOsQueryCache, startWorkOsQueryPersistence, workOsQueryClient } from "./queryClient";
import "./styles.css";
import "./sessionGate.css";
import "./workspace-redesign.css";
import "./loading.css";
import "./work-os-chat.css";
import "./avatar.css";

installDiagnosticErrorHandlers();
diagnostics.info("app.webview.start", "WebView booting", { search: window.location.search, userAgent: navigator.userAgent });

const params = new URLSearchParams(window.location.search);
if (params.get("window") === "avatar") {
  document.documentElement.classList.add("avatar-window");
  document.body.classList.add("avatar-window");
}
const Root = params.get("window") === "avatar" ? AvatarApp
  : import.meta.env.DEV && params.has("preview-onboarding") ? OnboardingPreview
    : import.meta.env.DEV && params.has("preview-avatar") ? AvatarPreview
    : import.meta.env.DEV && params.has("preview-chat") ? ChatPreview
    : import.meta.env.DEV && params.has("preview-tasks") ? TasksPreview
        : import.meta.env.DEV && params.has("preview-today") ? TodayPreview
          : import.meta.env.DEV && params.has("preview-loading") ? LoadingPreview
              : import.meta.env.DEV && params.has("preview-skeletons") ? SkeletonsPreview
                : import.meta.env.DEV && params.has("preview-plan") ? PlanningPreview
            : import.meta.env.DEV && params.has("preview-eod") ? EodPreview
              : App;

if (params.get("window") !== "avatar") startWorkOsQueryPersistence(workOsQueryClient);
// Restore runs in parallel with boot: the vault gate keeps screens hidden
// until session/vault reads settle, so hydration lands before real data use.
void restoreWorkOsQueryCache(workOsQueryClient);
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={workOsQueryClient}><NotificationProvider><ErrorBoundary><Root /></ErrorBoundary></NotificationProvider></QueryClientProvider></React.StrictMode>);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AvatarApp from "./AvatarApp";
import ErrorBoundary from "./ErrorBoundary";
import OnboardingPreview from "./OnboardingPreview";
import AvatarPreview from "./AvatarPreview";
import EodPreview from "./EodPreview";
import TasksPreview from "./TasksPreview";
import TodayPreview from "./TodayPreview";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import { NotificationProvider } from "./NotificationFlyouts";
import "./styles.css";
import "./sessionGate.css";
import "./workspace-redesign.css";
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
    : import.meta.env.DEV && params.has("preview-tasks") ? TasksPreview
      : import.meta.env.DEV && params.has("preview-today") ? TodayPreview
        : import.meta.env.DEV && params.has("preview-eod") ? EodPreview
          : App;

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><NotificationProvider><ErrorBoundary><Root /></ErrorBoundary></NotificationProvider></React.StrictMode>);

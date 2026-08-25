import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import OnboardingPreview from "./OnboardingPreview";
import TasksPreview from "./TasksPreview";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import { NotificationProvider } from "./NotificationFlyouts";
import "./styles.css";
import "./sessionGate.css";
import "./workspace-redesign.css";

installDiagnosticErrorHandlers();
diagnostics.info("app.webview.start", "WebView booting", { search: window.location.search, userAgent: navigator.userAgent });

const params = new URLSearchParams(window.location.search);
const Root = import.meta.env.DEV && params.has("preview-onboarding") ? OnboardingPreview : import.meta.env.DEV && params.has("preview-tasks") ? TasksPreview : App;

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><NotificationProvider><ErrorBoundary><Root /></ErrorBoundary></NotificationProvider></React.StrictMode>);

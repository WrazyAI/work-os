import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DebugWindow from "./DebugWindow";
import ErrorBoundary from "./ErrorBoundary";
import OnboardingPreview from "./OnboardingPreview";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import "./styles.css";

installDiagnosticErrorHandlers();
diagnostics.info("app.webview.start", "WebView booting", { search: window.location.search, userAgent: navigator.userAgent });

const params = new URLSearchParams(window.location.search);
const Root = params.has("debug")
  ? DebugWindow
  : import.meta.env.DEV && params.has("preview-onboarding")
    ? OnboardingPreview
    : App;

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><Root /></ErrorBoundary></React.StrictMode>);

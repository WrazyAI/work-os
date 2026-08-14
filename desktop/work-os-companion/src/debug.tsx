import React from "react";
import ReactDOM from "react-dom/client";
import DebugWindow from "./DebugWindow";
import ErrorBoundary from "./ErrorBoundary";
import { diagnostics, installDiagnosticErrorHandlers } from "./diagnostics";
import "./styles.css";

installDiagnosticErrorHandlers();
diagnostics.info("app.webview.start", "Debugger WebView booting", { entry: "debug.html", userAgent: navigator.userAgent });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ErrorBoundary><DebugWindow /></ErrorBoundary></React.StrictMode>,
);

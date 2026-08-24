import { Component, type ErrorInfo, type ReactNode } from "react";
import { diagnostics } from "./diagnostics";
import { useNotifications } from "./NotificationFlyouts";
import wordmark from "./assets/work-os-mark.png";

class AppErrorBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    diagnostics.error("react.error_boundary", error.message, { componentStack: info.componentStack ?? "" });
    this.props.onError(error.message || "An unexpected application error occurred.");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="loading"><img src={wordmark} alt="" /><h1>Work OS needs a restart</h1><p>The details are available in the notification and diagnostics log.</p></main>;
  }
}

export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const notifications = useNotifications();
  return <AppErrorBoundary onError={(message) => notifications.error(message, "Application error")}>{children}</AppErrorBoundary>;
}

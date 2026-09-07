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

export function ChatErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="chat-error" role="alert">
      <strong>This message couldn&apos;t render</strong>
      <p>Your conversation is preserved. Try again, and the failure is logged for diagnostics.</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

/** Isolates one chat region so a single bad card can never blank the whole
 * conversation. Failures are reported to diagnostics with their component
 * stack for later inspection. */
export class ChatSectionBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(_error: Error) {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    diagnostics.error("react.chat_boundary", `${this.props.label}: ${error.message}`, { componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <ChatErrorFallback onRetry={() => this.setState({ failed: false })} />;
  }
}

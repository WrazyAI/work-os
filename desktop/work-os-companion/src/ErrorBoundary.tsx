import { Component, type ErrorInfo, type ReactNode } from "react";
import { diagnostics } from "./diagnostics";
import wordmark from "./assets/work-os-mark.png";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    diagnostics.error("react.error_boundary", error.message, { componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.message) return this.props.children;
    return <main className="loading"><img src={wordmark} alt="" /><h1>Something went wrong</h1><p>{this.state.message}</p></main>;
  }
}

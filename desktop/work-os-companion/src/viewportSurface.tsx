import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * App-wide task surfaces and management dialogs have one seam: they render
 * through document.body so fixed positioning cannot be scoped by a scrolling
 * workspace or its chat dock. The server-rendered fallback keeps static markup
 * tests and previews deterministic when no document exists yet.
 */
export function renderViewportSurface(node: ReactNode) {
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

export type ConversationSurfaceKind = "in-app" | "floating";

/**
 * Shared visual seam for the two conversation delivery surfaces.
 *
 * The callers own state, persistence, provider writes, and native-window
 * behavior. This module owns the semantic surface identity and gives the
 * conversation stylesheet one stable root to style across both shells.
 */
export function ConversationSurface({
  surface,
  open = true,
  ariaLabel,
  className,
  style,
  children,
}: {
  surface: ConversationSurfaceKind;
  open?: boolean;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("conversation-surface", `conversation-surface-${surface}`, open && "is-open", className)}
      data-conversation-surface={surface}
      data-conversation-open={open ? "true" : "false"}
      role="region"
      aria-label={ariaLabel}
      style={style}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from "react";
import {
  WORK_OS_VIEW_MODE_FIELD,
  WORK_OS_VIEW_MODE_ROUTE,
  WORK_OS_VIEW_NEXT_FIELD,
  type WorkOsViewMode,
} from "./view-mode";

/**
 * The workspace switch.
 *
 * A plain POST form so the switch works before hydration, never prefetches a
 * cookie mutation, and keeps every switch on one route: the handler validates
 * the administrator, stores the per-device view preference, and redirects to a
 * destination inside that view. Callers own the visual treatment so the same
 * control can sit in a masthead band or a sidebar row.
 */
export default function WorkOsViewModeForm({
  mode,
  next,
  children,
  formClassName,
  buttonClassName,
  title,
  ariaLabel,
}: {
  mode: WorkOsViewMode;
  next: string;
  children: ReactNode;
  formClassName?: string;
  buttonClassName?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <form method="post" action={WORK_OS_VIEW_MODE_ROUTE} className={formClassName}>
      <input type="hidden" name={WORK_OS_VIEW_MODE_FIELD} value={mode} />
      <input type="hidden" name={WORK_OS_VIEW_NEXT_FIELD} value={next} />
      <button type="submit" className={buttonClassName} title={title} aria-label={ariaLabel}>
        {children}
      </button>
    </form>
  );
}

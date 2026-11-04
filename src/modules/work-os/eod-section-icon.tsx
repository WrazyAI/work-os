"use client";

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CornerDownRight,
  Fingerprint,
  List,
  ListChecks,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Timer,
  Video,
  type LucideIcon,
} from "lucide-react";
import { eodSectionIconKind, type EodSectionIconKind } from "./eod-document";

const ICONS: Record<EodSectionIconKind, LucideIcon> = {
  completed: CheckCircle2,
  progress: Timer,
  blocked: AlertTriangle,
  next: CornerDownRight,
  plan: ListChecks,
  evidence: Fingerprint,
  updates: MessageSquareText,
  carried: CalendarClock,
  automation: RefreshCw,
  other: List,
  activity: Activity,
  hourly: Clock3,
  output: Paperclip,
  loom: Video,
};

/** The quiet mark beside a report section label. It is decorative: the text
 * label always carries the meaning. */
export default function EodSectionIcon({
  heading,
  size = 13,
  className,
}: {
  heading: string;
  size?: number;
  className?: string;
}) {
  const kind = eodSectionIconKind(heading);
  if (!kind) return null;
  const Icon = ICONS[kind];
  return <Icon size={size} strokeWidth={1.8} className={className} aria-hidden="true" />;
}

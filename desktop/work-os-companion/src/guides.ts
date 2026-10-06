import {
  Archive,
  Bell,
  CalendarRange,
  Eye,
  FileCheck2,
  Layers,
  ListChecks,
  ListTodo,
  MonitorSmartphone,
  Send,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { GuideView } from "./guideState";

export interface GuideStep {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface GuideDefinition {
  /** Header title, e.g. "How My Day works". */
  title: string;
  /** One sentence under the title: what the page is for. */
  promise: string;
  /** Two or three steps; the modal is small on purpose. */
  steps: GuideStep[];
}

/**
 * The page guides, one per workspace page. Copy is employee-facing, short,
 * and truthful: it describes what the surface does, never scores or promises.
 */
export const PAGE_GUIDES: Record<GuideView, GuideDefinition> = {
  day: {
    title: "How My Day works",
    promise: "Your workday in one place — the plan, the work, and the close-out.",
    steps: [
      {
        icon: Sun,
        title: "Start with a plan",
        body: "Set today's focus, keep or edit the suggestions, and confirm. Nothing is filed until you confirm.",
      },
      {
        icon: ListTodo,
        title: "Work the day",
        body: "Clock in with Worktivity, tick off tasks, and answer check-ins when they arrive.",
      },
      {
        icon: FileCheck2,
        title: "Close it out",
        body: "Draft your end-of-day from what was recorded, review it, then submit.",
      },
    ],
  },
  tasks: {
    title: "How Tasks works",
    promise: "Everything you planned and finished, with its source intact.",
    steps: [
      {
        icon: ListChecks,
        title: "Pick a view",
        body: "My day, Unfinished, Completed, or All — date navigation moves through your plan history.",
      },
      {
        icon: SquarePen,
        title: "Add and change work",
        body: "Add a task in the composer, or open a task to rename, re-date, or move it.",
      },
      {
        icon: Archive,
        title: "Complete or archive",
        body: "Completed work stays as history. Tasks that came from Nifty archive back to Nifty.",
      },
    ],
  },
  review: {
    title: "How EOD Review works",
    promise: "Turn the recorded day into a report your manager can review.",
    steps: [
      {
        icon: Sparkles,
        title: "Draft it",
        body: "Create an end-of-day draft. The assistant may write the narrative from your recorded day.",
      },
      {
        icon: Eye,
        title: "Read the record",
        body: "Outcomes, proposed changes, and evidence stay separate until you accept each one.",
      },
      {
        icon: Send,
        title: "Submit",
        body: "Only what you submit reaches your manager. Draft, pending, approved, and rejected states stay honest.",
      },
    ],
  },
  insights: {
    title: "How Insights works",
    promise: "Your record, read one stream at a time — never a single score.",
    steps: [
      {
        icon: CalendarRange,
        title: "Choose the range",
        body: "Look at today, the last 7 days, or the last 30 days.",
      },
      {
        icon: Layers,
        title: "Read one stream at a time",
        body: "Outcomes, plan reliability, updates, and recorded activity context stay separate.",
      },
      {
        icon: ShieldCheck,
        title: "Keep the labels",
        body: "Activity context is descriptive. It never proves productivity, effort, or completion.",
      },
    ],
  },
  settings: {
    title: "How Settings works",
    promise: "Account, device, and workday choices in one calm place.",
    steps: [
      {
        icon: UserRound,
        title: "Workspace settings",
        body: "Name, photo, schedule, notifications, privacy, and your work profile.",
      },
      {
        icon: MonitorSmartphone,
        title: "This device",
        body: "Start with Windows, hold-to-talk, update checks, and text and mascot size.",
      },
      {
        icon: Bell,
        title: "Workday",
        body: "Scheduled check-ins appear with Otto when due; snooze them from the floating companion.",
      },
    ],
  },
};

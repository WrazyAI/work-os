import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  CalendarRange,
  ClipboardCheck,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  Flag,
  Gauge,
  Images,
  Layers,
  Link2,
  ListChecks,
  ListTodo,
  MessageSquareText,
  MonitorSmartphone,
  Plug,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  Table2,
  UserRound,
  Users,
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
 * The page guides, one per workspace page: the five employee pages and the
 * seven administration sections. Copy is short and truthful — it describes
 * what the surface does, never scores or promises. Every page is filmed (see
 * guideFilms.ts), and the numbered steps are the film's chapters.
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
  admin_overview: {
    title: "How Overview works",
    promise: "The team's day and everything that needs a decision, in one place.",
    steps: [
      {
        icon: Gauge,
        title: "See who is working",
        body: "The roster shows each teammate's attendance state and how fresh their record is.",
      },
      {
        icon: AlertTriangle,
        title: "Clear what needs attention",
        body: "Pending reviews, outstanding EODs, overdue tasks, disputed evidence, and blockers lead the page.",
      },
      {
        icon: Activity,
        title: "Follow the activity",
        body: "Recent updates, recaps, completions, evidence, and submissions stream beside today's counts.",
      },
    ],
  },
  admin_people: {
    title: "How People works",
    promise: "The roster, and each person's recent record in one drawer.",
    steps: [
      {
        icon: Users,
        title: "Find the person",
        body: "The roster lists everyone with their role, schedule, and attendance state.",
      },
      {
        icon: UserRound,
        title: "Open the record",
        body: "The drawer carries mappings, schedule and exceptions, and recent workdays.",
      },
      {
        icon: FileText,
        title: "Read what they filed",
        body: "Reports, updates and recaps, and a seven-day evidence summary stay beside the person.",
      },
    ],
  },
  admin_tasks: {
    title: "How Tasks works",
    promise: "The organization's task record, with bounded filters and the local add flow.",
    steps: [
      {
        icon: Filter,
        title: "Filter the record",
        body: "Narrow by status, assignee, and date; the filters stay bounded to the loaded record.",
      },
      {
        icon: ListChecks,
        title: "Open a task",
        body: "A task opens its own detail with status, assignees, and due date intact.",
      },
      {
        icon: ListTodo,
        title: "Add work for the team",
        body: "The add-task flow writes a local task into the organization record.",
      },
    ],
  },
  admin_review: {
    title: "How EOD Review works",
    promise: "Submitted reports, read as documents, and the decision each one needs.",
    steps: [
      {
        icon: MessageSquareText,
        title: "Work the queue",
        body: "Every submitted end-of-day waits in the queue until it is decided.",
      },
      {
        icon: FileText,
        title: "Read the document",
        body: "The report renders as sections beside its sourced evidence and interval recaps.",
      },
      {
        icon: ClipboardCheck,
        title: "Decide",
        body: "Manager notes and an optional manager version are recorded with the decision.",
      },
    ],
  },
  admin_insights: {
    title: "How Insights works",
    promise: "The written brief, measured ranges, and each person's facts — never a score.",
    steps: [
      {
        icon: Gauge,
        title: "Set the range",
        body: "Fixed ranges compare the selected period with the equal period before it.",
      },
      {
        icon: Sparkles,
        title: "Read the brief and measurements",
        body: "A written brief and a metric strip sit above the daily-record chart.",
      },
      {
        icon: Table2,
        title: "Open a person's facts",
        body: "The per-person table opens a detail drawer; activity stays context, never a productivity score.",
      },
    ],
  },
  admin_evidence: {
    title: "How Evidence works",
    promise: "The organization's record, its integrations, and when a frame may be opened.",
    steps: [
      {
        icon: Images,
        title: "Filter the record",
        body: "Filter by date, person, source, and disputed state; rows group by day.",
      },
      {
        icon: Plug,
        title: "Check the integrations",
        body: "Provider cards, unmapped account queues, and repositories show where rows come from.",
      },
      {
        icon: Flag,
        title: "Open a flagged frame",
        body: "Screenshot access is limited to flagged or disputed items, with a recorded reason and an audit entry.",
      },
    ],
  },
  admin_settings: {
    title: "How Settings works",
    promise: "Features, members, teams, and connections, one decision area at a time.",
    steps: [
      {
        icon: SlidersHorizontal,
        title: "Features and status",
        body: "System status and feature switches live at the top of the workspace settings.",
      },
      {
        icon: Users,
        title: "Members and teams",
        body: "Memberships, roles, and teams group people for the record and assignments.",
      },
      {
        icon: Link2,
        title: "Provider connections",
        body: "Connections, field mappings, and blueprints decide what flows into the workspace.",
      },
    ],
  },
};

/** Public lessons. Films use the real desktop app with demonstration data;
 * their durations, captions and steps describe the verified recording. */
export type TutorialStatus = "published" | "in-production";

export interface Tutorial {
  slug: string;
  title: string;
  summary: string;
  status: TutorialStatus;
  duration: number | null;
  poster: string | null;
  video: string | null;
  captions: string | null;
  steps: readonly string[];
  platformNote: string;
}

const BASE = "/site/work-os/tutorials";

export const TUTORIALS: readonly Tutorial[] = [
  {
    slug: "getting-set-up", title: "Get set up with your companion",
    summary: "Walk through your profile, work scope, schedule and privacy choices.",
    status: "published", duration: 54.517,
    poster: `${BASE}/getting-set-up.jpg`, video: `${BASE}/getting-set-up.mp4`, captions: `${BASE}/getting-set-up.vtt`,
    steps: [
      "Open the installed companion, choose Connect workspace, and sign in through the browser. The film starts after this connection.",
      "Choose Start setup and check your imported name and work email.",
      "Choose your work scope and review the responsibilities, outputs and evidence signals.",
      "Confirm your timezone, working days and schedule.",
      "Read the screenshot-analysis and retention policy before accepting it.",
      "Choose Connect Work OS, then Enter My Day when setup is complete.",
    ],
    platformNote: "Windows and macOS share the setup flow. The film uses a local demonstration account.",
  },
  {
    slug: "plan-your-day", title: "Plan your day",
    summary: "Write a focus, build a draft, review the commitments and confirm your plan.",
    status: "published", duration: 37.084,
    poster: `${BASE}/plan-your-day.jpg`, video: `${BASE}/plan-your-day.mp4`, captions: `${BASE}/plan-your-day.vtt`,
    steps: [
      "Start in My Day and press your focus line to open Plan your day.",
      "Describe the work in your own words, then choose Build my plan.",
      "Read the drafted goal and commitments before choosing Confirm my day.",
      "The plan confirmation records your decision. Planning does not start attendance.",
    ],
    platformNote: "Planning is available in the companion and the web workspace.",
  },
  {
    slug: "tasks", title: "Add and complete work",
    summary: "Create a task with context, find it with search and record completion.",
    status: "published", duration: 49.55,
    poster: `${BASE}/tasks.jpg`, video: `${BASE}/tasks.mp4`, captions: `${BASE}/tasks.vtt`,
    steps: [
      "Choose Tasks from the desktop sidebar, then Add task.",
      "Give the task a clear outcome and a description of what done means.",
      "Choose Create task, then use Search tasks to find the new work.",
      "Use the completion checkbox only after the work is finished.",
      "Clear the search to return to your remaining tasks.",
    ],
    platformNote: "Tasks stay in the workspace record, not in a provider.",
  },
  {
    slug: "activity-recaps", title: "Review your activity",
    summary: "Open a recap, inspect its notes and sources, then confirm your review.",
    status: "published", duration: 50.417,
    poster: `${BASE}/activity-recaps.jpg`, video: `${BASE}/activity-recaps.mp4`, captions: `${BASE}/activity-recaps.vtt`,
    steps: [
      "Choose View more on the floating recap bubble.",
      "Read the interval headline, activity bullets and observed flow.",
      "Open Extra notes for uncertainty, then the evidence-count button for screenshots and GitHub events.",
      "Close the evidence and choose Looks good only when the recap is accurate. Use Edit instead when it needs a correction.",
      "Any next-step suggestions remain separate decisions; confirming a recap does not complete tasks.",
    ],
    platformNote: "Activity is context, never a productivity score or proof of completion. Unavailable images are labelled honestly.",
  },
  {
    slug: "clock-in-out", title: "Clock in, pause, and clock out",
    summary: "Start a shift, acknowledge a late start, pause, resume and confirm clock-out.",
    status: "published", duration: 40.384,
    poster: `${BASE}/clock-in-out.jpg`, video: `${BASE}/clock-in-out.mp4`, captions: `${BASE}/clock-in-out.vtt`,
    steps: [
      "Read the schedule on My Day and choose Clock in in the Windows companion.",
      "If a late-start confirmation appears, add a reason and choose Confirm clock-in.",
      "Use Pause and Resume when taking a break; wait for Worktivity to confirm each change.",
      "Choose Clock out and confirm the dialog when the shift ends.",
    ],
    platformNote: "Windows uses the companion. On macOS, use Worktivity’s Mac app. The film simulates provider state locally; it contacts no provider.",
  },
  {
    slug: "eod-draft", title: "Draft an EOD report",
    summary: "Build from the recorded day, inspect the draft source and return to Preview.",
    status: "published", duration: 34.684,
    poster: `${BASE}/eod-draft.jpg`, video: `${BASE}/eod-draft.mp4`, captions: `${BASE}/eod-draft.vtt`,
    steps: [
      "Start in My Day and choose EOD Review from the sidebar.",
      "Use Rebuild from record to refresh the draft from your recorded day.",
      "Read the goal and carried work. Raw opens the source text; Preview returns to the readable document.",
      "Correct anything inaccurate before submission. This film leaves the draft unsubmitted.",
    ],
    platformNote: "Drafting and submitting are separate decisions. Demonstration data never reaches an employee account.",
  },
  {
    slug: "eod-submit", title: "Submit your EOD report",
    summary: "Check the brief and full record, then submit only after your review.",
    status: "published", duration: 30.517,
    poster: `${BASE}/eod-submit.jpg`, video: `${BASE}/eod-submit.mp4`, captions: `${BASE}/eod-submit.vtt`,
    steps: [
      "Open EOD Review from My Day.",
      "Open Full record to read the detail behind the brief, then return to the summary.",
      "Choose Submit EOD only when the report accurately represents your day.",
      "The submitted screen confirms the result. In the connected app, your manager receives the report.",
    ],
    platformNote: "The film submits only inside the offline demonstration. It does not change a live account.",
  },
  {
    slug: "insights", title: "Read your insights",
    summary: "Compare Today, 7d and 30d, explore the lower sections and inspect exact daily values.",
    status: "published", duration: 47.517,
    poster: `${BASE}/insights.jpg`, video: `${BASE}/insights.mp4`, captions: `${BASE}/insights.vtt`,
    steps: [
      "Choose Insights from the desktop sidebar.",
      "Choose Today, then 7d, then 30d to see the totals and chart recalculate for each range.",
      "Scroll to plan reliability, record mix and work rhythm.",
      "Continue to evidence, observed-app context and recorded updates. These describe different evidence classes, not a productivity score.",
      "Open View daily breakdown for exact values and linked records.",
    ],
    platformNote: "Charts are a descriptive record, not a performance score.",
  },
  {
    slug: "settings", title: "Make Work OS yours",
    summary: "Review your profile, scroll to display preferences and try text and mascot sizes.",
    status: "published", duration: 40.15,
    poster: `${BASE}/settings.jpg`, video: `${BASE}/settings.mp4`, captions: `${BASE}/settings.vtt`,
    steps: [
      "Open Settings from the sidebar footer, then Open profile settings.",
      "Review your profile and close it without saving unwanted changes.",
      "Scroll to Reading & display and choose Medium to enlarge text by 15%.",
      "Try Small and Large for the mascot, then keep the display sizes you prefer.",
    ],
    platformNote: "Appearance preferences apply immediately and stay on this device.",
  },
  {
    slug: "companion-chat", title: "Use the floating companion",
    summary: "Open and collapse the mascot, expand a task card and select work for review.",
    status: "published", duration: 43.95,
    poster: `${BASE}/companion-chat.jpg`, video: `${BASE}/companion-chat.mp4`, captions: `${BASE}/companion-chat.vtt`,
    steps: [
      "Collapse companion returns to the mascot without signing out. Click the mascot to reopen the conversation.",
      "Expand or collapse the Pending tasks card to read its task list.",
      "Select a task, then choose Mark selected done to review the proposed action.",
      "Review is separate from confirmation. The film leaves the proposed change unconfirmed.",
      "Collapse the companion when you return to your other work.",
    ],
    platformNote: "The floating window is part of the desktop app, not the browser workspace.",
  },
] as const;

export function tutorialBySlug(slug: string): Tutorial | null {
  return TUTORIALS.find((tutorial) => tutorial.slug === slug) ?? null;
}

export function publishedTutorials(): Tutorial[] {
  return TUTORIALS.filter((tutorial) => tutorial.status === "published");
}

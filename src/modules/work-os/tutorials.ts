/** One source for the public tutorial library. Every published film names its
 * own poster, captions and written steps; unpublished lessons carry no media so
 * the site can never advertise a video that does not exist. */

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
    slug: "getting-set-up",
    title: "Connect and get set up",
    summary: "Sign in, connect the desktop app, and finish onboarding.",
    status: "published",
    duration: 9.2,
    poster: `${BASE}/getting-set-up.jpg`,
    video: `${BASE}/getting-set-up.mp4`,
    captions: `${BASE}/getting-set-up.vtt`,
    steps: [
      "Open the companion and choose Connect workspace.",
      "Sign in through the browser and pick your workspace.",
      "Finish the setup steps, then enter My Day.",
    ],
    platformNote: "Windows and macOS share the same browser sign-in.",
  },
  {
    slug: "plan-your-day",
    title: "Plan your day",
    summary: "Set a focus and build a reviewable plan.",
    status: "published",
    duration: 9.2,
    poster: `${BASE}/plan-your-day.jpg`,
    video: `${BASE}/plan-your-day.mp4`,
    captions: `${BASE}/plan-your-day.vtt`,
    steps: [
      "Open My Day and choose Plan your day.",
      "Describe what you are working on.",
      "Review the drafted commitments and confirm the plan.",
    ],
    platformNote: "Planning is available in the companion and the web workspace.",
  },
  {
    slug: "tasks",
    title: "Add and complete work",
    summary: "Add a task, complete it, and find it again.",
    status: "published",
    duration: 11.884,
    poster: `${BASE}/tasks.jpg`,
    video: `${BASE}/tasks.mp4`,
    captions: `${BASE}/tasks.vtt`,
    steps: [
      "Open Tasks in the desktop sidebar.",
      "Choose Add task and give it a name.",
      "Add a description, due date and priority.",
      "Save the task, then use the checkbox when it is done.",
    ],
    platformNote: "Tasks stay in the workspace record, not in a provider.",
  },
  {
    slug: "activity-recaps",
    title: "Review your activity",
    summary: "Read an interval recap, then confirm or correct it.",
    status: "published",
    duration: 9.2,
    poster: `${BASE}/activity-recaps.jpg`,
    video: `${BASE}/activity-recaps.mp4`,
    captions: `${BASE}/activity-recaps.vtt`,
    steps: [
      "Open a recap from the recent activity stream.",
      "Read the activity bullets and open the evidence if you need it.",
      "Choose Looks right, or add a correction.",
    ],
    platformNote: "Activity is context, never a productivity score or proof of completion.",
  },
  {
    slug: "clock-in-out",
    title: "Clock in, pause, and clock out",
    summary: "Use Worktivity-confirmed attendance from the companion.",
    status: "published",
    duration: 9.2,
    poster: `${BASE}/clock-in-out.jpg`,
    video: `${BASE}/clock-in-out.mp4`,
    captions: `${BASE}/clock-in-out.vtt`,
    steps: [
      "Open the companion dashboard and choose Clock in.",
      "Use Pause and Resume when you take a break.",
      "Choose Clock out when the shift ends and confirm the state.",
    ],
    platformNote: "Windows uses the Work OS companion. macOS uses Worktivity's Mac app; the browser is status-only.",
  },
  {
    slug: "eod-draft",
    title: "Draft an EOD report",
    summary: "Start on My Day, open EOD Review, and draft from the record.",
    status: "published",
    duration: 25.284,
    poster: `${BASE}/eod-draft.jpg`,
    video: `${BASE}/eod-draft.mp4`,
    captions: `${BASE}/eod-draft.vtt`,
    steps: [
      "Start in My Day, the same dashboard you use during the day.",
      "Choose EOD Review in the desktop sidebar.",
      "Choose Draft with AI to build a version from the record.",
      "Read the summary, completed work and carried items.",
      "Open Raw to make a direct correction, then return to Preview.",
      "Choose Submit EOD only when the report is accurate. This film leaves it unsubmitted.",
    ],
    platformNote: "The approved desktop pilot. 60 fps, original instrumental, captions and transcript.",
  },
  {
    slug: "eod-submit",
    title: "Submit your EOD report",
    summary: "Review what you are sending and submit it.",
    status: "published",
    duration: 16.2,
    poster: `${BASE}/eod-submit.jpg`,
    video: `${BASE}/eod-submit.mp4`,
    captions: `${BASE}/eod-submit.vtt`,
    steps: [
      "Start in My Day and choose EOD Review in the sidebar.",
      "Read the final report, including completed and carried work.",
      "Choose Submit EOD only when the report is accurate.",
      "The submitted state confirms the report is with your manager.",
    ],
    platformNote: "Submission is a separate decision from drafting.",
  },
  {
    slug: "insights",
    title: "Read your insights",
    summary: "Choose a range and read the recorded work.",
    status: "published",
    duration: 11.884,
    poster: `${BASE}/insights.jpg`,
    video: `${BASE}/insights.mp4`,
    captions: `${BASE}/insights.vtt`,
    steps: [
      "Open Insights and choose a range.",
      "Read the measured outcomes across the range.",
      "Open the daily record for the exact values behind a chart.",
    ],
    platformNote: "Charts are a record, not a score.",
  },
  {
    slug: "settings",
    title: "Make Work OS yours",
    summary: "Find your profile, display and workday settings.",
    status: "published",
    duration: 10.267,
    poster: `${BASE}/settings.jpg`,
    video: `${BASE}/settings.mp4`,
    captions: `${BASE}/settings.vtt`,
    steps: [
      "Open Settings from the sidebar footer.",
      "Find your profile, this device, workday and guides.",
      "Adjust reading and display preferences for this device.",
    ],
    platformNote: "Appearance preferences stay on this device.",
  },
  {
    slug: "companion-chat",
    title: "Use the floating companion",
    summary: "Send an update and review a recap with Otto.",
    status: "published",
    duration: 9.2,
    poster: `${BASE}/companion-chat.jpg`,
    video: `${BASE}/companion-chat.mp4`,
    captions: `${BASE}/companion-chat.vtt`,
    steps: [
      "Open the floating companion from the desktop.",
      "Send a progress update in your own words.",
      "Review a recap and confirm or correct it.",
    ],
    platformNote: "The floating companion is part of the desktop app, not the browser workspace.",
  },
] as const;

export function tutorialBySlug(slug: string): Tutorial | null {
  return TUTORIALS.find((tutorial) => tutorial.slug === slug) ?? null;
}

export function publishedTutorials(): Tutorial[] {
  return TUTORIALS.filter((tutorial) => tutorial.status === "published");
}

import type { GuideView } from "./guideState";

export interface GuideFilm {
  /** Video path, relative to the app's public root. */
  file: string;
  /** First-frame still, shown before playback and under reduced motion. */
  poster: string;
  /** Short label for the step this clip illustrates. */
  chapter: string;
  /** Exact encoded length in seconds. */
  seconds: number;
}

export const GUIDE_FILMS: Record<GuideView, GuideFilm[]> = {
  day: [
    { file: "guides/day-1.mp4", poster: "guides/day-1.jpg", chapter: "Start with a plan", seconds: 7.23 },
    { file: "guides/day-2.mp4", poster: "guides/day-2.jpg", chapter: "Work the day", seconds: 6.03 },
    { file: "guides/day-3.mp4", poster: "guides/day-3.jpg", chapter: "Close it out", seconds: 5.87 },
  ],
  tasks: [
    { file: "guides/tasks-1.mp4", poster: "guides/tasks-1.jpg", chapter: "Pick a view", seconds: 5.37 },
    { file: "guides/tasks-2.mp4", poster: "guides/tasks-2.jpg", chapter: "Add and change work", seconds: 3.93 },
    { file: "guides/tasks-3.mp4", poster: "guides/tasks-3.jpg", chapter: "Complete or archive", seconds: 4.47 },
  ],
  review: [
    { file: "guides/review-1.mp4", poster: "guides/review-1.jpg", chapter: "Draft it", seconds: 5.03 },
    { file: "guides/review-2.mp4", poster: "guides/review-2.jpg", chapter: "Read the record", seconds: 5.03 },
    { file: "guides/review-3.mp4", poster: "guides/review-3.jpg", chapter: "Submit", seconds: 3.97 },
  ],
  insights: [
    { file: "guides/insights-1.mp4", poster: "guides/insights-1.jpg", chapter: "Choose the range", seconds: 5.63 },
    { file: "guides/insights-2.mp4", poster: "guides/insights-2.jpg", chapter: "Read one stream at a time", seconds: 4.07 },
    { file: "guides/insights-3.mp4", poster: "guides/insights-3.jpg", chapter: "Keep the labels", seconds: 5.1 },
  ],
  settings: [
    { file: "guides/settings-1.mp4", poster: "guides/settings-1.jpg", chapter: "Workspace settings", seconds: 6.13 },
    { file: "guides/settings-2.mp4", poster: "guides/settings-2.jpg", chapter: "This device", seconds: 4.23 },
    { file: "guides/settings-3.mp4", poster: "guides/settings-3.jpg", chapter: "Workday", seconds: 4.6 },
  ],
  admin_overview: [
    { file: "guides/admin_overview-1.mp4", poster: "guides/admin_overview-1.jpg", chapter: "See who is working", seconds: 6.37 },
    { file: "guides/admin_overview-2.mp4", poster: "guides/admin_overview-2.jpg", chapter: "Clear what needs attention", seconds: 3.6 },
    { file: "guides/admin_overview-3.mp4", poster: "guides/admin_overview-3.jpg", chapter: "Follow the activity", seconds: 5.67 },
  ],
  admin_people: [
    { file: "guides/admin_people-1.mp4", poster: "guides/admin_people-1.jpg", chapter: "Find the person", seconds: 4.3 },
    { file: "guides/admin_people-2.mp4", poster: "guides/admin_people-2.jpg", chapter: "Open the record", seconds: 4.5 },
    { file: "guides/admin_people-3.mp4", poster: "guides/admin_people-3.jpg", chapter: "Read what they filed", seconds: 5.03 },
  ],
  admin_tasks: [
    { file: "guides/admin_tasks-1.mp4", poster: "guides/admin_tasks-1.jpg", chapter: "Filter the record", seconds: 4.57 },
    { file: "guides/admin_tasks-2.mp4", poster: "guides/admin_tasks-2.jpg", chapter: "Open a task", seconds: 4.5 },
    { file: "guides/admin_tasks-3.mp4", poster: "guides/admin_tasks-3.jpg", chapter: "Add work for the team", seconds: 4.4 },
  ],
  admin_review: [
    { file: "guides/admin_review-1.mp4", poster: "guides/admin_review-1.jpg", chapter: "Work the queue", seconds: 3.53 },
    { file: "guides/admin_review-2.mp4", poster: "guides/admin_review-2.jpg", chapter: "Read the document", seconds: 4.67 },
    { file: "guides/admin_review-3.mp4", poster: "guides/admin_review-3.jpg", chapter: "Decide", seconds: 3.6 },
  ],
  admin_insights: [
    { file: "guides/admin_insights-1.mp4", poster: "guides/admin_insights-1.jpg", chapter: "Set the range", seconds: 5.7 },
    { file: "guides/admin_insights-2.mp4", poster: "guides/admin_insights-2.jpg", chapter: "Read the brief and measurements", seconds: 4.57 },
    { file: "guides/admin_insights-3.mp4", poster: "guides/admin_insights-3.jpg", chapter: "Open a person's facts", seconds: 5.63 },
  ],
  admin_evidence: [
    { file: "guides/admin_evidence-1.mp4", poster: "guides/admin_evidence-1.jpg", chapter: "Filter the record", seconds: 4.73 },
    { file: "guides/admin_evidence-2.mp4", poster: "guides/admin_evidence-2.jpg", chapter: "Check the integrations", seconds: 3.67 },
    { file: "guides/admin_evidence-3.mp4", poster: "guides/admin_evidence-3.jpg", chapter: "Open a flagged frame", seconds: 3.47 },
  ],
  admin_settings: [
    { file: "guides/admin_settings-1.mp4", poster: "guides/admin_settings-1.jpg", chapter: "Your settings first", seconds: 3.97 },
    { file: "guides/admin_settings-2.mp4", poster: "guides/admin_settings-2.jpg", chapter: "Features and status", seconds: 4.03 },
    { file: "guides/admin_settings-3.mp4", poster: "guides/admin_settings-3.jpg", chapter: "Members, teams, and connections", seconds: 5.87 },
  ],
};

/** The clips a guide plays, one per numbered step. */
export function guideFilmsFor(view: GuideView): GuideFilm[] {
  return GUIDE_FILMS[view] ?? [];
}

/*
 * Generated by scripts/shoot-guide-films.mjs — do not edit by hand.
 *
 * One clip per numbered step of each page guide, filmed from the real
 * companion and encoded into `public/guides`. Durations come from the encoded
 * files and chapter labels from the shot list, so this cannot drift from the
 * film.
 */
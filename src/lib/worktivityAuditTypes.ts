// Pure type definitions for the Worktivity audit — NO runtime imports, so client
// components can import these without dragging the server engine (and its Node
// built-ins) into the browser bundle.

export interface AuditWindow {
  employeeId: string; // Worktivity Employee.ID (NOT UserId — see worktivity.ts filtering note)
  start: string;      // YYYY-MM-DD inclusive
  end: string;        // YYYY-MM-DD inclusive
}

export interface WorkSession {
  app: string;
  startIso: string;
  endIso: string;
  minutes: number;
  logCount: number;
  screenshots: number;
  avgActivity: number;         // normalized 0–100 percentage
  productivity: number | null; // dominant enum for the session
  representativeLogId: string; // the frame Layer 2 would vision-check
}

// ── Layer 2: sampled vision ──
// meeting = video call/screen-share (counts as work); suspicious = likely activity
// manipulation (sustained max activity on a static screen) — NOT paid.
export type VisionCategory = "work" | "meeting" | "idle" | "nonwork" | "unclear" | "suspicious" | "no-visual";

export interface VisionVerdict {
  idx: number;              // index into rollup.sessions
  app: string;             // what the model saw on screen
  start: string;           // "YYYY-MM-DD HH:MM"
  minutes: number;
  avgActivity: number;
  category: VisionCategory;
  confidence: number;      // 0–1
  reason: string;
  screenshot: string | null; // pre-signed URL (expires ~24h) — re-fetch on demand later
  time: string;            // frame timestamp
  flagged: boolean;
  review?: "confirmed" | "dismissed"; // human decision in the flag queue
}

export interface VisionResult {
  model: string;
  generatedAt: string;
  framesAnalyzed: number;
  sessionsTotal: number;
  totals: { workMinutes: number; meetingMinutes: number; idleMinutes: number; nonworkMinutes: number; unclearMinutes: number; suspiciousMinutes: number; noVisualMinutes: number; flaggedCount: number };
  days?: { date: string; frames: number; flagged: number; suspicious: number; staticCandidates?: number; staticConfirmed?: number; staticRejected?: number; fingerprintFailures?: number }[];
  staticDetection?: {
    framesAttempted: number;
    framesFingerprinted: number;
    fingerprintFailures: number;
    candidates: number;
    confirmed: number;
    rejected: number;
    exactRuns: number;
    sameActivityExactRuns: number;
    idleMinutes: number;
  };
  recommendedPayableMinutes: number;
  verdicts: VisionVerdict[];
}

export interface WorktivityRollup {
  employeeId: string;
  range: { start: string; end: string };
  generatedAt: string;
  cadenceMinutes: number;
  totals: {
    logs: number;
    screenshots: number;
    trackedMinutes: number;
    activeMinutes: number;
    idleMinutes: number;   // excludes break time
    breakMinutes: number;  // Status=OnBreak — NOT idle
    avgActivity: number;
    activeDays: number;
  };
  productivitySplit: { label: string; enum: number | null; minutes: number; pct: number }[];
  topApps: { app: string; minutes: number; pct: number; avgActivity: number; category?: string | null; icon?: string | null }[];
  deadStretches: { startIso: string; endIso: string; minutes: number }[];
  sessions: WorkSession[];
  perDay: { date: string; trackedMinutes: number; avgActivity: number; sessions: number }[];
}

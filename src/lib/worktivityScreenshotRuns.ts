import { createHash } from "node:crypto";
import sharp from "sharp";

// Worktivity ActivityLogs use active seconds in a one-minute capture (0–60),
// while the product UI and audit reports express activity as a percentage.
export const WORKTIVITY_ACTIVITY_MAX = 60;
export const STATIC_RUN_MINUTES = 3;
export const STATIC_HASH_DISTANCE = 3;

export function normalizeActivityLevel(raw: number | null | undefined): number {
  const value = Number.isFinite(raw) ? Number(raw) : 0;
  return Math.round(Math.max(0, Math.min(WORKTIVITY_ACTIVITY_MAX, value)) / WORKTIVITY_ACTIVITY_MAX * 100);
}

export interface ScreenshotFingerprint {
  exactHash: string;
  perceptualHash: string;
}

/** A deterministic 64-bit difference hash plus an exact content hash. */
export async function fingerprintScreenshot(bytes: Uint8Array): Promise<ScreenshotFingerprint> {
  const input = Buffer.from(bytes);
  const pixels = await sharp(input, { limitInputPixels: 25_000_000 })
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();
  let perceptualHash = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      perceptualHash += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? "1" : "0";
    }
  }
  return { exactHash: createHash("sha256").update(input).digest("hex"), perceptualHash };
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distance++;
  return distance;
}

export interface FingerprintedWorktivityFrame extends ScreenshotFingerprint {
  employeeId: string;
  logId: string;
  timestamp: string;
  screenshot: string;
  rawActivity: number;
  app: string;
}

export interface StaticScreenshotRun {
  frames: FingerprintedWorktivityFrame[];
  startMs: number;
  endMs: number;
  observedMinutes: number;
  exact: boolean;
  sameActivity: boolean;
  maxHashDistance: number;
}

export interface StaticRunDetection {
  confirmed: StaticScreenshotRun[];
  rejected: StaticScreenshotRun[];
}

export function staticRunFrameSlices(run: StaticScreenshotRun, cadenceMinutes: number) {
  return run.frames.map((frame, index) => {
    const next = run.frames[index + 1];
    const minutes = next
      ? Math.max(1, Math.round((new Date(next.timestamp).getTime() - new Date(frame.timestamp).getTime()) / 60_000))
      : Math.max(1, cadenceMinutes);
    return { frame, minutes };
  });
}

function asRun(frames: FingerprintedWorktivityFrame[], maxHashDistance: number): StaticScreenshotRun {
  const startMs = new Date(frames[0].timestamp).getTime();
  const endMs = new Date(frames[frames.length - 1].timestamp).getTime();
  return {
    frames,
    startMs,
    endMs,
    observedMinutes: (endMs - startMs) / 60_000,
    exact: frames.every((frame) => frame.exactHash === frames[0].exactHash),
    sameActivity: frames.every((frame) => frame.rawActivity === frames[0].rawActivity),
    maxHashDistance,
  };
}

/**
 * Finds consecutive static screenshots independently of activity level.
 * Frames must remain close to both the preceding frame and the run's anchor so
 * small changes cannot accumulate into a false-positive through hash drift.
 */
export function detectStaticScreenshotRuns(
  input: FingerprintedWorktivityFrame[],
  opts: { maxGapMinutes?: number; maxHashDistance?: number; minObservedMinutes?: number } = {},
): StaticRunDetection {
  const maxGapMinutes = opts.maxGapMinutes ?? 3;
  const maxDistance = opts.maxHashDistance ?? STATIC_HASH_DISTANCE;
  const minObservedMinutes = opts.minObservedMinutes ?? STATIC_RUN_MINUTES;
  const confirmed: StaticScreenshotRun[] = [];
  const rejected: StaticScreenshotRun[] = [];

  const byEmployee = new Map<string, FingerprintedWorktivityFrame[]>();
  for (const frame of input) {
    if (!Number.isFinite(new Date(frame.timestamp).getTime())) continue;
    (byEmployee.get(frame.employeeId) ?? byEmployee.set(frame.employeeId, []).get(frame.employeeId)!).push(frame);
  }

  for (const frames of byEmployee.values()) {
    frames.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let current: FingerprintedWorktivityFrame[] = [];
    let runMaxDistance = 0;
    const flush = () => {
      if (current.length >= 2) {
        const run = asRun(current, runMaxDistance);
        // The policy says MORE than three consecutive minutes, not >= three.
        (run.observedMinutes > minObservedMinutes ? confirmed : rejected).push(run);
      }
      current = [];
      runMaxDistance = 0;
    };

    for (const frame of frames) {
      if (!current.length) { current = [frame]; continue; }
      const previous = current[current.length - 1];
      const anchor = current[0];
      const gapMinutes = (new Date(frame.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 60_000;
      const adjacentDistance = hammingDistance(previous.perceptualHash, frame.perceptualHash);
      const anchorDistance = hammingDistance(anchor.perceptualHash, frame.perceptualHash);
      if (gapMinutes > 0 && gapMinutes <= maxGapMinutes && adjacentDistance <= maxDistance && anchorDistance <= maxDistance) {
        current.push(frame);
        runMaxDistance = Math.max(runMaxDistance, adjacentDistance, anchorDistance);
      } else {
        flush();
        current = [frame];
      }
    }
    flush();
  }

  return { confirmed, rejected };
}

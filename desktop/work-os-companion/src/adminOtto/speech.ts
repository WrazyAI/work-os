import type { OttoScope, SpeechLine } from "../../../../src/modules/work-os/admin-otto/contracts";
import { speakAdminOttoRecap } from "./api";

export type AdminSpeechClip = {
  bytes: ArrayBuffer;
  mimeType: string;
  voice: string;
  lines: SpeechLine[];
  reviewKey: string;
  scriptHash: string;
};

export type AdminSpeechSpeak = (
  input: { intervalId: string; reviewKey: string; voice?: string },
  signal?: AbortSignal,
) => Promise<AdminSpeechClip>;

export type AdminSpeechFetch = (input: {
  intervalId: string;
  revision?: number | null;
  reviewKey?: string | null;
  voice: string;
}) => Promise<{
  bytes: ArrayBuffer;
  mimeType: string;
  lines: SpeechLine[];
  revision: null;
  reviewKey: string | null;
  stale: boolean;
}>;

/**
 * The administration speech source.
 *
 * The server-issued `reviewKey` is not the numeric generation revision: it
 * binds the organization, interval, review version and script hash, so a clip
 * can never be synthesized for a recap the administrator is no longer looking
 * at. Only an admin-mode scope reaches the admin route; a late provider answer
 * after a scope/epoch change is thrown away before the player can start it.
 */
export function createAdminSpeechFetcher(deps: {
  scope: OttoScope;
  epoch: number;
  isCurrent: () => boolean;
  speak?: AdminSpeechSpeak;
}): AdminSpeechFetch {
  const speak = deps.speak ?? speakAdminOttoRecap;
  return async (input) => {
    if (deps.scope.mode !== "admin") {
      throw new Error("Admin speech is only available in the administration workspace.");
    }
    if (!deps.isCurrent()) {
      throw new Error("That recap is not available in this administration context.");
    }
    const reviewKey = typeof input.reviewKey === "string" ? input.reviewKey.trim() : "";
    if (!reviewKey) throw new Error("That reviewed recap is not available.");
    const clip = await speak({
      intervalId: input.intervalId,
      reviewKey,
      voice: input.voice,
    });
    if (!deps.isCurrent() || deps.scope.mode !== "admin") {
      throw new Error("That recap changed or is no longer available.");
    }
    if (clip.reviewKey !== reviewKey) {
      throw new Error("This recap changed. Refresh it before listening.");
    }
    return {
      bytes: clip.bytes,
      mimeType: clip.mimeType,
      lines: clip.lines,
      revision: null,
      reviewKey: clip.reviewKey,
      stale: false,
    };
  };
}

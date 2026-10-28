import type { ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import type { RecapSpeechSnapshot } from "../recapSpeechPlayer";

/**
 * The one transition that marks a delivery listened: the player's own
 * `finished` snapshot for the same recap, carrying the reviewed key the clip
 * actually spoke. Loading, cancelling, stopping or a scope change never
 * produce it, so a stopped read cannot be acknowledged as heard.
 */
export function adminListenedKey(
  snapshot: RecapSpeechSnapshot,
  recap: ReviewedRecap | null,
): string | null {
  if (!recap || snapshot.status !== "finished") return null;
  if (snapshot.intervalId !== recap.intervalId) return null;
  if (!snapshot.reviewKey) return null;
  return `${recap.eventId}:${snapshot.reviewKey}`;
}

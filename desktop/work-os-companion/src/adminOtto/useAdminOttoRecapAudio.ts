import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OttoScope, ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { AdminOttoSpeechChangedError, updateAdminOttoDelivery } from "./api";
import { requestOttoAudio, requestOttoAudioStop, onOttoSpeechStop, type OttoAudioLease } from "./audioOwner";
import { createAdminSpeechFetcher } from "./speech";
import type { AdminSpeechSpeak } from "./speech";
import { adminListenedKey } from "./listened";
import { browserRecapAudio, createRecapSpeechPlayer, IDLE_RECAP_SPEECH, type RecapSpeechPlayer, type RecapSpeechSnapshot } from "../recapSpeechPlayer";
import type { AdminRecapPlayback } from "./AdminRecapView";

/**
 * The administration conversation's speaker.
 *
 * Speech starts only from an explicit Listen, holds one cross-window audio
 * lease, uses the selected listener voice, and marks a delivery listened only
 * when the audio's own `ended` event publishes `finished`. Stop/cancel never
 * advances that state. A `review_changed` answer refreshes the visible recap
 * and stays idle until the administrator presses Listen again.
 */
export function useAdminOttoRecapAudio(input: {
  scope: OttoScope | null;
  epoch: number;
  voice: string;
  enabled: boolean;
  onBeforeSpeech?: () => void;
  /** Local fixture seams; production leaves both absent. */
  speak?: AdminSpeechSpeak;
  onListened?: (eventId: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<RecapSpeechSnapshot>(IDLE_RECAP_SPEECH);
  const [error, setError] = useState<string | null>(null);
  const [recapUpdates, setRecapUpdates] = useState<Record<string, ReviewedRecap>>({});
  const playerRef = useRef<RecapSpeechPlayer | null>(null);
  const leaseRef = useRef<OttoAudioLease | null>(null);
  const currentRecap = useRef<ReviewedRecap | null>(null);
  const listened = useRef<Set<string>>(new Set());
  const inputRef = useRef(input);
  // Update before paint: a callback from the old scope is fenced before the
  // browser can deliver the next user event, without touching a ref in render.
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const releaseLease = useCallback(() => {
    leaseRef.current?.release();
    leaseRef.current = null;
  }, []);

  /* A new actor/org/mode/epoch is a hard boundary: old recap text, errors,
   * updates and listened keys cannot survive into the new scope. */
  useEffect(() => {
    releaseLease();
    currentRecap.current = null;
    listened.current.clear();
    setSnapshot(IDLE_RECAP_SPEECH);
    setError(null);
    setRecapUpdates({});
  }, [input.scope?.userId, input.scope?.organizationId, input.scope?.mode, input.epoch, releaseLease]);

  const stop = useCallback(() => {
    playerRef.current?.stop();
    releaseLease();
    currentRecap.current = null;
    setError(null);
  }, [releaseLease]);

  useEffect(() => onOttoSpeechStop(() => {
    playerRef.current?.stop();
    releaseLease();
  }), [releaseLease]);

  useEffect(() => {
    const scope = input.scope;
    if (!scope || scope.mode !== "admin" || !input.enabled) {
      playerRef.current?.dispose();
      playerRef.current = null;
      releaseLease();
      return;
    }
    const epoch = input.epoch;
    const activeScope = { ...scope };
    const isCurrent = () => {
      const current = inputRef.current;
      return current.epoch === epoch
        && current.scope?.userId === activeScope.userId
        && current.scope?.organizationId === activeScope.organizationId
        && current.scope?.mode === "admin";
    };
    const player = createRecapSpeechPlayer({
      fetchClip: createAdminSpeechFetcher({
        scope: activeScope,
        epoch,
        speak: inputRef.current.speak,
        isCurrent,
      }),
      createAudio: browserRecapAudio,
      isPlaybackAllowed: () => !!leaseRef.current?.isActive() && isCurrent(),
      onSnapshot: (next) => {
        // A callback from an old actor/org/mode/epoch cannot update words,
        // persist "listened", or release the new scope's lease.
        if (!isCurrent()) return;
        setSnapshot(next);
        if (next.status === "finished") {
          const recap = currentRecap.current;
          const key = adminListenedKey(next, recap);
          if (key && recap && !listened.current.has(key)) {
            listened.current.add(key);
            const persist = inputRef.current.onListened ?? ((eventId: string) => updateAdminOttoDelivery({ eventIds: [eventId], action: "listened" }));
            void persist(recap.eventId).catch(() => undefined);
          }
          releaseLease();
        } else if (next.status === "idle") {
          releaseLease();
        }
      },
      onFailure: (message) => {
        if (!isCurrent()) return;
        setError(message);
        releaseLease();
      },
      onStaleCard: () => undefined,
      onReviewChanged: (failure) => {
        if (!isCurrent()) return false;
        if (failure instanceof AdminOttoSpeechChangedError) {
          setRecapUpdates((current) => ({ ...current, [failure.current.intervalId]: failure.current }));
          setError("This recap changed. Review the updated version, then press Listen again.");
          releaseLease();
          return true;
        }
        return false;
      },
    });
    playerRef.current = player;
    return () => {
      releaseLease();
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [input.scope, input.epoch, input.enabled, releaseLease]);

  const listen = useCallback(async (recap: ReviewedRecap) => {
    const current = inputRef.current;
    if (!current.scope || current.scope.mode !== "admin" || !current.enabled) {
      setError("Reading recaps aloud is unavailable in this administration context.");
      return;
    }
    const playingThis = snapshot.intervalId === recap.intervalId
      && (snapshot.status === "loading" || snapshot.status === "playing");
    if (playingThis) {
      stop();
      return;
    }
    if (snapshot.intervalId === recap.intervalId && snapshot.status === "finished") {
      playerRef.current?.stop();
      releaseLease();
    }
    current.onBeforeSpeech?.();
    // Starting a read is also the other half of the microphone interlock: the
    // owning surface cancels a capture before audio begins.
    requestOttoAudioStop();
    setError(null);
    let lease: OttoAudioLease;
    try {
      lease = await requestOttoAudio(current.scope, current.epoch, "speech");
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Audio is busy in another companion window.");
      return;
    }
    // A mode/account/voice change while the lease was requested must not start
    // the old clip. The scope check repeats after the await.
    if (inputRef.current.epoch !== current.epoch
      || inputRef.current.scope?.userId !== current.scope.userId
      || inputRef.current.scope?.organizationId !== current.scope.organizationId
      || inputRef.current.scope?.mode !== "admin") {
      lease.release();
      return;
    }
    if (!lease.isActive()) {
      // The broker granted and then revoked this exact token before playback
      // began. Starting now would overlap the next owner.
      lease.release();
      return;
    }
    leaseRef.current?.release();
    leaseRef.current = lease;
    currentRecap.current = recap;
    await playerRef.current?.toggle({
      intervalId: recap.intervalId,
      revision: null,
      reviewKey: recap.reviewKey,
      voice: current.voice,
      enabled: current.enabled,
    });
  }, [snapshot.intervalId, snapshot.status, stop]);

  const playback: AdminRecapPlayback = {
    status: input.enabled ? snapshot.status : "idle",
    intervalId: input.enabled ? snapshot.intervalId : null,
    lines: input.enabled ? snapshot.lines : [],
    progress: input.enabled ? snapshot.progress : 0,
    activeIndex: input.enabled ? snapshot.activeIndex : 0,
    slow: input.enabled ? snapshot.slow : false,
    error,
  };

  return { playback, listen, stop, error, recapUpdates };
}

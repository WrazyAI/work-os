import { useEffect, useState } from "react";

export const ATTENTION_ANIMATION_MS = 5_000;
export const ATTENTION_COOLDOWN_MS = 1_000;
export const ATTENTION_PLAY_COUNT = 3;
const INACTIVE_ATTENTION = { playing: false, cycle: 0 } as const;

export type AttentionPlaybackChange = (playing: boolean, cycle: number) => void;

/** Run one bounded attention sequence. The caller owns the semantic trigger;
 * timers only control how long each visual play is active. */
export function startAttentionSequence(onChange: AttentionPlaybackChange): () => void {
  let stopped = false;
  let cycle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const play = () => {
    if (stopped || cycle >= ATTENTION_PLAY_COUNT) return;
    cycle += 1;
    onChange(true, cycle);
    timer = setTimeout(() => {
      if (stopped) return;
      onChange(false, cycle);
      if (cycle < ATTENTION_PLAY_COUNT) timer = setTimeout(play, ATTENTION_COOLDOWN_MS);
    }, ATTENTION_ANIMATION_MS);
  };

  play();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export function useAttentionSequence(enabled: boolean, reducedMotion = false, replayKey = 0): { playing: boolean; cycle: number } {
  const [playback, setPlayback] = useState<{ playing: boolean; cycle: number }>(INACTIVE_ATTENTION);

  useEffect(() => {
    if (!enabled || reducedMotion) return;
    return startAttentionSequence((playing, cycle) => setPlayback({ playing, cycle }));
  }, [enabled, reducedMotion, replayKey]);

  return enabled && !reducedMotion ? playback : INACTIVE_ATTENTION;
}

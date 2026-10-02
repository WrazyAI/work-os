"use client";

import { useEffect, useRef, useState } from "react";
import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import type { DotLottie } from "@lottiefiles/dotlottie-web";

/** The renderer ships with this app, not a CDN: the confirmation must not
 * depend on a third-party origin. `public/dotlottie-player.wasm` is the
 * player from @lottiefiles/dotlottie-web 0.80.0 — refresh both together. */
setWasmUrl("/dotlottie-player.wasm");

function reducedMotionPreferred(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The source animation fades its check out over the final frames, so its
 * literal last frame is empty. The confirmation holds the completed state —
 * the fully drawn check — instead of the faded tail. */
const HOLD_FRAME = 50;

/**
 * The submission confirmation animation. It plays exactly once and stops on
 * the last frame — never a loop. Under reduced motion the final frame renders
 * statically, and the decorative art stays hidden from assistive technology;
 * the confirmation copy carries the meaning.
 */
export function CheckedMoment({ className }: { className?: string }) {
  // The player mounts client-side only, so server rendering keeps plain markup
  // and the wasm player never runs outside a browser.
  const [mounted, setMounted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [reduced, setReduced] = useState(false);
  const bound = useRef<DotLottie | null>(null);

  useEffect(() => {
    setReduced(reducedMotionPreferred());
    setMounted(true);
  }, []);

  const classes = ["relative inline-flex h-[148px] w-[148px] items-center justify-center", className].filter(Boolean).join(" ");
  if (!mounted) {
    return <span className={`${classes} opacity-0`} data-lottie="pending" aria-hidden="true" />;
  }

  /** Hold the completed check: the source fades the art out over its final
   * frames, so the confirmation parks on the fully drawn state. */
  const holdLastFrame = (instance: DotLottie) => {
    instance.setFrame(Math.min(HOLD_FRAME, Math.max(0, instance.totalFrames - 1)));
    setComplete(true);
  };

  return <span
    className={classes}
    data-lottie={complete ? "complete" : "playing"}
    data-reduced-motion={reduced ? "true" : "false"}
    aria-hidden="true"
  >
    <DotLottieReact
      className="!block !h-full !w-full"
      src="/checked.lottie"
      autoplay={!reduced}
      loop={false}
      dotLottieRefCallback={(instance: DotLottie | null) => {
        if (!instance || bound.current === instance) return;
        bound.current = instance;
        instance.addEventListener("load", () => { if (reducedMotionPreferred()) holdLastFrame(instance); });
        instance.addEventListener("complete", () => holdLastFrame(instance));
      }}
    />
  </span>;
}

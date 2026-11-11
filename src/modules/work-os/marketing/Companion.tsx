"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./companion.module.css";

/**
 * The site companion. It renders the configured mascot's own SVG rig, not a
 * second identity, and adds landing-only acting: blink, pointer gaze, a longer
 * idle curiosity beat, and a click-only celebration. The installed companion is
 * untouched. A visitor who never clicks never sees a celebration.
 */
export default function Companion({ compact = false, paused: parentPaused = false }: { compact?: boolean; paused?: boolean } = {}) {
  const art = useRef<HTMLDivElement>(null);
  const pet = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<"idle" | "celebrate">("idle");
  const [localPaused, setPaused] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const paused = parentPaused || localPaused;
  const [reduced, setReduced] = useState(false);
  const celebrateTimer = useRef<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch("/site/work-os/studio-otto.svg", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Artwork unavailable"); return response.text(); })
      .then((markup) => {
        if (cancelled || !art.current) return;
        const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
        const svg = parsed.querySelector("svg.studio-otto");
        if (!svg || parsed.querySelector("parsererror")) return;
        svg.removeAttribute("data-static");
        svg.removeAttribute("aria-label");
        svg.removeAttribute("role");
        svg.setAttribute("aria-hidden", "true");

        const head = svg.querySelector(".studio-head");
        if (head) {
          const look = document.createElementNS("http://www.w3.org/2000/svg", "g");
          look.classList.add("site-head-look");
          head.replaceWith(look);
          look.append(head);
        }
        const face = svg.querySelector(".studio-face");
        if (face) {
          const happy = document.createElementNS("http://www.w3.org/2000/svg", "g");
          happy.classList.add("site-ready-face");
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "m51 63 8-11 8 11m24 0 8-11 8 11M71 81l7 6 13-13");
          happy.append(path);
          face.append(happy);
        }
        art.current.replaceChildren(document.importNode(svg, true));
        setReady(true);
      })
      .catch(() => { /* the static configured image remains */ });
    return () => { cancelled = true; controller.abort(); };
  }, []);

  const finish = useCallback(() => {
    setState("idle");
    if (celebrateTimer.current) window.clearTimeout(celebrateTimer.current);
    celebrateTimer.current = null;
  }, []);

  useEffect(() => {
    const node = pet.current;
    if (!node) return;
    let visible = true;
    const sync = () => setSuspended(!visible || document.hidden);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .1 });
    observer.observe(node);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  useEffect(() => () => {
    if (celebrateTimer.current) window.clearTimeout(celebrateTimer.current);
  }, []);

  useEffect(() => {
    const node = pet.current;
    if (!node || !ready || reduced || paused || suspended || state !== "idle") return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let visible = true;
    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let pointer: PointerEvent | null = null;

    const paint = () => {
      node.style.setProperty("--look-x", `${x.toFixed(3)}px`);
      node.style.setProperty("--look-y", `${y.toFixed(3)}px`);
      node.style.setProperty("--head-turn", `${(x * 0.32).toFixed(3)}deg`);
      node.style.setProperty("--head-nod", `${(y * 0.12).toFixed(3)}px`);
    };
    const allowed = () => visible && !document.hidden && !paused && !reduced && fine.matches && state === "idle";
    const tick = () => {
      frame = 0;
      if (!allowed()) return;
      if (pointer) {
        const box = node.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const eyeY = box.top + box.height * 0.32;
        targetX = Math.max(-1, Math.min(1, (pointer.clientX - cx) / Math.max(innerWidth * 0.32, 200))) * 5.5;
        targetY = Math.max(-1, Math.min(1, (pointer.clientY - eyeY) / Math.max(innerHeight * 0.35, 200))) * 3.5;
        pointer = null;
      }
      x += (targetX - x) * 0.16;
      y += (targetY - y) * 0.16;
      paint();
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > 0.015) frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !allowed()) return;
      pointer = event;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const away = () => {
      targetX = 0;
      targetY = 0;
      pointer = null;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
        targetX = 0;
        targetY = 0;
        paint();
      }
    }, { threshold: 0.15 });
    observer.observe(node);
    document.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", away, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", away);
      cancelAnimationFrame(frame);
      x = 0;
      y = 0;
      paint();
    };
  }, [paused, ready, reduced, suspended, state]);

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`}>
      <button
        ref={pet}
        type="button"
        className={styles.pet}
        data-state={state}
        data-reduced={reduced ? "true" : "false"}
        data-paused={paused || suspended ? "true" : "false"}
        data-ready={ready ? "true" : "false"}
        aria-label="Play companion celebration"
        onClick={() => {
          setState("celebrate");
          if (celebrateTimer.current) window.clearTimeout(celebrateTimer.current);
          celebrateTimer.current = window.setTimeout(finish, 2800);
        }}
      >
        <div ref={art} className={styles.art}>
          <img src="/site/work-os/studio-otto.svg" alt="" width={220} height={248} />
        </div>
      </button>
      <p className={styles.note} aria-live="polite">
        {state === "celebrate" ? "A little company goes a long way." : reduced ? "Click to say hello. Motion is reduced." : paused ? "Motion paused. Click to say hello." : "Move your pointer. Click to say hello."}
      </p>
      {!compact && <button
        type="button"
        className={styles.pause}
        onClick={() => setPaused((value) => !value)}
        disabled={reduced}
      >
        {reduced ? "Reduced motion is on" : paused ? "Resume motion" : "Pause motion"}
      </button>}
    </div>
  );
}

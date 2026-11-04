"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { detectPlatform } from "@/lib/work-os-installers";
import type { DownloadGuidePlatform } from "./download-guides";
import DownloadLink from "./DownloadLink";
import styles from "./downloads.module.css";

// Browser identity is fixed for this visit. A server snapshot avoids both a
// hydration mismatch and an effect that copies external state into React state.
const subscribe = () => () => {};
const serverPlatform = () => "unknown" as const;
function browserPlatform() {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectPlatform({
    platform: nav.userAgentData?.platform || navigator.platform,
    userAgent: navigator.userAgent,
  });
}

export default function DownloadChooser() {
  const os = useSyncExternalStore(subscribe, browserPlatform, serverPlatform);
  const detected = os === "windows" || os === "macos";
  const platform: DownloadGuidePlatform = os === "macos" ? "macos" : "windows";
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const alternative = useRef<HTMLAnchorElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const label = platform === "windows" ? "Windows" : "macOS";
  const other = platform === "windows" ? "macos" : "windows";
  const otherLabel = other === "windows" ? "Windows" : "macOS";

  return (
    <div className={styles.chooser}>
      <div ref={container} className={styles.split} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }} onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}>
        <DownloadLink className={styles.action} platform={platform}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
          Download for {label}
        </DownloadLink>
        <button ref={trigger} type="button" className={styles.toggle}
          aria-label="Other platforms" title="Other platforms"
          aria-expanded={open} aria-controls={menuId}
          onClick={() => setOpen(!open)} onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              // The panel stays mounted so focus can follow the disclosure.
              requestAnimationFrame(() => alternative.current?.focus());
            }
          }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <div id={menuId} className={styles.dropdown} hidden={!open}>
          <DownloadLink ref={alternative} platform={other} aria-label={`Download for ${otherLabel}`} onClick={() => setOpen(false)}>
            Download for {otherLabel}
            <small>{other === "macos" ? "Intel and Apple Silicon · .dmg" : "64-bit installer · .exe"}</small>
          </DownloadLink>
        </div>
      </div>
      <p className={styles.meta}>
        {detected ? `For your ${label === "macOS" ? "Mac" : "Windows PC"}.` : "Windows selected. Choose the arrow for macOS."}
        {platform === "macos" ? " Intel and Apple Silicon." : " 64-bit installer."}
      </p>
    </div>
  );
}

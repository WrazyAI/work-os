"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { detectPlatform, type DetectedPlatform } from "@/lib/work-os-installers";
import DownloadLink from "./DownloadLink";
import styles from "./downloads.module.css";

const LABELS: Record<DetectedPlatform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  unknown: "your computer",
};

export default function DownloadChooser() {
  const [detected, setDetected] = useState<DetectedPlatform>("unknown");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setDetected(detectPlatform({
      platform: nav.userAgentData?.platform || navigator.platform,
      userAgent: navigator.userAgent,
    }));
    setReady(true);
  }, []);

  const detectedGuide = detected === "windows" || detected === "macos" ? detected : null;
  const label = detected === "windows" ? "Download for Windows"
    : detected === "macos" ? "Download for macOS"
      : "Choose your computer";

  return (
    <div className={styles.grid}>
      <section className={styles.primary} aria-labelledby="recommended-title">
        <p className={styles.eyebrow}>
          <span aria-hidden="true" className={styles.dot} />
          {ready ? `It looks like you’re using ${LABELS[detected]}.` : "Checking your computer."}
        </p>
        <h2 id="recommended-title">
          {detected === "linux" ? "Linux is coming later." : "The right fit for your computer."}
        </h2>
        {detected === "linux" ? (
          <>
            <p className={styles.lede}>
              A Linux version isn’t available yet. You can still open your Work OS workspace in the browser.
            </p>
            <a className={styles.secondaryAction} href="/work-os/workspace">Open the web workspace</a>
          </>
        ) : (
          <>
            <p className={styles.lede}>
              {ready && detectedGuide
                ? "The installer is ready. Sign in to Work OS after installing to connect your workspace."
                : "Choose Windows or macOS below. Linux is coming later."}
            </p>
            {detectedGuide ? (
              <DownloadLink className={styles.action} platform={detectedGuide}>{label}</DownloadLink>
            ) : (
              <a className={styles.action} href="#other-platforms">Choose a version</a>
            )}
            <p className={styles.meta}>
              Unsigned internal build · Verify the SHA-256 checksum before installing
            </p>
          </>
        )}
        <img className={styles.pet} src="/site/work-os/studio-otto.svg" alt="" width={120} height={135} />
      </section>

      <section className={styles.options} id="other-platforms" aria-labelledby="other-platforms-title">
        <h2 id="other-platforms-title">Looking for another version?</h2>
        <div className={styles.option}>
          <div>
            <strong>Windows</strong>
            <small>NSIS installer · unsigned internal build</small>
          </div>
          <DownloadLink platform="windows">Download</DownloadLink>
        </div>
        <div className={styles.option}>
          <div>
            <strong>macOS</strong>
            <small>Universal DMG for Intel and Apple Silicon</small>
          </div>
          <DownloadLink platform="macos">Download</DownloadLink>
        </div>
        <div className={`${styles.option} ${styles.unavailable}`}>
          <div>
            <strong>Linux</strong>
            <small>A Linux version isn’t available yet.</small>
          </div>
          <span>Coming later</span>
        </div>
        <p className={styles.checksums}>
          <Link href="/downloads/work-os/windows/checksums">SHA-256 checksums</Link>
        </p>
      </section>
    </div>
  );
}

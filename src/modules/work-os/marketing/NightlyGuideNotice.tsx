"use client";

import { useSyncExternalStore } from "react";
import { checksumsHref, downloadHref, type DownloadGuidePlatform } from "./download-guides";
import styles from "./downloads.module.css";

const subscribe = () => () => {};
const serverIsNightly = () => false;
function browserIsNightly() {
  return new URLSearchParams(window.location.search).get("channel")?.trim().toLowerCase() === "nightly";
}

function useIsNightlyChannel(): boolean {
  return useSyncExternalStore(subscribe, browserIsNightly, serverIsNightly);
}

export function ChannelDownloadAgainLink({ platform, defaultHref }: { platform: DownloadGuidePlatform; defaultHref: string }) {
  const isNightly = useIsNightlyChannel();
  return <a href={isNightly ? downloadHref(platform, "nightly") : defaultHref} download>Download again</a>;
}

export function ChannelChecksumsLink({ platform, defaultHref }: { platform: DownloadGuidePlatform; defaultHref: string }) {
  const isNightly = useIsNightlyChannel();
  return <a href={isNightly ? checksumsHref(platform, "nightly") : defaultHref}>published checksums</a>;
}

export default function NightlyGuideNotice({ platform, label }: { platform: DownloadGuidePlatform; label: string }) {
  const isNightly = useIsNightlyChannel();
  if (!isNightly) return null;

  return (
    <aside className={styles.nightlyBanner} aria-label="Nightly channel instructions">
      <p>
        <strong>Nightly developer build for {label}.</strong>{" "}
        After installing, open <strong>Settings → General → Release channel</strong> and switch to <strong>Nightly</strong> to keep receiving automatic Nightly updates.{" "}
        <a href={downloadHref(platform, "nightly")} download>Download Nightly again</a>
        {" · "}
        <a href={checksumsHref(platform, "nightly")}>Nightly checksums</a>
      </p>
    </aside>
  );
}

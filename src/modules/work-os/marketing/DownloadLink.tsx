"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { useRouter } from "next/navigation";
import {
  downloadGuidePath,
  downloadHref,
  type DownloadChannel,
  type DownloadGuidePlatform,
} from "./download-guides";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "download"> & {
  ref?: Ref<HTMLAnchorElement>;
  platform: DownloadGuidePlatform;
  channel?: DownloadChannel;
  children: ReactNode;
};

/** Starts the real installer download, then immediately opens its install
 * guide. A modified click keeps the browser's own behaviour so a visitor can
 * still open the file in a new tab. */
export default function DownloadLink({ platform, channel = "stable", children, onClick, ...rest }: Props) {
  const router = useRouter();

  function startGuidedDownload(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;

    event.preventDefault();
    // Keep the download independent of the route change: the temporary anchor
    // is a real user-gesture download, and removing it does not cancel it.
    const link = document.createElement("a");
    link.href = downloadHref(platform, channel);
    link.download = "";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    router.push(downloadGuidePath(platform, channel));
  }

  return (
    <a
      {...rest}
      href={downloadHref(platform, channel)}
      download
      onClick={startGuidedDownload}
    >
      {children}
    </a>
  );
}

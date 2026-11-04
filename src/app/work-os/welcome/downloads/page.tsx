import { redirect } from "next/navigation";

/** Compatibility for the first published downloads URL. */
export default function LegacyDownloadsPage() {
  redirect("/work-os/downloads");
}

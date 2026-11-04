import { redirect } from "next/navigation";

/** Compatibility for the first published tutorial library URL. */
export default function LegacyTutorialsPage() {
  redirect("/work-os/tutorials");
}

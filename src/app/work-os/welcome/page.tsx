import { redirect } from "next/navigation";

/** Compatibility for the first published site URL. The landing now owns
 * /work-os itself; old links and bookmarks follow it here. */
export default function LegacyWelcomePage() {
  redirect("/work-os");
}

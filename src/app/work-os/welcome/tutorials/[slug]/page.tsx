import { redirect } from "next/navigation";

/** Compatibility for the first published tutorial lesson URLs. */
export default async function LegacyTutorialPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/work-os/tutorials/${encodeURIComponent(slug)}`);
}

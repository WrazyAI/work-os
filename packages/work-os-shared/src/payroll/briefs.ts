const CITATION = /\[[^\]]*(?:interval|finding|approval|report|task):[^\]]*@\d+[^\]]*\]/gi;

/** Removes model citation plumbing from prose. Structured citations remain in
 * the Sources disclosure; the inline tokens are not readable content. */
export function payrollBriefText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(CITATION, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A generated title often repeats its week and date range. The card already
 * shows both, so keep only the distinguishing part of the title. */
export function payrollBriefTitle(title: string | null | undefined, week: number): string {
  let value = (title ?? "").replace(/\s+/g, " ").trim();
  value = value.replace(new RegExp(`^week\\s*${week}\\s*[·:—–-]?\\s*`, "i"), "");
  value = value.replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}\s*(?:through|to|[—–-])\s*\d{4}-\d{2}-\d{2}\s*$/i, "");
  value = value.replace(/^(?:(?:weekly|week)\s+)?(?:progress\s+)?brief$/i, "Progress brief");
  if (!value) return "Progress brief";
  return value[0].toUpperCase() + value.slice(1);
}

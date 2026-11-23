/** The evidence kinds both the API summary and the companion need to agree on.
 * This module is deliberately free of React, database, and Node imports so the
 * route and the desktop can read the same classification. */

export type EvidenceKind = "call" | "email" | "text" | "context" | "github" | "worktivity" | "other";

export type EvidenceKindBucket = "calls" | "emails" | "texts" | "work" | "context";

export function evidenceKind(source: string, title: string): EvidenceKind {
  const normalizedSource = String(source ?? "").trim().toLowerCase();
  const normalizedTitle = String(title ?? "").trim().toLowerCase();
  if (normalizedSource === "github") return "github";
  if (normalizedSource === "worktivity") return "worktivity";
  if (normalizedTitle.startsWith("call ") || normalizedTitle.includes("call outbound") || normalizedTitle.includes("call inbound")) return "call";
  if (normalizedTitle.includes("email")) return "email";
  if (normalizedTitle.includes("text message")) return "text";
  if (normalizedTitle.includes("opportunity")) return "context";
  return "other";
}

export function evidenceKindBucket(kind: EvidenceKind): EvidenceKindBucket {
  if (kind === "call") return "calls";
  if (kind === "email") return "emails";
  if (kind === "text") return "texts";
  if (kind === "github" || kind === "worktivity") return "work";
  return "context";
}

export function evidenceKindLabel(kind: EvidenceKind): string {
  if (kind === "call") return "Call";
  if (kind === "email") return "Email";
  if (kind === "text") return "Text";
  if (kind === "context") return "Context";
  if (kind === "github") return "GitHub";
  if (kind === "worktivity") return "Worktivity frame";
  return "Evidence";
}

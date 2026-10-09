import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DiagnosticEvent, DiagnosticLevel, DiagnosticSource } from "./diagnostics";

export type PagedDiagnosticEvent = DiagnosticEvent & { seq: number };

export type DiagnosticsPageInput = {
  before?: number;
  after?: number;
  since?: number;
  limit?: number;
  level?: DiagnosticLevel;
  source?: DiagnosticSource;
  query?: string;
};

export type DiagnosticsPage = {
  events: PagedDiagnosticEvent[];
  headSeq: number;
  hasNewer: boolean;
  hasOlder: boolean;
  matchingTotal: number;
  matchingAfter: number | null;
};

/** Debug-window-only command. Keep this call out of diagnostics.ts, which is
 * imported by the main and avatar windows and has broader IPC grants. */
export async function diagnosticsPage(input: DiagnosticsPageInput): Promise<DiagnosticsPage> {
  if (!isTauri()) return { events: [], headSeq: 0, hasNewer: false, hasOlder: false, matchingTotal: 0, matchingAfter: null };
  return invoke<DiagnosticsPage>("diagnostics_page", { input });
}

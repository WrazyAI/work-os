/* The structured EOD contract lives in the shared package so the web app and
 * the desktop companion validate and sign the same composition. */
import * as contract from "../../../packages/work-os-shared/src/eod-structured";

export const EOD_STRUCTURED_VERSION = contract.EOD_STRUCTURED_VERSION;
export const EOD_MAX_LINES = contract.EOD_MAX_LINES;
export const EOD_MAX_LINE_CHARS = contract.EOD_MAX_LINE_CHARS;
export const EOD_MAX_SUMMARY_CHARS = contract.EOD_MAX_SUMMARY_CHARS;
export const EOD_MAX_SUGGESTIONS = contract.EOD_MAX_SUGGESTIONS;
export const EOD_MAX_EVIDENCE_GROUPS = contract.EOD_MAX_EVIDENCE_GROUPS;
export const EOD_MAX_EVIDENCE_ITEMS = contract.EOD_MAX_EVIDENCE_ITEMS;
export const EOD_MAX_URL_CHARS = contract.EOD_MAX_URL_CHARS;
export const cleanEodText = contract.cleanEodText;
export const cleanEodLines = contract.cleanEodLines;
export const normalizeLoomShareUrl = contract.normalizeLoomShareUrl;
export const eodCompositionSignature = contract.eodCompositionSignature;
export const eodCompositionIsComplete = contract.eodCompositionIsComplete;
export const eodSummaryIsCurrent = contract.eodSummaryIsCurrent;
export const eodEvidenceCount = contract.eodEvidenceCount;
export const normalizeEodStructuredReport = contract.normalizeEodStructuredReport;
export const mergeEodComposition = contract.mergeEodComposition;
export const emptyEodStructuredReport = contract.emptyEodStructuredReport;
export const assembleEodSummary = contract.assembleEodSummary;
export type {
  EodCompositionInput,
  EodEvidenceGroup,
  EodEvidenceItem,
  EodSectionKey,
  EodStructuredReport,
  EodSuggestions,
} from "../../../packages/work-os-shared/src/eod-structured";

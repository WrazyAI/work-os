import { ArrowLeft, CloudUpload } from "lucide-react";
import { CheckedMoment } from "./CheckedMoment";
import { formatWorkOsFullDate } from "./dateFormat";

/** The receipt after a submit. A queued write has not reached the server, so it
 * never gets the success check or the word "submitted". */
export function EodSubmitReceipt({ queued, date, onAllEods }: { queued: boolean; date: string | null; onAllEods: () => void }) {
  return <section className="panel eod-submitted" role="status">
    <div className="eod-submitted-head">
      <button type="button" className="quiet-action" onClick={onAllEods}><ArrowLeft size={14} aria-hidden="true" /> All EODs</button>
    </div>
    {queued
      ? <div className="eod-submitted-queued" aria-hidden="true"><CloudUpload size={38} /></div>
      : <CheckedMoment />}
    <strong>{queued ? "EOD queued" : "EOD submitted"}</strong>
    <p>{queued
      ? "Queued on this device — your report will be sent when the connection returns."
      : date ? `Your report for ${formatWorkOsFullDate(date)} is with your manager.` : "Your report is with your manager. You are done for today."}</p>
  </section>;
}

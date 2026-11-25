import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { MascotPet } from "../../MascotPet";

export function LoadingScreen({ failed, retry, note, stage, onReset, onDebug, onOffline }: {
  failed: boolean;
  retry: () => void;
  /** Bounded explanation of what is wrong, replacing the generic hint. */
  note?: string;
  /** What is actually happening right now. Only ever pass what is true. */
  stage?: string;
  /** Starts this device fresh; only offered when nothing else can recover. */
  onReset?: () => void | Promise<void>;
  onDebug: () => void;
  /** Only surfaces that can actually run offline pass this. */
  onOffline?: () => void;
}) {
  // A destructive recovery is armed on the first click and only runs on the
  // second, so a stray click on a failure screen can never discard local data.
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!resetArmed) return;
    const timer = setTimeout(() => setResetArmed(false), 8_000);
    return () => clearTimeout(timer);
  }, [resetArmed]);
  // The non-failed launch surface lives in BootHandoff.tsx (First Light); this
  // component is the local-vault recovery path only.
  const hint = onReset
    ? resetArmed
      ? "This deletes this device's saved session and queued updates. Tasks and updates already filed with the server stay, and you'll connect this device again."
      : "Start fresh only if the saved data can't be opened — it replaces this device's local copy."
    : onOffline
      ? "Offline mode uses local fixtures only — nothing reaches the server."
      : "Retry re-checks this device's saved key.";
  return <main className="loading"><div className="loading-shell">
    <MascotPet isolated agent="blocked" workday="active" className="mascot-loading" artClassName="mascot-loading-art" />
    <h1>Work OS needs another try</h1>
    <p>{note ?? "The details are in the notification above."}</p>
    <button className="primary" onClick={retry} disabled={resetting}>Retry</button>
    <div className="loading-alternatives">
      {onOffline && <button onClick={onOffline} disabled={resetting}>Continue offline</button>}
      {onReset && <button
        className={resetArmed ? "danger" : ""}
        disabled={resetting}
        title={resetArmed ? "This deletes this device's saved Work OS data" : "Replace this device's unreadable local data"}
        onClick={async () => {
          if (!resetArmed) { setResetArmed(true); return; }
          setResetting(true);
          try { await onReset(); } finally { setResetting(false); setResetArmed(false); }
        }}
      >{resetting ? "Starting fresh…" : resetArmed ? "Delete local data and start fresh" : "Start fresh on this device"}</button>}
      <button className="quiet" onClick={onDebug} disabled={resetting}><Bug size={14} /> Scenario debugger</button>
    </div>
    <small>{hint}</small>
  </div></main>;
}

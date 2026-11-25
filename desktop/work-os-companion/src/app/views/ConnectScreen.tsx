import { ExternalLink, LogIn } from "lucide-react";
import { FadeArc } from "../../LoadingUi";
import { OnboardingStage } from "../../OnboardingStage";

type ConnectScreenProps = {
  apiBase: string;
  setApiBase: (value: string) => void;
  connecting: boolean;
  /** The browser is open and the app is waiting for the deep-link callback. */
  awaiting?: boolean;
  onConnect: () => void;
  onSave: () => Promise<void>;
  /** Why this device was signed out, when it was. */
  notice?: string | null;
};

function ConnectSettings({ apiBase, setApiBase, onSave, summary = "Advanced settings" }: Pick<ConnectScreenProps, "apiBase" | "setApiBase" | "onSave"> & { summary?: string }) {
  return <details className="connect-settings">
    <summary>{summary}</summary>
    <div className="connect-settings-row">
      <label htmlFor="workspace-server-url">Workspace server URL</label>
      <div className="connect-settings-controls">
        <input id="workspace-server-url" value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" />
        <button onClick={() => void onSave()}>Save</button>
      </div>
    </div>
  </details>;
}

/** The first frame of first run. The connect screen is the same stage the
 *  setup flow opens on, so the sign-in round-trip never leaves Otto's world:
 *  he carries the sequence in his own voice, and the stage carries the one
 *  action. The advanced server override stays a quiet disclosure in the
 *  bubble, beside the action it changes. */
export function ConnectScreen({ apiBase, setApiBase, connecting, awaiting = false, onConnect, onSave, notice }: ConnectScreenProps) {
  return <main className="guided-onboarding" data-stage="welcome">
    <OnboardingStage
      pose="waiting"
      eyebrow="Desktop companion"
      title="Connect your workspace."
      line={awaiting
        ? "I’ve opened your browser. Approve this device there, and I’ll be waiting here when you’re back."
        : "I’m Otto. First, let me get you in — I’ll open your browser for a secure sign-in. Approve this device, and I’ll be right here when you’re back."}
      replayKey="connect"
    >
      <div className="otto-bubble-actions">
        <button className="primary" disabled={connecting} onClick={onConnect}>{connecting ? <FadeArc size={17} /> : awaiting ? <ExternalLink size={17} /> : <LogIn size={17} />} {connecting ? "Opening browser…" : awaiting ? "Reopen browser" : "Connect workspace"}</button>
        {awaiting ? null : <span className="otto-bubble-note">About a minute.</span>}
      </div>
      {awaiting && !connecting && <p className="otto-bubble-status" role="status">Waiting for approval in your browser. I’ll finish connecting here.</p>}
      {notice && <p className="otto-bubble-notice" role="status">{notice}</p>}
      <ConnectSettings apiBase={apiBase} setApiBase={setApiBase} onSave={onSave} />
    </OnboardingStage>
  </main>;
}

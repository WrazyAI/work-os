import { useState } from "react";
import { ConnectScreen } from "./App";

/** Dev-only rendered fixture for the connect screen: the first frame, the
 *  browser round-trip wait, and the one action in each state. */
export default function ConnectPreview() {
  const initial = new URLSearchParams(window.location.search).get("connect-state");
  const [awaiting, setAwaiting] = useState(initial === "awaiting");
  return (
    <ConnectScreen
      apiBase="https://app.wrazyos.com"
      setApiBase={() => undefined}
      connecting={initial === "connecting"}
      awaiting={awaiting}
      onConnect={() => setAwaiting(true)}
      onSave={async () => undefined}
    />
  );
}

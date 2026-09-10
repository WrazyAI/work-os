import { ConnectScreen, LoadingScreen } from "./App";

/** Visual review states for the pre-app surfaces: loader, connect, failed. */
export default function LoadingPreview() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state") ?? "loading";
  if (state === "connect" || state === "connecting") {
    return <ConnectScreen apiBase="https://app.wrazyos.com" setApiBase={() => undefined} connecting={state === "connecting"} onDebug={() => undefined} onConnect={() => undefined} onSave={async () => undefined} />;
  }
  if (state === "failed") {
    return <LoadingScreen failed={true} retry={() => undefined} onDebug={() => undefined} onOffline={() => undefined} />;
  }
  return <LoadingScreen failed={false} retry={() => undefined} onDebug={() => undefined} onOffline={() => undefined} />;
}

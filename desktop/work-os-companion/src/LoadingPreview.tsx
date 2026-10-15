import { ConnectScreen, LoadingScreen } from "./App";

/** Visual review states for the pre-app surfaces: loader, connect, failed, and
 * the two local-vault recovery screens. The vault screens are the ones an
 * in-place macOS update can land on — the Keychain item no longer matches the
 * new build — so they are reviewable without a packaged app. */
export default function LoadingPreview() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state") ?? "loading";
  if (state === "connect" || state === "connecting") {
    return <ConnectScreen apiBase="https://app.wrazyos.com" setApiBase={() => undefined} connecting={state === "connecting"} onConnect={() => undefined} onSave={async () => undefined} />;
  }
  if (state === "connect-signed-out") {
    // A stored device session that expired or was rejected: the connect screen
    // has to say so, because the workspace is no longer available on it.
    return <ConnectScreen
      apiBase="https://app.wrazyos.com"
      setApiBase={() => undefined}
      connecting={false}
      onConnect={() => undefined}
      onSave={async () => undefined}
      notice="This device's connection expired, so I signed it out. Connect it again to keep working — nothing you filed is lost."
    />;
  }
  if (state === "vault-confirm") {
    return <LoadingScreen
      failed
      note="macOS is waiting for you to allow access to the saved Work OS key. Look for a system password dialog — it can open behind the companion — then try again."
      retry={() => undefined}
      onDebug={() => undefined}
    />;
  }
  if (state === "vault-reset") {
    return <LoadingScreen
      failed
      note="The saved key for this device's Work OS data can't be read, so the local data can't be opened. Try again, or start fresh to replace it."
      retry={() => undefined}
      onReset={() => undefined}
      onDebug={() => undefined}
    />;
  }
  if (state === "failed") {
    return <LoadingScreen failed retry={() => undefined} onDebug={() => undefined} onOffline={() => undefined} />;
  }
  return <LoadingScreen failed={false} retry={() => undefined} onDebug={() => undefined} onOffline={() => undefined} />;
}

import { useEffect, useState } from "react";
import { ConnectScreen, LoadingScreen } from "./App";
import { BootOverlay, FirstLightSurface, useBootRise } from "./BootHandoff";
import { BOOT_STAGE_COPY, type BootScreen } from "./bootScreen";

/** A repeating loading → content loop so the Morning Rise handoff is watchable
 * without a packaged app. The stand-in panel is an obvious wireframe, not the
 * workspace itself. */
function HandoffPreview() {
  const [mode, setMode] = useState<"loading" | "content">("loading");
  const screen: BootScreen = mode === "loading" ? { kind: "loading", phase: "day" } : { kind: "content", surface: "workspace" };
  const rise = useBootRise(screen);
  useEffect(() => {
    const interval = setInterval(() => setMode((current) => current === "loading" ? "content" : "loading"), 2200);
    return () => clearInterval(interval);
  }, []);
  return <BootOverlay screen={screen}>
    <div
      className={`workspace${rise ? " boot-rise" : ""}`}
      style={{ position: "fixed", inset: 0, display: "grid", gridTemplateColumns: "16% 1fr", background: "#eef1eb", overflow: "hidden" }}
    >
      <aside style={{ background: "#e3e7de", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "11%", gap: "9%" }} aria-hidden="true">
        <img src="/studio-otto-mark.svg" alt="" style={{ width: "52%" }} />
        <span style={{ width: "42%", height: "5px", borderRadius: "3px", background: "rgba(24,32,24,.10)" }} />
        <span style={{ width: "42%", height: "5px", borderRadius: "3px", background: "rgba(24,32,24,.10)" }} />
        <span style={{ width: "42%", height: "5px", borderRadius: "3px", background: "rgba(24,32,24,.10)" }} />
      </aside>
      <section style={{ padding: "8% 9%", display: "grid", gap: "6%", alignContent: "start" }} aria-hidden="true">
        <span style={{ height: "12px", width: "54%", borderRadius: "5px", background: "rgba(24,32,24,.18)" }} />
        <span style={{ height: "26px", borderRadius: "7px", background: "rgba(94,157,39,.12)", border: "1px solid rgba(94,157,39,.25)" }} />
        <span style={{ height: "8px", width: "88%", borderRadius: "4px", background: "rgba(24,32,24,.08)" }} />
        <span style={{ height: "8px", width: "70%", borderRadius: "4px", background: "rgba(24,32,24,.08)" }} />
        <span style={{ height: "8px", width: "80%", borderRadius: "4px", background: "rgba(24,32,24,.08)" }} />
      </section>
    </div>
  </BootOverlay>;
}

/** Visual review states for the pre-app surfaces: loader, connect, failed, and
 * the two local-vault recovery screens. The vault screens are the ones an
 * in-place macOS update can land on — the Keychain item no longer matches the
 * new build — so they are reviewable without a packaged app. */
export default function LoadingPreview() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state") ?? "loading";
  if (state === "handoff") {
    return <HandoffPreview />;
  }
  if (state === "connect" || state === "connecting") {
    return <ConnectScreen apiBase="https://app.wrazyos.com" setApiBase={() => undefined} connecting={state === "connecting"} onConnect={() => undefined} onSave={async () => undefined} />;
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
  return <FirstLightSurface stage={BOOT_STAGE_COPY.day} />;
}

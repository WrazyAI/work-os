import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isMacOS } from "./platform";
import type { AppMenuGroup } from "./AppMenuBar";
import { NATIVE_MENU_EVENT, nativeMenuModel } from "./nativeMenuModel";

/** Keeps the macOS menu bar in step with the in-window menu. Windows has no
 * native menu bar in this app, so the component renders nothing there. */
export default function NativeAppMenu({ groups }: { groups: AppMenuGroup[] }) {
  const actions = useRef(new Map<string, () => void>());
  const model = nativeMenuModel(groups);
  const signature = JSON.stringify(model.groups);

  useEffect(() => {
    actions.current = model.actions;
  });

  useEffect(() => {
    if (!isTauri() || !isMacOS()) return;
    void invoke("sync_app_menu", { groups: model.groups }).catch(() => undefined);
    // The signature covers every label, check, and enabled state; rebuilding
    // for anything else would reset an open native menu for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (!isTauri() || !isMacOS()) return;
    let stop: (() => void) | undefined;
    void listen<string>(NATIVE_MENU_EVENT, (event) => {
      actions.current.get(event.payload)?.();
    }).then((unlisten) => {
      stop = unlisten;
    }).catch(() => undefined);
    return () => stop?.();
  }, []);

  return null;
}

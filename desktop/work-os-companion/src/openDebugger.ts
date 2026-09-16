import { invoke, isTauri } from "@tauri-apps/api/core";

/** Opens the Work OS diagnostics window. Invoked by the main window only; the
 * diagnostics window itself imports ./diagnostics, so keeping this separate
 * keeps the ACL surface of each window honest. */
export async function openDebuggerWindow() {
  if (!isTauri()) {
    window.open("/debug.html", "work-os-debugger", "popup,width=1180,height=780");
    return;
  }
  await invoke("open_debug_window");
}

; ─────────────────────────────────────────────────────────────────────────
; Work OS Companion NSIS installer hooks.
;
; The companion deliberately hides to the tray (and keeps its floating orb on
; screen) instead of quitting when its window closes, so it commonly owns a
; lock on work-os-companion.exe while Setup runs. Tauri's built-in
; CheckIfAppIsRunning prompts before the file copy, but a silent/update run
; skips the prompt and a surviving process makes the copy fail with
; "Error writing to file: work-os-companion.exe".
;
; These hooks run before the built-in check and the file copy (and before the
; uninstaller deletes files): force-close every running instance, wait for the
; image to be released, and abort with a clear message if it stays locked.
; ─────────────────────────────────────────────────────────────────────────

!include "LogicLib.nsh"

!macro WKOS_CLOSE_COMPANION
  ; ${__LINE__} differs per expansion, so both hooks can share this macro.
  !define WKOS_UNIQUE ${__LINE__}
  StrCpy $R9 0
  wkostry_${WKOS_UNIQUE}:
    !if "${INSTALLMODE}" == "currentUser"
      nsis_tauri_utils::FindProcessCurrentUser "work-os-companion.exe"
    !else
      nsis_tauri_utils::FindProcess "work-os-companion.exe"
    !endif
    Pop $R8
    ${If} $R8 == 0
      !if "${INSTALLMODE}" == "currentUser"
        nsis_tauri_utils::KillProcessCurrentUser "work-os-companion.exe"
      !else
        nsis_tauri_utils::KillProcess "work-os-companion.exe"
      !endif
      Sleep 500
      IntOp $R9 $R9 + 1
      ${If} $R9 < 10
        Goto wkostry_${WKOS_UNIQUE}
      ${EndIf}
      IfSilent wkosquiet_${WKOS_UNIQUE}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Work OS Companion is still running and could not be closed automatically. Right-click the companion icon in the system tray and choose Quit (or end work-os-companion.exe in Task Manager), then run this installer again."
      wkosquiet_${WKOS_UNIQUE}:
      Abort
    ${EndIf}
  !undef WKOS_UNIQUE
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WKOS_CLOSE_COMPANION
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WKOS_CLOSE_COMPANION
!macroend

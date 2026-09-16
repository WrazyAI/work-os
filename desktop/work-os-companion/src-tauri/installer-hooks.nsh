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
; uninstaller deletes files). Closing escalates through an explicit ladder so
; a wedged, hung, or elevated process can no longer strand an install with a
; half-uninstalled copy of the app:
;
;   1. find/kill the running instance bound to the current user (fast path),
;   2. find/kill machine-wide (same-user processes outside this session),
;   3. taskkill /F /T (belt & braces; /T also reaps WebView2 children),
;   4. rename-then-continue: Windows allows renaming a running executable, so
;      moving work-os-companion.exe aside releases the copy path even when the
;      process refuses to die; the renamed survivor is removed at next reboot.
;
; Only when even a rename fails (file-system level lock) do we abort with the
; manual-close guidance.
;
; nsis_tauri_utils result conventions: FindProcess* pushes 0 when the process
; is found (1 when absent); KillProcess* pushes 0 when every matching process
; was terminated, 1 when at least one survived, and 2 when none was found.
; Every plugin result is popped so the parameter stack stays clean.
; ─────────────────────────────────────────────────────────────────────────

!include "LogicLib.nsh"

!macro WKOS_CLOSE_COMPANION
  !define WKOS_UNIQUE ${__LINE__}
  StrCpy $R9 0

  ; Ladder 1: current-user find/kill, the fast normal path. Up to 10 attempts
  ; with a beat between them so the image can be released before we re-check.
  wkostry1_${WKOS_UNIQUE}:
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
      Pop $R7
      Sleep 500
      IntOp $R9 $R9 + 1
      ${If} $R9 < 10
        Goto wkostry1_${WKOS_UNIQUE}
      ${EndIf}
    ${EndIf}

  ; Ladder 2: machine-wide find/kill — catches processes the current-user
  ; filter cannot see (same user in another session).
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcess "work-os-companion.exe"
    Pop $R8
    ${If} $R8 == 0
      nsis_tauri_utils::KillProcess "work-os-companion.exe"
      Pop $R7
      Sleep 1000
    ${EndIf}
  !endif

  ; Ladder 3: taskkill force-kill. OpenProcess/TerminateProcess from the
  ; plugin also services hung processes, so this mirrors it rather than
  ; adding a class of kills; it does add /T, which takes the orphaned
  ; WebView2 helper processes down with their host.
  nsis_tauri_utils::FindProcess "work-os-companion.exe"
  Pop $R8
  ${If} $R8 == 0
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "work-os-companion.exe"'
    Pop $R7
    Sleep 1000
  ${EndIf}

  ; Ladder 4: rename the still-running executable aside and continue. The
  ; file content stays mapped to the surviving process, so nothing
  ; user-visible breaks; the renamed copy is deleted at next reboot and the
  ; installer can write a fresh work-os-companion.exe over the freed path.
  nsis_tauri_utils::FindProcess "work-os-companion.exe"
  Pop $R8
  ${If} $R8 == 0
    ; Runtime-unique survivor name: the timer wraps after ~49 days, so pair
    ; it with this installer's own process id — PIDs are effectively unique
    ; across runs, deleting the previous run's leftover at reboot keeps the
    ; directory tidy, and a failed-cleanup collision lands in the existing
    ; rename-error branch rather than overwriting a mapped file.
    System::Call 'kernel32::GetTickCount()l.r0'
    System::Call 'kernel32::GetCurrentProcessId()i.r1'
    StrCpy $R0 "$INSTDIR\work-os-companion.exe.old-$R0-$R1"
    Delete /REBOOTOK "$R0"
    ClearErrors
    Rename "$INSTDIR\work-os-companion.exe" "$R0"
    ${If} ${Errors}
      ClearErrors
      ; The rename failed, so the path is still owned by a locked file and
      ; the fresh copy cannot be written. Escalate to the manual guidance.
      IfSilent wkosquiet_${WKOS_UNIQUE}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Work OS Companion is still running and could not be closed automatically. Right-click the companion icon in the system tray and choose Quit (or end work-os-companion.exe in Task Manager), then run this installer again."
      wkosquiet_${WKOS_UNIQUE}:
      Abort
    ${EndIf}
    Delete /REBOOTOK "$R0"
    DetailPrint "A stopped Work OS Companion kept running; its old copy will finish exiting on the next restart."
  ${EndIf}
  !undef WKOS_UNIQUE
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WKOS_CLOSE_COMPANION
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WKOS_CLOSE_COMPANION
!macroend

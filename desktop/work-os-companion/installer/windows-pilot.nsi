Unicode True
!include "MUI2.nsh"
!cd ".."

!define PRODUCT_NAME "Work OS Companion"
!define PRODUCT_VERSION "0.2.7"
!define PRODUCT_PUBLISHER "WrazyOS"
!define PRODUCT_EXE "Work OS Companion.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\WrazyOSWorkOSCompanion"

Name "${PRODUCT_NAME}"
OutFile "../../downloads/work-os-companion-0.2.7-unsigned-phase1-reliability-setup.exe"
InstallDir "$LOCALAPPDATA\WrazyOS\Work OS Companion"
InstallDirRegKey HKCU "Software\WrazyOS\WorkOSCompanion" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetOverwrite on
Icon "src-tauri\icons\icon.ico"
UninstallIcon "src-tauri\icons\icon.ico"
VIProductVersion "0.2.7.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright WrazyOS"
VIAddVersionKey "FileDescription" "WrazyOS employee companion"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"

!define MUI_ICON "src-tauri\icons\icon.ico"
!define MUI_UNICON "src-tauri\icons\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Run Work OS Companion"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; Windows locks a running executable. Stop an existing companion before NSIS
  ; attempts to replace it; taskkill returns a non-zero code when none exists,
  ; which is intentionally harmless for a first install.
  nsExec::ExecToLog 'taskkill /IM "Work OS Companion.exe" /T /F'
  nsExec::ExecToLog 'taskkill /IM "work-os-companion.exe" /T /F'
FunctionEnd

Section "Install" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "/oname=${PRODUCT_EXE}" "src-tauri\target\x86_64-pc-windows-gnu\release\work-os-companion.exe"
  File "src-tauri\target\x86_64-pc-windows-gnu\release\WebView2Loader.dll"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\WrazyOS"
  CreateShortcut "$SMPROGRAMS\WrazyOS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"

  WriteRegStr HKCU "Software\WrazyOS\WorkOSCompanion" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Classes\wrazy-workos" "" "URL:WrazyOS Work OS Companion"
  WriteRegStr HKCU "Software\Classes\wrazy-workos" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\wrazy-workos\DefaultIcon" "" "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr HKCU "Software\Classes\wrazy-workos\shell\open\command" "" '$\"$INSTDIR\${PRODUCT_EXE}$\" $\"%1$\"'

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\WrazyOS\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\WrazyOS"
  DeleteRegKey HKCU "Software\Classes\wrazy-workos"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\WrazyOS\WorkOSCompanion"
  Delete "$INSTDIR\${PRODUCT_EXE}"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd

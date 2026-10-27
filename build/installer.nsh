!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
  Pop $R0
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "flameshot.exe" /T`
  Pop $R0
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { ($$_.Name -ieq 'OpenFlow.exe') -or ($$_.Name -ieq 'flameshot.exe') -or ($$_.CommandLine -match 'chord\.ps1|unmute\.ps1|paste\.ps1|micrepair') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $R0
  RMDir /r "$LOCALAPPDATA\openflow-updater"
  Sleep 800
!macroend

!macro customFinishPage
  Function StartApp
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--installed"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_CHECKED
  !define MUI_FINISHPAGE_RUN_TEXT "Open OpenFlow"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    !ifdef APP_PACKAGE_URL
      !ifndef OPENFLOW_DOWNLOAD_OVERRIDE
        !define OPENFLOW_DOWNLOAD_OVERRIDE
        !macroundef downloadApplicationFiles
        !include "${BUILD_RESOURCES_DIR}\nsis\webPackage.nsh"
      !endif
    !endif
  !endif
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=OpenFlow-stop.ps1 "${BUILD_RESOURCES_DIR}\stop-openflow.ps1"
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\OpenFlow-stop.ps1" -InstallDirectory "$INSTDIR"`
  Pop $R0
  SetOutPath "$INSTDIR"
  Sleep 300
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

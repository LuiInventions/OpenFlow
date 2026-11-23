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

# No finish page: its full-window layout looked like the installer starting over
# and required another click before OpenFlow opened. Instead the installer closes
# itself after a successful install and opens OpenFlow directly.
!macro customFinishPage
!macroend

!macro customInstall
  ${IfNot} ${Silent}
    SetAutoClose true
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--installed"
  ${EndIf}
!macroend

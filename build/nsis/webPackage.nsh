# Project override of electron-builder webPackage.nsh.
!macro downloadApplicationFiles
  Var /GLOBAL packageUrl
  Var /GLOBAL packageArch

  StrCpy $packageUrl "${APP_PACKAGE_URL}"
  StrCpy $packageArch "${APP_PACKAGE_URL}"

  !ifdef APP_PACKAGE_URL_IS_INCOMPLETE
    !ifdef APP_64_NAME
      !ifdef APP_32_NAME
	    	!ifdef APP_ARM64_NAME
	  		  ${if} ${IsNativeARM64}
	          StrCpy $packageUrl "$packageUrl/${APP_ARM64_NAME}"
	        ${elseif} ${IsNativeAMD64}
	          StrCpy $packageUrl "$packageUrl/${APP_64_NAME}"
	        ${else}
	          StrCpy $packageUrl "$packageUrl/${APP_32_NAME}"
	        ${endif}
		    !else
	        ${if} ${IsNativeAMD64}
	          StrCpy $packageUrl "$packageUrl/${APP_64_NAME}"
	        ${else}
	          StrCpy $packageUrl "$packageUrl/${APP_32_NAME}"
	        ${endif}
	     	!endif
      !else
        StrCpy $packageUrl "$packageUrl/${APP_64_NAME}"
      !endif
    !else
      StrCpy $packageUrl "$packageUrl/${APP_32_NAME}"
    !endif
  !endif

  ${if} ${IsNativeARM64}
    StrCpy $packageArch "ARM64"
  ${elseif} ${IsNativeAMD64}
    StrCpy $packageArch "64"
  ${else}
    StrCpy $packageArch "32"
  ${endif}

  Var /GLOBAL downloadAttempt
  StrCpy $downloadAttempt 0
  download:
  IntOp $downloadAttempt $downloadAttempt + 1
  DetailPrint "Downloading OpenFlow (attempt $downloadAttempt)..."
  # Let short interruptions recover inside INetC; do not show its separate
  # resume/cancel prompt before our automatic retry policy has run.
  inetc::get /CONNECTTIMEOUT 30 /RECEIVETIMEOUT 30 /USERAGENT "OpenFlow Installer (Mozilla)" /HEADER "X-Arch: $packageArch" "$packageUrl" "$PLUGINSDIR\package.7z" /END
  Pop $0
  ${if} $0 == "Cancelled"
    SetErrorLevel 1223
    Quit
  ${endif}
  ${if} $0 != "OK"
    ${if} $downloadAttempt < 4
      DetailPrint "Connection interrupted. Retrying in this installer..."
      Sleep 1500
      Goto download
    ${endif}
    # Keep system proxy settings during retries. Only try direct access once.
    inetc::get /NOPROXY /CONNECTTIMEOUT 30 /RECEIVETIMEOUT 30 /USERAGENT "OpenFlow Installer (Mozilla)" /HEADER "X-Arch: $packageArch" "$packageUrl" "$PLUGINSDIR\package.7z" /END
    Pop $0
  ${endif}
  ${if} $0 == "Cancelled"
    SetErrorLevel 1223
    Quit
  ${elseif} $0 != "OK"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "The download could not finish (status: $0).$\r$\n$\r$\nCheck your connection, then choose Retry to continue here. You do not need to restart the installer." /SD IDCANCEL IDRETRY retry_download
    SetErrorLevel 1
    Quit
    retry_download:
      StrCpy $downloadAttempt 0
      Goto download
  ${endif}

  StrCpy $packageFile "$PLUGINSDIR\package.7z"
!macroend

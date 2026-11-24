# OpenFlow 1.5.37 release verification

Checked on 2026-11-24, based on GitHub main at `10228ad` (1.5.36).

- Expanded bubble: 30 px high, with 3 px vertical padding around 24 px buttons. Action icons remain 17 px. The collapsed, listening and working states retain their existing dimensions.
- Dictation settings menu: 114 × 79 px. Light and dark menu styles, custom command icons and the voice-note extension were checked in Electron.
- Settings: Style immediately follows Dictation. Its box is 475 × 64 px and its switch is 48 × 26 px in the standard window, matching Dictation Sounds. The heading, labels, description and accessible switch name are all English.
- The real settings click saves the appearance, updates open windows, and survives a renderer reload. Newly opened note and history windows use the saved appearance. Invalid theme values are ignored; switching back to Light works.
- 111 automated tests pass. The packaged helper regression passes all 120 script deployments from the actual ASAR.
- Both installers use the same packaged application. All packaged and installed Electron, renderer and source files match the source, including the new theme resources.
- Silent per-user installation succeeds. Windows Startup apps receives the quoted OpenFlow executable path from the installer; uninstall removes that installation's entry.
- The application archive passes the 7-Zip integrity check. Its trailing data is the expected embedded differential block map.
- `latest.yml` names version 1.5.37 and the correct stub and application archive. Its SHA-512 digests and archive size match the final artifacts. `SHA256SUMS.txt` covers both installers, the archive and update metadata.

## Release assets

| File | Bytes |
| --- | ---: |
| OpenFlow-Setup-1.5.37.exe | 679,578 |
| openflow-1.5.37-x64.nsis.7z | 118,183,082 |
| OpenFlow-Setup-1.5.37-local.exe | 118,612,107 |
| latest.yml | 567 |
| SHA256SUMS.txt | 361 |

Release destination: https://github.com/LuiInventions/OpenFlow/releases/tag/v1.5.37

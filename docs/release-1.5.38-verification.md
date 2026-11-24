# OpenFlow 1.5.38 release verification

Checked on 2026-11-24, based on GitHub main at `4862442`.

- Reproduced the formatting failure before the fix: the second Bold click at a collapsed caret still reported Bold enabled.
- The editor now keeps its live selection instead of clearing and restoring the same range on every toolbar click. Chromium's pending typing style survives, and its command state determines the selected toolbar button.
- `npm run verify:note-format` passes 72 formatting transitions across standalone and embedded note editors: six successive clicks for Bold, Italic and Underline, both at a caret and with selected text. Selected text remains selected. Text typed after switching Bold off is plain.
- The same Electron check verifies a black formatting-toolbar background (`rgb(0, 0, 0)`) and readable labels in Dark mode. The active and hover backgrounds were adjusted for the black toolbar.
- Fresh profiles and older profiles without a saved appearance start in Dark mode. The renderer's initial fallback and native window appearance also default to Dark. A saved Light choice survives restart.
- The actual Settings IPC check verifies the initial Dark default, the Light / Dark switch, appearance persistence, reload, live updates, new note/history windows and invalid-value rejection.
- All 112 automated tests pass. The packaged helper check passes 120 script deployments from the actual ASAR.
- The README contains only the latest release section, 1.5.38.
- Both installers use the same packaged application. All packaged and installed runtime files match the source. Silent installation returned exit code 0; the installed version is 1.5.38.0 and the local saved appearance is Dark.
- The application archive passes the 7-Zip integrity check, with the expected trailing embedded block map. The update metadata's SHA-512 digests and package size match the final files. SHA256SUMS.txt covers both installers, the application archive and latest.yml.
- Release assets: 679,662-byte stub; 118,183,973-byte application archive; 118,612,946-byte full installer; 567-byte update metadata; 361-byte checksum file.

Release destination: https://github.com/LuiInventions/OpenFlow/releases/tag/v1.5.38

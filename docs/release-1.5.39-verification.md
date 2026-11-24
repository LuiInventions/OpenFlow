# OpenFlow 1.5.39 release verification

Checked on 2026-11-24, based on GitHub main at `7f71b82`.

- The pending note-improvement request displays a 44 × 44 px white star, with no visible text, button, background, border or box shadow. It is centred over the note and floats on a 3.2-second cycle.
- The original note stays visible below the 7 px blur. The rich editor is inert and non-editable while processing, then becomes editable after either a successful response or an error. These transitions were exercised with controlled requests, without using a real API key.
- Electron checks cover standalone and embedded notes in both Light and Dark. Screenshots of all four combinations were inspected. Reduced-motion emulation disables the star's animation.
- The Light palette was compared with 1.5.36 from Git, including cream backgrounds, warm grey borders and text shades. The Dark palette was compared with 1.5.38 and is unchanged.
- All 112 automated tests pass. The 72 formatting-toggle checks and the Settings persistence/cross-window appearance check also pass.
- The README contains only the latest release section, 1.5.39.
- Both installers use the same packaged application. All packaged and installed runtime files match the source. Silent installation returned exit code 0; the installed version is 1.5.39.0. The packaged helper check passes 120 script deployments from the ASAR.
- The application archive passes the 7-Zip integrity check, with the expected embedded block map. The update metadata's SHA-512 digests and archive size match the artifacts. SHA256SUMS.txt covers both installers, the application archive and latest.yml.
- Release assets: 679,578-byte stub; 118,183,275-byte application archive; 118,612,268-byte full installer; 567-byte update metadata; 361-byte checksum file.

Release destination: https://github.com/LuiInventions/OpenFlow/releases/tag/v1.5.39

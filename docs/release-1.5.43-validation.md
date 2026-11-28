# OpenFlow 1.5.43 validation

Work started from a fresh GitHub clone of v1.5.42 (4cba503).

## Screenshot reliability

- Removed the fixed 800 ms request cooldown. The request ends when selection is confirmed, and Bubble bounds received while hidden are applied on restore.
- Moved screenshot requests to a separate named pipe, so a blocked paste request cannot delay or consume them. Unavailable connections are retried briefly; a delivered request is never blindly resent because of a lost reply.
- The native helper reports success only after finding a visible Flameshot selection window belonging to the verified executable/session. If a reply disappears, OpenFlow checks window state before launching a fallback. The fallback also verifies selection and prepares the resident daemon again after a crash.

Measured on this Windows desktop using the actual Bubble element handler/IPC and alternating renderer mouse input. A native observer checks the visible selection window and its process ID. Each capture is dismissed and reopened while retaining the daemon, rather than restarting it after every measurement. Only test-owned windows/processes are closed.

| Scenario | Successful starts | Selection visible |
| --- | ---: | --- |
| Source, repeated close/reopen | 30/30 | 142–213 ms |
| Source, paste channel occupied, daemon terminated before click 11 | 30/30 | 141–301 ms |
| Packaged code/runtime, occupied paste channel and daemon termination | 30/30 | 127–254 ms |
| Packaged code/runtime, alternating Close and Escape cancellation | 20/20 | 141–198 ms |
| Forced GUI fallback | 5/5 | 286–465 ms |
| Native helper unavailable | 5/5 | 286–414 ms |
| Native message deliberately dropped | 2/2 | 1,411–1,559 ms, verified fallback |
| Native reply deliberately dropped | 5/5 | 142–171 ms, no second GUI process |

These are desktop measurements, not a hardware-independent guarantee. The fault-injection variants modify only the test profile's deployed helper copy. Selection images are kept locally because they show desktop content.

## Other checks

- `npm test`: 120 passing tests, including native helper compilation, immediate re-entry after capture readiness, duplicate-click coalescing while starting, verified fallback failure/retry, and daemon cleanup.
- `verify:settings`: eight Light/Dark, width and model-installation combinations. Removed Elements are white with black text, no SVG symbols or plus badges, symmetric padding and retained restoration/drag attributes. Model speed labels are 5,9× and 26,0×, with 18% and 80% bars on the same scale.
- `verify:package`: renderer, Electron and source files match the checkout; bundled Flameshot/Qt and Sherpa native runtimes are present. Unpacked application size: 410.67 MiB.
- Both installers and the previous release's other three asset types are built and hash-checked by the Windows release workflow before publication.

# OpenFlow 1.5.42 validation

The source was freshly cloned from GitHub at v1.5.41 (e808307). Existing local work was not included.

- `npm test`: 118 passing tests, including native shortcut compilation and six screenshot-controller tests (native dispatch, CLI fallback, daemon failure, repeated clicks, launch failure, shutdown).
- `verify:settings`: eight combinations of Light/Dark, 820/720-pixel content widths, and installed/uninstalled Parakeet. Both model cards end 13 pixels below Multilingual without clipping. Removed items use #10b981, equal horizontal padding and no plus badge; restoration/drag attributes are retained.
- `verify:screenshot`: activates the real screenshot element handler and IPC. A separate read-only Win32 observer checks for a visible native Flameshot capture window larger than 300 pixels in both dimensions. Timing starts immediately before activation. Each sample closes only test-owned processes; the next sample restarts the daemon, also checking changed-PID recovery.
- Baseline v1.5.41: **2,397 ms**. Revised source: **246, 175, 179 ms**. Packaged application source and bundled Flameshot: **364, 205, 221 ms**. These are measurements on this Windows desktop, not a hardware-independent guarantee. Native capture images were inspected locally; they are excluded from the repository because they show the desktop.
- `verify:package`: all packaged renderer, Electron and source files match the checkout; Flameshot/Qt and Sherpa native runtimes are present; package size is 410.76 MiB.
- `verify:script-copy`: 120 exact PowerShell script deployments from the real ASAR with Electron's temporary extraction path deliberately disabled.

The native fast path targets Flameshot 14's existing `WM_HOTKEY` handler on its Qt main thread. It verifies the process session and executable (byte-identical bundled copies are accepted for Flameshot's session singleton), caches the thread, and sends no global keyboard input. If unavailable, `flameshot.exe gui` remains the fallback.

Implementation references: [Flameshot 14 GlobalShortcutFilter](https://github.com/flameshot-org/flameshot/blob/v14.0.0/src/core/globalshortcutfilter.cpp), [Qt Windows event dispatcher](https://github.com/qt/qtbase/blob/6.8/src/corelib/kernel/qeventdispatcher_win.cpp).

The local NSIS compiler could not load a system DLL in the restricted Windows environment. The included GitHub Actions workflow builds both installers on a Windows runner, checks package contents, and stages exactly the previous release's five asset types with verified update hashes and SHA-256 checksums. Publishing remains separate from the build.

# OpenFlow 1.5.27 release verification

Checked on 2026-11-01.

- GPT-5.4 nano is the default for fresh profiles, unsupported saved models, text-completion calls without an explicit selection, and API-key verification.
- A one-time migration changes old default-Luna profiles to Nano. Subsequent explicit Luna/Sol choices survive restarts. No transcript, note content, historical model or stored cost is rewritten by migration.
- 89 automated tests pass, including default selection, migration/reload, per-model cached-token pricing, stored-cost invariance and model changes during pending jobs.
- The Electron regression checks the automatic Nano selection, all three model options, shared setting persistence, heading style, stationary arrow, key gating and stable menu bounds.
- Polish retains its approved prompt and request wrapper. Compact prompt version `2026-11-01.5` adds an English example and explicit language/time-notation preservation; its input wrapper avoids German-language bias for English dictations.
- Both the web/stub installer and full local installer are built with publishing disabled, checked, then attached to a draft GitHub release before publication.

- A real installed-Nano test initially returned a German translation of English content and converted 2 pm to 14:00. The existing validator rejected it and kept the original. Publication was held while this was corrected.
- After the prompt/wrapper refinement, live Nano tests preserve English and German dictation, names, numbers, negation and exact 2 pm / 9:15 am notation. English note improvement also retains its language and deadline.

## Final checks

- Web installer: 685,771 bytes. Application archive: 440,375,370 bytes. Full installer: 440,474,650 bytes.
- Web update metadata sizes and SHA-512 digests match the final artifacts. The 7z integrity test passes. SHA256SUMS.txt covers both installers, the archive and latest.yml.
- All 39 packaged runtime files match the source in both variants. All 39 installed runtime files match after a silent per-user upgrade (exit code 0).
- The installed application reports version 1.5.27 and automatically selects Nano. All three model selections work. Compact prompt version 2026-11-01.5 and unchanged Polish prompt version 2026-11-01.2 are present.
- A real completion through installed Nano returns “Send report to Alice by Friday at 2 pm.” without fallback, translation or changed time notation.
- All eight live Nano fixtures pass the configured compression and protected-detail checks. English note improvement also retains its language and deadline.
- 36 historical usage/version records retain their original model, cost and token counts after upgrading and switching models.

Release destination: https://github.com/LuiInventions/OpenFlow/releases/tag/v1.5.27

# OpenFlow 1.5.25 — Compact Dictation verification

Verified locally on 2026-11-01. No release was published.

## Prompt and runtime

- Compact uses the exact user-approved Caveman-style prompt, version `2026-11-01.4`, exported in `dictation-compact-system-prompt.txt`.
- Polish keeps its previous system prompt byte-for-byte and prompt version `2026-11-01.2`.
- Menu order remains Original, Polish dictation, Compact dictation.
- `npm test`: 83 passing tests. The added fixture test runs terse accepted outputs through the real validation, history and paste pipeline, including empty noise, a genuine question and protected details. It confirms these outputs do not fall back to padded originals.
- The isolated Electron UI regression passes: key gating, menu selection, processing indicator and reduced motion; twelve consecutive selections cause zero hidden frames, native resizes or icon reinsertions.

## Live comparison

The old Compact prompt, new Compact prompt and unchanged Polish prompt processed the same seven synthetic German/English fixtures through the real GPT-6 Luna API path. A saved key was used without printing it. No private dictation was submitted.

New Compact passed every fixture: polite requests, repetition, factual uncertainty, conditions, negation, genuine ability questions, exact code/quotes/URLs/email/numbers, already minimal text and noise. Compression bounds are specific to deliberately padded fixtures; there is no global production ratio threshold.

| Fixture | Input characters | Old Compact | New Compact | Polish |
| --- | ---: | ---: | ---: | ---: |
| german-request | 132 | 64 | 43 | 87 |
| english-request | 153 | 71 | 39 | 95 |
| german-conditions | 137 | 109 | 74 | 139 |

Across those three padded examples, the input had 422 characters. Old Compact produced 244 characters; new Compact produced 156. These are observed character counts from one run, not universal reduction, token-cost or semantic-equivalence guarantees.

German request:

> Ähm, ich wollte dich nur kurz bitten, bitte schick den Bericht morgen bis 14 Uhr an Anna. Also bitte morgen bis 14 Uhr. Vielen Dank!

Old Compact:

> Bitte schick den Bericht morgen bis 14 Uhr an Anna. Vielen Dank!

New Compact:

> Bericht morgen bis 14 Uhr an Anna schicken.

## README image

The image combines a fresh screenshot of the actual floating bubble/menu with the exact accepted English live-completion example. It was rendered at 1200 × 480 CSS pixels (2400 × 960 PNG), checked for overflow and visually inspected. The README explains the more radical style and links the Caveman source principles.

## Build and installation

The local NSIS build completed using `npm run dist:local` with publishing disabled. `release-local/OpenFlow-Setup-1.5.25-local.exe` is 440,475,062 bytes; its SHA-256 is saved alongside it. All 39 packaged runtime files match the current source. The silent per-user installer returned exit code 0. All 39 installed runtime files match the source. The installed executable reports version 1.5.25, Compact prompt version `2026-11-01.4`, unchanged Polish prompt version `2026-11-01.2`, and menu order Original / Polish / Compact. A real completion through the installed runtime returned “Send report to Alice by Friday at 2 pm.” without fallback or polite wrappers. The application was then restarted normally with `--installed` for manual testing.

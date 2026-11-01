# Improve Dictation modes

OpenFlow 1.5.26 offers three choices in the floating bubble:

| Mode | Behavior |
| --- | --- |
| Original (`raw`) | Keep the prepared transcript without an AI rewrite. |
| Polish dictation (`polished`) | Keep the existing grammar correction and natural phrasing behavior. |
| Compact dictation (`compact`) | Remove verbal padding and pleasantries, merge repeated facts, and use direct actions and compact fragments while keeping distinct information. |

Compact uses `COMPACT_SYSTEM` from `src/dictation-cleanup.js`. The exact user-approved Caveman-style prompt is exported in `dictation-compact-system-prompt.txt`. It uses prompt version `2026-11-01.5`. The previous conservative Compact prompt is replaced. Polish retains `POLISH_SYSTEM`, its previous version and validation behavior; its exact prompt remains in `dictation-polish-system-prompt.txt`.

## Settings and migration

The Improve Dictation switch remains API-only and requires a verified key. Enabling it in onboarding selects Compact when the previous choice was Original. Existing Polish selections are preserved. Disabling the feature selects Original and cancels pending work.

Profiles containing the removed `fillers` selection migrate to `compact` on load. A disabled feature stays disabled. Historical transcripts and usage rows are retained without rewriting their recorded mode. The former mode is unavailable through the menu, settings IPC or processing path. Its prompt is no longer shipped. Legacy usage estimates retain the old 261-token prompt overhead so historical cost estimates do not change.

## Processing

Each piece uses one selected prompt and the shared selected text-model completion path. No preliminary rewrite is performed. Long input retains the existing 6,000-character pieces, two-request concurrency, separators, order and timeout. Changing the mode or disabling the feature discards late responses. Processing failures retain the original transcript; pasting still happens at most once into the original target.

Compact accepts only a JSON object containing exactly one string field, `text`. It has no minimum output/input length ratio. Local checks protect numbers, URLs, email addresses, image placeholders, negations, uncertainty expressions, literal code and quoted text. Empty output is permitted only for recognized noise-only input. These checks detect specific failures; semantic completeness, names and logical relationships also depend on the supplied model instructions.

Consumed tokens are recorded before output validation, including rejected and cancelled responses. Compact usage is included in the existing Note & Dictation API report.

## Compression style

The user-approved prompt adapts the compression principles in [ultracave](https://github.com/JuliusBrussee/caveman/blob/main/skills/ultracave/SKILL.md) and [caveman-compress](https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman-compress/SKILL.md). Pleasantries such as “bitte” and “could you please” are expendable; their actual request stays as a short action. Genuine questions, negations and uncertainty remain meaningful. There is no global minimum reduction percentage. Live quality fixtures use case-specific bounds to detect regressions on deliberately padded examples.

For the Nano default, Compact also includes an English example and explicitly preserves the dictated language and literal time notation. Its input wrapper is language-neutral English; Polish retains its original wrapper and prompt. This addresses a real Nano response that translated English content and converted 2 pm to 14:00, which validation correctly rejected.

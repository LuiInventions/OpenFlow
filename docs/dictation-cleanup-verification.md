# OpenFlow 1.5.20 verification

Verified locally on 2026-11-01. Nothing was published.

- 70 automated tests pass, including real-completion key gating, rejected/unfunded keys, concurrent verification, stale key responses, mode persistence, polish prompt selection, cancellation, code/negation/uncertainty protection and ordered two-piece concurrency.
- Packaged runtime matches all 39 source/runtime files.
- Electron UI tests pass with isolated mocked credentials. Both (API only) labels remain visible, invalid credentials disable both switches, three menu choices persist, and 12 selections produce no hidden frames, resizes or moved icons.
- The AI indicator uses the note-improvement sparkle, subtle vertical movement and staggered glints. Reduced-motion mode disables its animation. Original dictation retains the ordinary spinner.
- The saved user key successfully completed a real GPT-6 Luna verification request from the installed application. No key or private dictation was recorded in the verification output.

## Live latency samples

Synthetic German and English dictations were processed through the installed application runtime. The comparison uses the previous temperature/retry request shape versus the compatible current request shape, with the same model, task prompt and effective medium reasoning effort. These small samples are observations, not a latency SLA or a universal quality guarantee. They exclude speech recognition and pasting.

| Sample | Previous request shape | Current request shape | HTTP requests |
| --- | ---: | ---: | --- |
| German clean | 1842 ms | 931 ms | 2 → 1 |
| English clean | 1471 ms | 1185 ms | 2 → 1 |
| German polish | 1681 ms | 2437 ms | 2 → 1 |
| English polish | 1369 ms | 1233 ms | 2 → 1 |

Both clean outputs were identical between request shapes. All outputs passed the existing detail checks. The slower German polish observation illustrates that avoiding a network round trip does not guarantee a faster model response in every case.

## Live distinction between the two levels

German input: “Ähm, wir hat den Bericht fertig gemacht und ich wollte jetzt nur einmal kurz sagen, dass ich schicke ihn morgen um 14 Uhr an Anna. Bitte nicht vorher senden.”

- Clean: “Wir hat den Bericht fertig gemacht und ich wollte jetzt nur einmal kurz sagen, dass ich schicke ihn morgen um 14 Uhr an Anna. Bitte nicht vorher senden.”
- Polish: “Wir haben den Bericht fertig gemacht. Ich wollte nur kurz sagen, dass ich ihn morgen um 14 Uhr an Anna schicke. Bitte nicht vorher senden.”

English input included “we was finishing” and “I sends it to Alice tomorrow at 2 PM”. Clean retained the spoken grammar; Polish changed these to “We were finishing” and “I will send it to Alice tomorrow at 2 PM”. The instruction “Please do not send it earlier” stayed intact in both outputs.

The exact active polish prompt is exported in `dictation-polish-system-prompt.txt` and defined by `POLISH_SYSTEM` in `src/dictation-cleanup.js`.

# AI improvements onboarding — OpenFlow 1.5.21

The AI improvements step follows the speech-engine setup and replaces the previous notes-only onboarding. Existing installations see it once; the `aiFeaturesOnboardingDone` flag prevents it from returning after completion.

- Improve Notes and Improve Dictation have independent switches with the persistent `(API only)` labels.
- A working key from the speech-engine step is reused. If no working key is available, both switches are disabled and a password field with Save key appears in the same dialog.
- Saving an invalid key retains the input and shows the existing failure message. Successful verification removes the field and enables the switches without displaying an API key verified message.
- Enabling cleanup in onboarding selects Clean dictation when the previous mode was Original, so turning it on has an immediate effect. Existing Polish dictation selections are preserved.
- Continue without a key completes the optional step without enabling improvements. Continuing during automatic verification preserves existing saved preferences.
- Key entry works with Enter; draft input survives background settings refreshes. A completed step stays completed across restart.

The Dictation settings popup now fits its longest label instead of using a fixed 174-pixel width. Each checkmark follows its own label with a 6-pixel gap. The popup remains centered over the arrow, with unchanged native bounds during selection.

Validation: 70 existing automated tests, the Electron menu/key-gating regression test, and dedicated onboarding scenarios for local/cloud setup, invalid/valid keys, key reuse, independent switches, restart persistence, existing preferences, early Continue and keyless Continue. All pass on the local source. Packaged verification is also run before installation.

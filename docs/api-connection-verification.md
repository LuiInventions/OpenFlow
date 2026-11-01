# API connection verification (v1.5.24)

The transport fix was verified in v1.5.23 on the affected Windows machine using the saved key in an isolated profile. Compact and Polish were rechecked through the same transport in v1.5.24. The key itself was never logged.

- Node fetch: `SELF_SIGNED_CERT_IN_CHAIN`, before receiving an HTTP response.
- Electron Chromium `net.fetch`: HTTP 200 with a successful model completion using the same key and verification payload.
- Updated app: the saved key became valid; both Compact dictation and Polish dictation successfully processed a synthetic dictation while preserving the person, time and negation.

OpenAI requests in the main process use `net.fetch`, including verification, note/dictation improvements, speech recognition and speech output. TLS certificate validation stays enabled. There is no insecure certificate callback or disabled verification.

Verification retries one temporary network/server/incomplete-response failure. A saved key can be rechecked through Retry in Settings and onboarding. Temporary unavailability keeps the saved feature preferences while disabling API switches until the key is verified.

References: [Electron net](https://www.electronjs.org/docs/latest/api/net/), [OpenAI error handling](https://developers.openai.com/api/docs/guides/error-codes).

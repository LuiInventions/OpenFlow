# API connection verification (v1.5.23)

A live comparison on the affected Windows machine reproduced the reported error using the saved key in an isolated profile. The key itself was never logged.

- Node fetch: `SELF_SIGNED_CERT_IN_CHAIN`, before receiving an HTTP response.
- Electron Chromium `net.fetch`: HTTP 200 with a successful model completion using the same key and verification payload.
- Updated app: the saved key became valid; both Clean dictation and Polish dictation successfully processed a synthetic dictation while preserving the person, time and negation.

OpenAI requests in the main process use `net.fetch`, including verification, note/dictation improvements, speech recognition and speech output. TLS certificate validation stays enabled. There is no insecure certificate callback or disabled verification.

Verification retries one temporary network/server/incomplete-response failure. A saved key can be rechecked through Retry in Settings and onboarding. Temporary unavailability keeps the saved feature preferences while disabling API switches until the key is verified.

References: [Electron net](https://www.electronjs.org/docs/latest/api/net/), [OpenAI error handling](https://developers.openai.com/api/docs/guides/error-codes).

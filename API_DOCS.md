# Food Manager API — Auth Docs

Base URL: `http://localhost:3000/api`

All responses are JSON. All errors follow: `{ "error": { "code": "SOME_CODE", "message": "human readable" } }`.

Protected routes require `Authorization: Bearer <accessToken>`.

## Auth model in one paragraph

Devices hold an asymmetric keypair (Ed25519 or RSA) generated in the Android Keystore; only the
**public key** (base64, SPKI/DER) is ever sent to the server. To log in, the server hands the
device a random nonce (`/challenge`), the device signs it with its private key, and the server
verifies that signature against the stored public key (`/verify`). No passwords ever exist.
Email is **entirely optional** and used only for account recovery if a device is lost — skipping
it costs nothing except recovery; the Android app should warn the user about this tradeoff at
registration time.

Registration logs the new device in immediately (returns tokens directly) rather than requiring a
challenge round-trip on the very first login — see the comment in `src/services/authService.ts`
for the reasoning.

## Endpoints

### GET /auth/username-available?username=...
→ 200 `{ available: true|false }` — check before registration to give the user instant feedback.

### POST /auth/register
Body: `{ username, publicKey, deviceLabel?, email? }`
→ 201 `{ user, device, accessToken, refreshToken }`

### POST /auth/challenge
Body: `{ username }`
→ 200 `{ challengeId, nonce }` (nonce expires in `CHALLENGE_TTL` seconds)

### POST /auth/verify
Body: `{ challengeId, signature, deviceId }` — `signature` = base64 signature of `nonce` (UTF-8 bytes)
→ 200 `{ accessToken, refreshToken }`

### POST /auth/refresh
Body: `{ refreshToken }` → 200 `{ accessToken, refreshToken }` (old refresh token is revoked — rotation)

### POST /auth/logout
Body: `{ refreshToken }` → 200 `{ message }`

### POST /auth/email/add  🔒
Body: `{ email }` → 200 `{ message }` (sets emailVerified=false; logs both a verification link
*and* a 6-digit numeric code to the console — either one confirms the same pending email).
Works right after registration or any time later to add/change the address on file.

### GET /auth/email/verify?token=...
→ 200 `{ message }`

### POST /auth/email/verify-code  🔒
Body: `{ code }` (6 digits) → 200 `{ message }`. Alternative to the link above for clients that
can't open a deep link — verifies the most recent pending email for the authenticated user.
Code expires after `EMAIL_CODE_TTL` seconds (default 600 = 10 min) and is invalidated after
`EMAIL_CODE_MAX_ATTEMPTS` wrong guesses (default 5); request a new one via `/auth/email/add`.

### POST /auth/recovery/request
Body: `{ username? , email? }` (one required) → 200 generic `{ message }` always, regardless of
whether the account exists / has a verified email (anti-enumeration).

### POST /auth/recovery/confirm
Body: `{ recoveryToken, newPublicKey, deviceLabel? }` → 200 `{ device, accessToken, refreshToken }`

### POST /auth/devices/add  🔒
Body: `{ publicKey, deviceLabel? }` → 201 `{ id, deviceLabel, createdAt }`

### GET /auth/devices  🔒
→ 200 `[{ id, deviceLabel, lastUsedAt, createdAt }, ...]`

### DELETE /auth/devices/:deviceId  🔒
→ 200 `{ message }`

🔒 = requires `Authorization: Bearer <accessToken>`

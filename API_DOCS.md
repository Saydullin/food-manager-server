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
→ 201 `{ user, device, accessToken, refreshToken }` where `user` is
`{ id, username, email, emailVerified, imageUrl }` (`imageUrl` is `null` on a fresh account —
set it later via the Profile endpoints below).

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

### POST /auth/recovery/request-code
Login / restore access by **username + email** (the code-based counterpart to `/recovery/request`,
for a login screen where the user types both). Body: `{ username, email }` → 200 generic `{ message }`
always (anti-enumeration). Only mails a 6-digit code when the username exists **and** the submitted
email matches the account's **verified** on-file address (case-insensitive) — the code is never sent
to an arbitrary address. Code expires after `RECOVERY_CODE_TTL` seconds (default 600 = 10 min).

### POST /auth/recovery/confirm-code
Body: `{ username, email, code, newPublicKey, deviceLabel? }` → 200
`{ user, device, accessToken, refreshToken }`. Verifies the emailed code, registers the new device
public key, and issues a session (the client is now logged in on this device). The code is single-use
and invalidated after `RECOVERY_CODE_MAX_ATTEMPTS` wrong guesses (default 5); on failure the error is
generic (`INVALID_RECOVERY_CODE`) so it never reveals whether the account or the code was wrong.

### POST /auth/devices/add  🔒
Body: `{ publicKey, deviceLabel? }` → 201 `{ id, deviceLabel, createdAt }`

### GET /auth/devices  🔒
→ 200 `[{ id, deviceLabel, lastUsedAt, createdAt }, ...]`

### DELETE /auth/devices/:deviceId  🔒
→ 200 `{ message }`

## Profile

The profile picture is stored as a URL — the client uploads the image file to its own
storage/CDN and sends the resulting `https://…` link here (same convention as food images).
`imageUrl` is `null` until set, and available any time after registration.

### GET /users/me  🔒
→ 200 `{ user }` where `user` is
`{ id, username, email, emailVerified, imageUrl, createdAt, updatedAt, foodPreferences, foodExceptions, diets, settings }`.
`settings` is the object described under **Settings** below — so a single `GET /users/me`
gives the client everything, including the user's preferences, right after login.

### PUT /users/me/image  🔒
Body: `{ imageUrl }` — an `http(s)` URL, max 2048 chars. Used for both **setting** and **changing**
the picture (idempotent).
→ 200 `{ user }` (the full updated profile)

### DELETE /users/me/image  🔒
Removes the picture (sets `imageUrl` back to `null`).
→ 200 `{ user }` (the full updated profile)

## Settings

Per-user client-side preferences: `language`, `theme`, and `pushNotificationsEnabled`. Every
account gets a default set the moment it registers (`{ language: "en", theme: "SYSTEM",
pushNotificationsEnabled: true }`), so the client can read settings right after registration or
login — either embedded in `GET /users/me`, or via the dedicated endpoint below. More settings
may be added over time; treat the object as open and ignore unknown fields you don't use.

- `language` — a BCP-47 language tag the client renders in (e.g. `"en"`, `"ru"`, `"en-US"`).
- `theme` — one of `"LIGHT"`, `"DARK"`, `"SYSTEM"`. `SYSTEM` follows the device's OS theme;
  the client resolves it to light/dark at render time.
- `pushNotificationsEnabled` — boolean; whether the client should show push notifications.

### GET /users/me/settings  🔒
→ 200 `{ settings: { language, theme, pushNotificationsEnabled } }`

### PATCH /users/me/settings  🔒
Body: any **non-empty** subset of `{ language?, theme?, pushNotificationsEnabled? }`. Only the
fields you send are changed; the rest keep their current value (partial update). An empty body,
an unknown field, or an invalid value returns 400.
→ 200 `{ settings }` (the full updated settings)

🔒 = requires `Authorization: Bearer <accessToken>`

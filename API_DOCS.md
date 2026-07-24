# Food Manager API — Auth Docs

Base URL: `http://localhost:3000/api`

All responses are JSON. All errors follow: `{ "error": { "code": "SOME_CODE", "message": "human readable" } }`.

Protected routes require `Authorization: Bearer <accessToken>`.

## Auth model in one paragraph

Devices hold an asymmetric keypair (Ed25519 or RSA) generated in the Android Keystore; only the
**public key** (base64, SPKI/DER) is ever sent to the server. To log in, the server hands the
device a random nonce (`/challenge`), the device signs it with its private key, and the server
verifies that signature against the stored public key (`/verify`). No passwords ever exist.
Email is **entirely optional** and used only as a login fallback if the device's challenge/verify
handshake doesn't work (lost/reset device, new install, etc.) — skipping it costs nothing except
that fallback; the Android app should warn the user about this tradeoff at registration time.
The client should attempt `/challenge` + `/verify` first, and only fall back to the email+code
flow (`/recovery/request-code` + `/recovery/confirm-code` below) if that fails.

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
Login by **username + email**, the fallback path when `/challenge` + `/verify` doesn't work (device
lost/reset, fresh install, etc.). Body: `{ username, email }` → 200 generic `{ message }` always
(anti-enumeration — same response whether or not the account/email matched). Only mails a 6-digit
code when the username exists **and** the submitted email matches the account's **verified**
on-file address (case-insensitive); a mismatched email never receives a code and never lets the
client in. Code expires after `RECOVERY_CODE_TTL` seconds (default 600 = 10 min).

### POST /auth/recovery/confirm-code
Body: `{ username, email, code, newPublicKey, deviceLabel? }` → 200
`{ user, device, accessToken, refreshToken }`. Verifies the emailed code, registers the new device
public key, and issues a session (the client is now logged in on this device). The code is single-use
and invalidated after `RECOVERY_CODE_MAX_ATTEMPTS` wrong guesses (default 5); if the username/email
don't match a verified account, or the code is wrong/expired/exhausted, the request is rejected with
`400 INVALID_RECOVERY_CODE` and **no session is issued** — the error is generic so it never reveals
whether the account or the code was wrong.

### POST /auth/devices/add  🔒
Body: `{ publicKey, deviceLabel? }` → 201 `{ id, deviceLabel, createdAt }`

### GET /auth/devices  🔒
→ 200 `[{ id, deviceLabel, lastUsedAt, createdAt }, ...]`

### DELETE /auth/devices/:deviceId  🔒
→ 200 `{ message }`

## Profile

Editable account fields, all optional and `null` until the user fills them in:

- `username` — the **unique** login handle (3–20 chars, `[a-zA-Z0-9_]`). Required at registration
  and changeable here; renaming to a handle already in use returns `409 USERNAME_TAKEN`.
- `name` — display name (≤ 100 chars); distinct from `username`.
- `age` — whole number of years, `0`–`150`.
- `status` — a short one-liner (≤ 150 chars).
- `description` — the longer "about me" (≤ 2000 chars).

The profile picture is stored as a URL — the client uploads the image file to its own
storage/CDN and sends the resulting `https://…` link here (same convention as food images).
`imageUrl` is `null` until set, and available any time after registration.

### GET /users/me  🔒
→ 200 `{ user }` where `user` is
`{ id, username, email, emailVerified, imageUrl, name, age, status, description, createdAt, updatedAt, foodPreferences, foodExceptions, diets, settings }`.
`settings` is the object described under **Settings** below — so a single `GET /users/me`
gives the client everything, including the user's preferences, right after login.

### PATCH /users/me  🔒
Edit the profile fields. Body: any **non-empty** subset of
`{ username?, name?, age?, status?, description? }`. Only the fields you send change; the rest
keep their current value (partial update). For the optional text fields (`name`, `status`,
`description`), send `null` (or an empty string) to **clear** a field. An empty body, an unknown
field, or an invalid value returns `400`; a `username` already taken by another account returns
`409 USERNAME_TAKEN`.
→ 200 `{ user }` (the full updated profile, same shape as `GET /users/me`)

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

## Cuisines

Server-owned reference catalog, same shape/contract as **Diets**: a fixed list of machine-readable
enum codes (e.g. `"ITALIAN"`) the client maps to localized names. Not user-editable; new cuisines
are added server-side by inserting rows (future admin panel). Also the source of the codes a client
sends as `reasonDetail` for a `WRONG_CUISINE` dislike (see below).

### GET /cuisines  🔒
→ 200 `{ cuisines: ["ITALIAN", "JAPANESE", ...] }` — ordered by the catalog's `sortOrder`.

## Food feed & swipe (Tinder-style)

The recommendation deck. A **dish** is returned fully shaped:

```jsonc
{
  "id": "uuid",
  "name": "Spicy Tuna Roll",
  "description": "…",                 // nullable
  "cuisine": "JAPANESE",              // nullable; a code from GET /cuisines
  "images": ["https://…1.jpg", …],    // 1..7, ordered (first = cover); [] if none
  "nutrition": {                      // nullable
    "calories": 320, "servings": 1,   // per serving
    "protein": 24, "fat": 9, "carbs": 38   // grams, КБЖУ; any may be null
  },
  "tags": {                           // each an array of UPPER_SNAKE codes
    "allergens": ["FISH", "SOY", "SESAME"],
    "dietaryRestrictions": ["PESCATARIAN"],
    "intolerances": [],
    "features": ["SPICY", "HIGH_PROTEIN", "LOW_FAT"],
    "diets": []
  },
  "createdAt": "…", "updatedAt": "…"
}
```

**Pagination is keyset (cursor), not offset.** The feed subtracts the dishes the user has already
swiped, and that set grows as they swipe — a fixed offset would skip/repeat rows, so instead every
list response is:

```jsonc
{ "items": [ …dishes… ], "nextCursor": "opaque-base64-or-null", "hasMore": true }
```

To get the next page, pass `nextCursor` back as `?cursor=…`. `nextCursor` is `null` (and `hasMore`
`false`) on the last page. The cursor is opaque — treat it as a token; a malformed one returns
`400 INVALID_CURSOR`.

### GET /foods/feed?limit=&cursor=  🔒
A page of dishes the user has **not swiped yet**, newest first. `limit` is `1`–`50` (default `10`).
→ 200 `{ items: [dish], nextCursor, hasMore }`

### GET /foods/:foodId  🔒
Full detail for one dish (same shape as a feed item). Non-UUID id → `400`; unknown id →
`404 FOOD_NOT_FOUND`.
→ 200 `{ food }`

### POST /foods/:foodId/interactions  🔒
Record (or overwrite) the swipe verdict. **Idempotent per (user, dish)** — re-swiping overwrites the
previous verdict (upsert), so a dish never accumulates rows and a SKIP can later become a LIKE.
Body: `{ action, reason?, reasonDetail? }`

- `action` — `"LIKE"` | `"SKIP"` | `"DISLIKE"`.
- `reason` — **only allowed when `action` is `DISLIKE`** ("Hate it → why"); sending it otherwise → `400`.
  One of `DISLIKE_TAG` | `WRONG_CUISINE` | `ALREADY_ATE` | `ALLERGEN` | `NOT_IN_MOOD` | `OTHER`.
- `reasonDetail` — the specific code behind the reason: the disliked **tag** for `DISLIKE_TAG`
  (e.g. `"SPICY"`, `"MILK"`) or a **cuisine** code for `WRONG_CUISINE` (e.g. `"ITALIAN"`).
  **Required** for those two reasons, optional otherwise.

After a swipe the dish drops out of the feed. Unknown dish → `404 FOOD_NOT_FOUND`.
→ 200 `{ interaction: { foodId, action, reason, reasonDetail, createdAt, updatedAt } }`

These verdicts — especially the dislike reasons — are the raw signal the future preference-based
recommender will learn from.

### DELETE /foods/:foodId/interactions  🔒
Undo a swipe (rewind): removes the verdict so the dish re-enters the feed. Idempotent — never 404s.
→ 200 `{ removed: true|false }`

### GET /foods/interactions?action=&limit=&cursor=  🔒
The user's own swipe history ("my likes / skips / dislikes"), newest first, same cursor pagination as
the feed. Optional `action` filter (`LIKE`|`SKIP`|`DISLIKE`). Each item embeds the full dish.
→ 200 `{ items: [{ foodId, action, reason, reasonDetail, createdAt, updatedAt, food }], nextCursor, hasMore }`

### POST /api/dev/seed-foods  (dev only, no auth)
Seeds a fixed set of sample dishes (images + nutrition + cuisine + tags) so the feed is testable.
Idempotent. Mounted only when `NODE_ENV != production`, like the `/api/dev` keystore helpers.
→ 200 `{ count }`

🔒 = requires `Authorization: Bearer <accessToken>`

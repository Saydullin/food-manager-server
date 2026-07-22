I'm building a backend for an Android app called a "food recommendation for user" app 
(Tinder-style swiping, but for food/recipes/restaurants instead of people).

Stack:
- Node.js + TypeScript
- Express
- Prisma ORM
- PostgreSQL
- JWT for session tokens

AUTHENTICATION MODEL:
Primary auth is device-based public-key authentication (similar to Passkeys/WebAuthn) — 
NOT passwords. Registration requires only a username. Email is OPTIONAL, provided by the 
user's own choice, used ONLY as an account-recovery mechanism if their device key is ever 
lost (e.g. app reinstalled, phone lost). If the user skips email, that's their informed 
choice — the Android app will show clear warnings about this at registration, so the 
backend doesn't need to nag about it, just support both cases cleanly.

Flow:
- Registration: Android app generates an asymmetric key pair (Ed25519 or RSA) in Android 
  Keystore. Only the public key + username (+ optional email) are sent to the server. 
  Private key never leaves the device.
- Login: server issues a random challenge (nonce), app signs it with the device private 
  key via Keystore, sends signature back, server verifies against stored public key.
- On success, issue JWT access token (short-lived) + refresh token (long-lived, stored 
  hashed in DB).
- If a user loses their device/reinstalls the app AND has no email on file: account is 
  unrecoverable, by design. If they DO have email on file: they can request a recovery 
  link to link a new device's public key to their existing account.

TASK 1: Project setup
- TypeScript Node.js project, folder structure: src/routes, src/controllers, src/services, 
  src/middleware, src/utils, prisma/
- ESLint + Prettier
- .env / .env.example (DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, PORT, CHALLENGE_TTL, 
  RECOVERY_TOKEN_TTL, SMTP config for sending recovery emails)
- Prisma with PostgreSQL

TASK 2: Database schema (Prisma)

User model:
- id (UUID, primary key)
- username (unique, required, 3-20 chars, alphanumeric + underscore)
- email (nullable, unique if present, NOT required)
- emailVerified (boolean, default false — only relevant if email is set)
- createdAt, updatedAt

Device model:
- id (UUID, primary key)
- userId (foreign key -> User)
- publicKey (base64 text)
- deviceLabel (nullable, e.g. "Pixel 8")
- createdAt, lastUsedAt

Challenge model (short-lived, single-use, for login):
- id (UUID, primary key)
- userId (foreign key -> User)
- nonce (random string)
- expiresAt (now + 2 minutes)
- used (boolean, default false)

RefreshToken model:
- id (UUID, primary key)
- userId (foreign key -> User)
- deviceId (foreign key -> Device)
- tokenHash (hashed, never store raw token)
- expiresAt
- revoked (boolean, default false)
- createdAt

RecoveryToken model (for email-based device relinking):
- id (UUID, primary key)
- userId (foreign key -> User)
- tokenHash (hashed, single-use link sent via email)
- expiresAt (e.g. now + 30 minutes)
- used (boolean, default false)
- createdAt

TASK 3: Auth endpoints

1. POST /api/auth/register
   - Body: { username, publicKey, deviceLabel?, email? }
   - Validate username format + uniqueness
   - If email provided: validate format + uniqueness, set emailVerified = false, 
     send a verification email (just log the link/token to console for now — 
     don't wire up real SMTP unless I ask)
   - Create User + Device record
   - Explain to me the tradeoff of "log in immediately after register" vs 
     "require a challenge round-trip even on first login" before implementing, 
     then implement whichever is cleaner

2. POST /api/auth/challenge
   - Body: { username }
   - Generate nonce, store in Challenge table with short expiry, return 
     { challengeId, nonce }
   - Generic error if user not found (don't leak existence)

3. POST /api/auth/verify
   - Body: { challengeId, signature, deviceId }
   - Validate challenge (not expired, not used), verify signature against device's 
     public key, mark challenge used, issue JWT access + refresh tokens, update 
     device.lastUsedAt

4. POST /api/auth/refresh
   - Body: { refreshToken }
   - Validate, issue new access token, rotate refresh token

5. POST /api/auth/logout
   - Body: { refreshToken }
   - Revoke it

6. POST /api/auth/email/add (protected route)
   - Body: { email }
   - Lets a logged-in user add/change email after the fact (in case they skipped it 
     at registration but change their mind later)
   - Sets emailVerified = false, sends verification email (console log for now)

7. GET /api/auth/email/verify?token=xxx
   - Verifies email via emailed token, sets emailVerified = true

8. POST /api/auth/recovery/request
   - Body: { username or email }
   - If the account has a verified email on file: generate a RecoveryToken, email a 
     recovery link (console log for now)
   - If no email on file: return a clear error explaining recovery isn't available 
     for this account
   - Always return a generic success-style message regardless of whether the account 
     was found, to avoid leaking which usernames/emails exist

9. POST /api/auth/recovery/confirm
   - Body: { recoveryToken, newPublicKey, deviceLabel? }
   - Validate token (not expired, not used), mark used, register the new device's 
     public key to that user's account (this is how they regain access after 
     losing their old device)

10. POST /api/auth/devices/add (protected route) — for adding an additional device 
    while still logged in on another one
11. GET /api/auth/devices (protected route) — list devices (id, label, lastUsedAt)
12. DELETE /api/auth/devices/:deviceId (protected route) — revoke a device

TASK 4: Middleware & security
- JWT auth middleware for protected routes
- Rate limiting on /challenge, /verify, /recovery/request (prevent abuse)
- Input validation with zod on every endpoint
- Centralized error handler, consistent JSON format: { error: { code, message } }
- CORS setup for the Android app
- Never return publicKey, tokenHash, or raw recovery/verification tokens in any response

TASK 5: API documentation for the Android developer
Generate API_DOCS.md covering, for every endpoint:
- Method + path, headers, request/response examples, status codes, all error cases
- Full auth flow explained end-to-end (register → challenge → verify → refresh)
- Clear explanation that email is OPTIONAL at registration, and exactly what the user 
  gains (account recovery) vs loses (nothing extra) by skipping it
- Clear note that Android should show a warning like "Without email, if you lose this 
  device or reinstall the app, your account cannot be recovered" at the point where 
  the user can choose to skip email
- Explanation of the recovery flow (request → email link → confirm) for the case 
  where email WAS provided

Go step by step: project setup, then Prisma schema (show me before migrating), then 
each endpoint one at a time so I can test with Postman before moving on, then finally 
the documentation. Ask me before running destructive commands like dropping the database.
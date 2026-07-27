# Food Manager Server

[English](#food-manager-server) | [Русский](README.ru.md)

Backend API for a Tinder-style food/recipe recommendation Android app. Built with
Express, TypeScript, and Prisma (PostgreSQL).

## Features

- **Passwordless device auth** — devices generate an Ed25519/RSA keypair in the
  Android Keystore; only the public key ever reaches the server. Login is a
  challenge/signature handshake (`/auth/challenge` + `/auth/verify`), no passwords.
- **Optional email recovery** — link- or 4-digit-code based account recovery if a
  device is lost, with anti-enumeration responses and attempt limits.
- **Food catalog** — foods with nutrition, allergens, dietary restrictions,
  intolerances, features, cuisines, and diets.
- **User preferences** — per-user food likes/exceptions, diets, and settings.
- **Swipe-style interactions** — user-food interaction tracking for recommendations.

## Tech stack

- [Express](https://expressjs.com/) + TypeScript
- [Prisma](https://www.prisma.io/) ORM + PostgreSQL
- [Zod](https://zod.dev/) for request validation
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) for access/refresh tokens

## Getting started

### Prerequisites

- Node.js 18+
- PostgreSQL

### Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, JWT secrets, etc.
npm run prisma:migrate
npm run dev
```

The server starts on `PORT` from `.env` (default `3000`).

### Scripts

| Command                 | Description                              |
| ------------------------ | ----------------------------------------- |
| `npm run dev`            | Start in watch mode (`tsx watch`)         |
| `npm run build`          | Compile TypeScript to `dist/`             |
| `npm start`              | Run the compiled server                   |
| `npm run lint` / `lint:fix` | Lint (and fix) with ESLint             |
| `npm run format`         | Format with Prettier                      |
| `npm run prisma:generate`| Generate the Prisma client                |
| `npm run prisma:migrate` | Run Prisma migrations (dev)               |
| `npm run prisma:studio`  | Open Prisma Studio                        |

## Project structure

```
src/
├── config/       # env/config loading
├── controllers/   # request handlers
├── middleware/    # auth, rate limiting, etc.
├── routes/        # Express routers
├── services/      # business logic (auth, tokens, ...)
├── types/         # shared TypeScript types
├── utils/         # helpers
└── validation/    # Zod schemas
prisma/
└── schema.prisma  # database schema
```

## API documentation

See [API_DOCS.md](API_DOCS.md) for the full auth API reference, and
[food_table.md](food_table.md) for the food data model notes. A Postman
collection is available in [postman/](postman/).

## License

MIT

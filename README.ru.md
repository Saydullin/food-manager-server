# Food Manager Server

[English](README.md) | [Русский](#food-manager-server)

Backend API для Android-приложения рекомендаций еды/рецептов в формате
Tinder-свайпов. Стек: Express, TypeScript и Prisma (PostgreSQL).

## Возможности

- **Беспарольная аутентификация устройств** — устройство генерирует пару
  ключей Ed25519/RSA в Android Keystore; на сервер отправляется только
  публичный ключ. Вход выполняется по схеме challenge/signature
  (`/auth/challenge` + `/auth/verify`) — паролей нет.
- **Восстановление доступа по email (опционально)** — восстановление аккаунта
  по ссылке или 6-значному коду при потере устройства, с защитой от
  перебора (anti-enumeration) и лимитом попыток.
- **Каталог блюд** — блюда с данными о питательности, аллергенах, диетических
  ограничениях, непереносимостях, особенностях, кухнях и диетах.
- **Предпочтения пользователя** — личные лайки/исключения по блюдам, диеты и
  настройки.
- **Взаимодействия в стиле свайпов** — учёт взаимодействий пользователь-блюдо
  для формирования рекомендаций.

## Технологии

- [Express](https://expressjs.com/) + TypeScript
- [Prisma](https://www.prisma.io/) ORM + PostgreSQL
- [Zod](https://zod.dev/) для валидации запросов
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) для access/refresh токенов

## Быстрый старт

### Требования

- Node.js 18+
- PostgreSQL

### Установка

```bash
npm install
cp .env.example .env   # затем заполните DATABASE_URL, JWT-секреты и т.д.
npm run prisma:migrate
npm run dev
```

Сервер запускается на порту из переменной `PORT` в `.env` (по умолчанию `3000`).

### Скрипты

| Команда                    | Описание                                  |
| --------------------------- | ------------------------------------------ |
| `npm run dev`               | Запуск в режиме отслеживания (`tsx watch`) |
| `npm run build`             | Компиляция TypeScript в `dist/`            |
| `npm start`                 | Запуск скомпилированного сервера           |
| `npm run lint` / `lint:fix` | Линтинг (и автофикс) через ESLint          |
| `npm run format`            | Форматирование через Prettier              |
| `npm run prisma:generate`   | Генерация Prisma-клиента                   |
| `npm run prisma:migrate`    | Запуск миграций Prisma (dev)               |
| `npm run prisma:studio`     | Открыть Prisma Studio                      |

## Структура проекта

```
src/
├── config/       # загрузка конфигурации/переменных окружения
├── controllers/   # обработчики запросов
├── middleware/    # аутентификация, rate limiting и т.д.
├── routes/        # роутеры Express
├── services/      # бизнес-логика (auth, токены, ...)
├── types/         # общие TypeScript-типы
├── utils/         # вспомогательные функции
└── validation/    # Zod-схемы
prisma/
└── schema.prisma  # схема базы данных
```

## Документация API

Полное описание API аутентификации — в [API_DOCS.md](API_DOCS.md), заметки по
модели данных блюд — в [food_table.md](food_table.md). Коллекция Postman
находится в [postman/](postman/).

## Лицензия

MIT

-- Editable profile fields on the account row. All nullable — existing users keep
-- NULL (unset) until they fill them in via PATCH /users/me, and new users start NULL.
-- ALTER TABLE
ALTER TABLE "users" ADD COLUMN     "name" TEXT,
ADD COLUMN     "age" INTEGER,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "description" TEXT;

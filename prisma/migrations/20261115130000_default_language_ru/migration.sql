-- New accounts get Russian, the language the app's UI is written in, instead of English.
-- The client sends this setting as ?lang= for dishes, so an "en" default served English
-- recipes inside a Russian app. Existing rows keep whatever they have: a user who picked
-- English in the profile must stay on English.

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "language" SET DEFAULT 'ru';


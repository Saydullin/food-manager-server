-- Account-scoped record of having been through the onboarding questions.
-- Null = never asked. See the schema comment on User.onboardingCompletedAt for why this
-- lives on the account rather than as a device-local flag.
ALTER TABLE "users" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Backfill: any account that already carries taste data has, in effect, already told us
-- what onboarding would ask — whether through an earlier build's profile screen or on
-- another device. Without this, deploying the onboarding gate would interrogate every
-- existing user once more. Stamped with the account's own updatedAt rather than now(),
-- so the timestamp stays a plausible "when did this happen" instead of "when did we
-- deploy". Idempotent: re-running only ever affects rows that are still NULL.
UPDATE "users" u
SET "onboardingCompletedAt" = u."updatedAt"
WHERE u."onboardingCompletedAt" IS NULL
  AND (
    EXISTS (SELECT 1 FROM "user_diets"             d WHERE d."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "user_food_exceptions"  e WHERE e."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "user_food_preferences" p WHERE p."userId" = u."id")
  );

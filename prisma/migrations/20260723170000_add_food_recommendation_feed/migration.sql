-- CreateEnum
CREATE TYPE "FoodInteractionAction" AS ENUM ('LIKE', 'SKIP', 'DISLIKE');

-- CreateEnum
CREATE TYPE "FoodDislikeReason" AS ENUM ('DISLIKE_TAG', 'WRONG_CUISINE', 'ALREADY_ATE', 'ALLERGEN', 'NOT_IN_MOOD', 'OTHER');

-- AlterTable: add two feature flags requested for the swipe UI (sweet / sugar-free).
ALTER TABLE "food_features" ADD COLUMN "sweet" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "food_features" ADD COLUMN "sugarFree" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: dishes gain an optional cuisine (FK added below, after the catalog exists).
ALTER TABLE "foods" ADD COLUMN "cuisineId" UUID;

-- CreateTable
CREATE TABLE "cuisines" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuisines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_nutrition" (
    "foodId" UUID NOT NULL,
    "calories" INTEGER,
    "servings" INTEGER,
    "protein" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,

    CONSTRAINT "food_nutrition_pkey" PRIMARY KEY ("foodId")
);

-- CreateTable
CREATE TABLE "food_images" (
    "id" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_interactions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "action" "FoodInteractionAction" NOT NULL,
    "reason" "FoodDislikeReason",
    "reasonDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cuisines_code_key" ON "cuisines"("code");

-- CreateIndex
CREATE INDEX "food_images_foodId_idx" ON "food_images"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "food_images_foodId_position_key" ON "food_images"("foodId", "position");

-- CreateIndex
CREATE INDEX "food_interactions_userId_action_createdAt_idx" ON "food_interactions"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "food_interactions_foodId_userId_idx" ON "food_interactions"("foodId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "food_interactions_userId_foodId_key" ON "food_interactions"("userId", "foodId");

-- CreateIndex
CREATE INDEX "foods_createdAt_id_idx" ON "foods"("createdAt", "id");

-- CreateIndex
CREATE INDEX "foods_cuisineId_idx" ON "foods"("cuisineId");

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_cuisineId_fkey" FOREIGN KEY ("cuisineId") REFERENCES "cuisines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrition" ADD CONSTRAINT "food_nutrition_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_images" ADD CONSTRAINT "food_images_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_interactions" ADD CONSTRAINT "food_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_interactions" ADD CONSTRAINT "food_interactions_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the default, server-owned cuisine catalog. Fixed UUIDs keep the seed
-- deterministic; ON CONFLICT makes it safe to re-run. Admins can add more later.
INSERT INTO "cuisines" ("id", "code", "sortOrder", "updatedAt") VALUES
    ('c0000000-0000-4000-8000-000000000001', 'ITALIAN',       1,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000002', 'JAPANESE',      2,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000003', 'CHINESE',       3,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000004', 'MEXICAN',       4,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000005', 'INDIAN',        5,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000006', 'THAI',          6,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000007', 'FRENCH',        7,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000008', 'AMERICAN',      8,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000009', 'MEDITERRANEAN', 9,  CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000000a', 'KOREAN',        10, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- CreateTable
CREATE TABLE "food_translations" (
    "id" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "food_translations_foodId_idx" ON "food_translations"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "food_translations_foodId_language_key" ON "food_translations"("foodId", "language");

-- AddForeignKey
ALTER TABLE "food_translations" ADD CONSTRAINT "food_translations_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing dish's name/description becomes its "en" translation
-- before the columns are dropped, so no existing content is lost.
INSERT INTO "food_translations" ("id", "foodId", "language", "name", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'en', "name", "description", "createdAt", "updatedAt"
FROM "foods";

-- AlterTable
ALTER TABLE "foods" DROP COLUMN "description",
DROP COLUMN "name";

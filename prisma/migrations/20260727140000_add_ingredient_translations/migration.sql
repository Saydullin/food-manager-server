-- CreateTable
CREATE TABLE "ingredient_translations" (
    "id" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredient_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredient_translations_ingredientId_idx" ON "ingredient_translations"("ingredientId");

-- CreateIndex
CREATE INDEX "ingredient_translations_language_name_idx" ON "ingredient_translations"("language", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_translations_ingredientId_language_key" ON "ingredient_translations"("ingredientId", "language");

-- AddForeignKey
ALTER TABLE "ingredient_translations" ADD CONSTRAINT "ingredient_translations_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing ingredient's name becomes its "en" translation
-- before the column is dropped, so no existing catalog data is lost.
INSERT INTO "ingredient_translations" ("id", "ingredientId", "language", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'en', "name", "createdAt", "updatedAt"
FROM "ingredients";

-- DropIndex
DROP INDEX "ingredients_name_key";

-- AlterTable
ALTER TABLE "ingredients" DROP COLUMN "name";

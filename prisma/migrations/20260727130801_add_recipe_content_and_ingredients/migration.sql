-- AlterTable
ALTER TABLE "food_translations" ADD COLUMN     "content" TEXT;

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_ingredients" (
    "id" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'g',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE INDEX "food_ingredients_foodId_idx" ON "food_ingredients"("foodId");

-- CreateIndex
CREATE INDEX "food_ingredients_ingredientId_idx" ON "food_ingredients"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "food_ingredients_foodId_ingredientId_key" ON "food_ingredients"("foodId", "ingredientId");

-- AddForeignKey
ALTER TABLE "food_ingredients" ADD CONSTRAINT "food_ingredients_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_ingredients" ADD CONSTRAINT "food_ingredients_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

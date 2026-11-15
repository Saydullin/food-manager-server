-- Recipe dataset fields (dataset/out/*.jsonl): a dish's code, course, meal types, times,
-- difficulty, price, spice, minimum age and storage; the rest of its nutrition label;
-- appliance alternatives (food_appliance_options: "oven OR air fryer"); an ingredient's
-- code, category and staple flag; and optional / to-taste recipe lines.
-- Purely additive: every new column is nullable or defaults to the old behaviour.

-- CreateEnum
CREATE TYPE "DishCourse" AS ENUM ('MAIN', 'SIDE', 'SOUP', 'SALAD', 'DESSERT', 'BAKERY', 'APPETIZER', 'SAUCE', 'DRINK');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateEnum
CREATE TYPE "IngredientCategory" AS ENUM ('VEGETABLE', 'FRUIT', 'BERRY', 'GREENS', 'MUSHROOM', 'MEAT', 'POULTRY', 'OFFAL', 'SAUSAGE', 'FISH', 'SEAFOOD', 'DAIRY', 'CHEESE', 'EGG', 'GRAIN', 'PASTA', 'FLOUR', 'BREAD', 'LEGUME', 'NUT', 'SEED', 'SPICE', 'HERB_DRIED', 'OIL_FAT', 'SAUCE_CONDIMENT', 'SWEETENER', 'BAKING', 'CANNED', 'FROZEN', 'ALCOHOL', 'BEVERAGE', 'OTHER');

-- AlterTable
ALTER TABLE "food_ingredients" ADD COLUMN     "optional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "toTaste" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "food_nutrition" ADD COLUMN     "fiber" DOUBLE PRECISION,
ADD COLUMN     "saturatedFat" DOUBLE PRECISION,
ADD COLUMN     "servingWeight" DOUBLE PRECISION,
ADD COLUMN     "sodium" DOUBLE PRECISION,
ADD COLUMN     "sugar" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "foods" ADD COLUMN     "code" TEXT,
ADD COLUMN     "containsAlcohol" BOOLEAN,
ADD COLUMN     "cookTimeMin" INTEGER,
ADD COLUMN     "course" "DishCourse",
ADD COLUMN     "difficulty" INTEGER,
ADD COLUMN     "freezable" BOOLEAN,
ADD COLUMN     "mealTypes" "MealType"[] DEFAULT ARRAY[]::"MealType"[],
ADD COLUMN     "minAgeYears" INTEGER,
ADD COLUMN     "onePot" BOOLEAN,
ADD COLUMN     "prepTimeMin" INTEGER,
ADD COLUMN     "priceLevel" INTEGER,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "spiceLevel" INTEGER,
ADD COLUMN     "storageDays" INTEGER,
ADD COLUMN     "totalTimeMin" INTEGER;

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "category" "IngredientCategory",
ADD COLUMN     "code" TEXT,
ADD COLUMN     "isStaple" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "food_appliance_options" (
    "id" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "appliances" "KitchenAppliance"[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "food_appliance_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "food_appliance_options_foodId_idx" ON "food_appliance_options"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "food_appliance_options_foodId_position_key" ON "food_appliance_options"("foodId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "foods_code_key" ON "foods"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_code_key" ON "ingredients"("code");

-- AddForeignKey
ALTER TABLE "food_appliance_options" ADD CONSTRAINT "food_appliance_options_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;


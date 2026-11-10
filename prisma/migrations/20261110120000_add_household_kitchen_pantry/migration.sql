-- "Cook dinner" flow: the people a user cooks for (household_eaters), the equipment they
-- have (user_kitchens), what they have at home (user_pantry_items), the account owner's own
-- sex + doctor's restrictions, and the equipment a dish needs (food_appliances).
-- Purely additive: no existing column or row changes meaning.

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "MedicalRestriction" AS ENUM ('LOW_CALORIE', 'LOW_FAT', 'LOW_CARB', 'NO_SPICY', 'LOW_SALT', 'LOW_SUGAR');

-- CreateEnum
CREATE TYPE "KitchenAppliance" AS ENUM ('STOVE', 'OVEN', 'AIR_FRYER', 'MICROWAVE', 'GRILL', 'MULTICOOKER', 'BLENDER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "medicalRestrictions" "MedicalRestriction"[] DEFAULT ARRAY[]::"MedicalRestriction"[],
ADD COLUMN     "sex" "Sex";

-- CreateTable
CREATE TABLE "household_eaters" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sex" "Sex",
    "age" INTEGER,
    "likes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "medicalRestrictions" "MedicalRestriction"[] DEFAULT ARRAY[]::"MedicalRestriction"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_eaters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_kitchens" (
    "userId" UUID NOT NULL,
    "appliances" "KitchenAppliance"[] DEFAULT ARRAY[]::"KitchenAppliance"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_kitchens_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_pantry_items" (
    "userId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pantry_items_pkey" PRIMARY KEY ("userId","ingredientId")
);

-- CreateTable
CREATE TABLE "food_appliances" (
    "foodId" UUID NOT NULL,
    "stove" BOOLEAN NOT NULL DEFAULT false,
    "oven" BOOLEAN NOT NULL DEFAULT false,
    "airFryer" BOOLEAN NOT NULL DEFAULT false,
    "microwave" BOOLEAN NOT NULL DEFAULT false,
    "grill" BOOLEAN NOT NULL DEFAULT false,
    "multicooker" BOOLEAN NOT NULL DEFAULT false,
    "blender" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "food_appliances_pkey" PRIMARY KEY ("foodId")
);

-- CreateIndex
CREATE INDEX "household_eaters_userId_createdAt_idx" ON "household_eaters"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_pantry_items_userId_idx" ON "user_pantry_items"("userId");

-- AddForeignKey
ALTER TABLE "household_eaters" ADD CONSTRAINT "household_eaters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_kitchens" ADD CONSTRAINT "user_kitchens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_pantry_items" ADD CONSTRAINT "user_pantry_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_pantry_items" ADD CONSTRAINT "user_pantry_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_appliances" ADD CONSTRAINT "food_appliances_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;


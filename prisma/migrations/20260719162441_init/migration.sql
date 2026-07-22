-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "publicKey" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_allergens" (
    "foodId" UUID NOT NULL,
    "milk" BOOLEAN NOT NULL DEFAULT false,
    "eggs" BOOLEAN NOT NULL DEFAULT false,
    "peanuts" BOOLEAN NOT NULL DEFAULT false,
    "treeNuts" BOOLEAN NOT NULL DEFAULT false,
    "soy" BOOLEAN NOT NULL DEFAULT false,
    "wheat" BOOLEAN NOT NULL DEFAULT false,
    "gluten" BOOLEAN NOT NULL DEFAULT false,
    "fish" BOOLEAN NOT NULL DEFAULT false,
    "shellfish" BOOLEAN NOT NULL DEFAULT false,
    "sesame" BOOLEAN NOT NULL DEFAULT false,
    "mustard" BOOLEAN NOT NULL DEFAULT false,
    "celery" BOOLEAN NOT NULL DEFAULT false,
    "lupin" BOOLEAN NOT NULL DEFAULT false,
    "molluscs" BOOLEAN NOT NULL DEFAULT false,
    "sulfites" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "food_allergens_pkey" PRIMARY KEY ("foodId")
);

-- CreateTable
CREATE TABLE "food_dietary_restrictions" (
    "foodId" UUID NOT NULL,
    "vegetarian" BOOLEAN NOT NULL DEFAULT false,
    "vegan" BOOLEAN NOT NULL DEFAULT false,
    "pescatarian" BOOLEAN NOT NULL DEFAULT false,
    "halal" BOOLEAN NOT NULL DEFAULT false,
    "kosher" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "food_dietary_restrictions_pkey" PRIMARY KEY ("foodId")
);

-- CreateTable
CREATE TABLE "food_intolerances" (
    "foodId" UUID NOT NULL,
    "lactose" BOOLEAN NOT NULL DEFAULT false,
    "gluten" BOOLEAN NOT NULL DEFAULT false,
    "fructose" BOOLEAN NOT NULL DEFAULT false,
    "histamine" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "food_intolerances_pkey" PRIMARY KEY ("foodId")
);

-- CreateTable
CREATE TABLE "food_features" (
    "foodId" UUID NOT NULL,
    "spicy" BOOLEAN NOT NULL DEFAULT false,
    "verySpicy" BOOLEAN NOT NULL DEFAULT false,
    "lowCarb" BOOLEAN NOT NULL DEFAULT false,
    "highProtein" BOOLEAN NOT NULL DEFAULT false,
    "lowFat" BOOLEAN NOT NULL DEFAULT false,
    "lowCalorie" BOOLEAN NOT NULL DEFAULT false,
    "highFiber" BOOLEAN NOT NULL DEFAULT false,
    "highSugar" BOOLEAN NOT NULL DEFAULT false,
    "highSodium" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "food_features_pkey" PRIMARY KEY ("foodId")
);

-- CreateTable
CREATE TABLE "food_diets" (
    "foodId" UUID NOT NULL,
    "keto" BOOLEAN NOT NULL DEFAULT false,
    "paleo" BOOLEAN NOT NULL DEFAULT false,
    "mediterranean" BOOLEAN NOT NULL DEFAULT false,
    "diabeticFriendly" BOOLEAN NOT NULL DEFAULT false,
    "lowGi" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "food_diets_pkey" PRIMARY KEY ("foodId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "devices_publicKey_key" ON "devices"("publicKey");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX "challenges_userId_idx" ON "challenges"("userId");

-- CreateIndex
CREATE INDEX "challenges_expiresAt_idx" ON "challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_deviceId_idx" ON "refresh_tokens"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_tokens_tokenHash_key" ON "recovery_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "recovery_tokens_userId_idx" ON "recovery_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_allergens" ADD CONSTRAINT "food_allergens_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_dietary_restrictions" ADD CONSTRAINT "food_dietary_restrictions_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_intolerances" ADD CONSTRAINT "food_intolerances_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_features" ADD CONSTRAINT "food_features_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_diets" ADD CONSTRAINT "food_diets_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

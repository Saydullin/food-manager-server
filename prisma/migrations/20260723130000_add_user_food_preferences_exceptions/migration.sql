-- CreateTable
CREATE TABLE "user_food_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_food_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_food_exceptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_food_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_food_preferences_userId_idx" ON "user_food_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_food_preferences_userId_value_key" ON "user_food_preferences"("userId", "value");

-- CreateIndex
CREATE INDEX "user_food_exceptions_userId_idx" ON "user_food_exceptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_food_exceptions_userId_value_key" ON "user_food_exceptions"("userId", "value");

-- AddForeignKey
ALTER TABLE "user_food_preferences" ADD CONSTRAINT "user_food_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_food_exceptions" ADD CONSTRAINT "user_food_exceptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

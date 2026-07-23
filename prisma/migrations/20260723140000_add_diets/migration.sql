-- CreateTable
CREATE TABLE "diets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_diets" (
    "userId" UUID NOT NULL,
    "dietId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_diets_pkey" PRIMARY KEY ("userId","dietId")
);

-- CreateIndex
CREATE UNIQUE INDEX "diets_code_key" ON "diets"("code");

-- CreateIndex
CREATE INDEX "user_diets_userId_idx" ON "user_diets"("userId");

-- CreateIndex
CREATE INDEX "user_diets_dietId_idx" ON "user_diets"("dietId");

-- AddForeignKey
ALTER TABLE "user_diets" ADD CONSTRAINT "user_diets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_diets" ADD CONSTRAINT "user_diets_dietId_fkey" FOREIGN KEY ("dietId") REFERENCES "diets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the default, server-owned diet catalog. Fixed UUIDs keep the seed
-- deterministic; ON CONFLICT makes it safe to re-run. Admins can add more later.
INSERT INTO "diets" ("id", "code", "sortOrder", "updatedAt") VALUES
    ('a1000000-0000-4000-8000-000000000001', 'VEGETARIAN',   1, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000002', 'VEGAN',        2, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000003', 'HALAL',        3, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000004', 'LACTOSE_FREE', 4, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000005', 'GLUTEN_FREE',  5, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

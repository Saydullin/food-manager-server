-- CreateEnum
CREATE TYPE "ComplaintTargetType" AS ENUM ('USER', 'FOOD');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "targetType" "ComplaintTargetType" NOT NULL,
    "targetUserId" UUID,
    "targetFoodId" UUID,
    "reason" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByAdminId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "complaints_status_createdAt_idx" ON "complaints"("status", "createdAt");

-- CreateIndex
CREATE INDEX "complaints_targetUserId_idx" ON "complaints"("targetUserId");

-- CreateIndex
CREATE INDEX "complaints_targetFoodId_idx" ON "complaints"("targetFoodId");

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_targetFoodId_fkey" FOREIGN KEY ("targetFoodId") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "email_verification_tokens" ADD COLUMN     "codeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "codeHash" TEXT;

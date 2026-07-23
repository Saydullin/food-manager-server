-- RecoveryToken gains a code-based path (email-code login / restore access by
-- username + email) alongside the existing link-token path. tokenHash becomes
-- optional so code-only rows need no link token.
ALTER TABLE "recovery_tokens" ALTER COLUMN "tokenHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "recovery_tokens" ADD COLUMN     "codeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "codeHash" TEXT;

import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { parseDevicePublicKey, verifySignature } from '../utils/crypto';
import { generateRandomToken, generateVerificationCode, hashToken } from '../utils/tokens';
import { signAccessToken } from '../utils/jwt';
import { addSeconds, addTtl } from '../utils/ttl';
import { sendRecoveryEmail, sendVerificationEmail } from './emailService';

const validatePublicKeyOrThrow = (publicKeyBase64: string): void => {
  try {
    parseDevicePublicKey(publicKeyBase64);
  } catch {
    throw AppError.badRequest(
      'publicKey is not a valid base64-encoded SPKI DER key',
      'INVALID_PUBLIC_KEY',
    );
  }
};

const assertPublicKeyAvailable = async (publicKeyBase64: string): Promise<void> => {
  const existing = await prisma.device.findUnique({ where: { publicKey: publicKeyBase64 } });
  if (existing) {
    throw AppError.conflict('This device public key is already registered', 'PUBLIC_KEY_TAKEN');
  }
};

/** Issues a fresh access + refresh token pair for a (user, device) session. */
const issueSession = async (userId: string, deviceId: string) => {
  const accessToken = signAccessToken({ sub: userId, deviceId });
  const refreshToken = generateRandomToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      deviceId,
      tokenHash: hashToken(refreshToken),
      expiresAt: addTtl(env.REFRESH_TOKEN_TTL),
    },
  });
  return { accessToken, refreshToken };
};

const issueEmailVerification = async (userId: string, emailAddr: string): Promise<void> => {
  const token = generateRandomToken();
  const code = generateVerificationCode();
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      email: emailAddr,
      tokenHash: hashToken(token),
      expiresAt: addSeconds(env.EMAIL_VERIFICATION_TTL),
      codeHash: hashToken(code),
      codeExpiresAt: addSeconds(env.EMAIL_CODE_TTL),
    },
  });
  sendVerificationEmail(emailAddr, token, code);
};

export interface RegisterInput {
  username: string;
  publicKey: string;
  deviceLabel?: string;
  email?: string;
}

// Design choice (per init_prompt.md TASK 3.1): log the user in immediately on
// registration rather than requiring a challenge round-trip for the very first
// login. A fresh registration already required possession of *some* keypair the
// client generated itself, so an extra challenge round-trip only adds latency
// without adding real assurance — the server has no prior public key to compare
// against yet either way. Every *subsequent* login still goes through the full
// challenge/signature flow.
export const registerUser = async (input: RegisterInput) => {
  const usernameTaken = await prisma.user.findUnique({ where: { username: input.username } });
  if (usernameTaken) throw AppError.conflict('Username is already taken', 'USERNAME_TAKEN');

  if (input.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email: input.email } });
    if (emailTaken) throw AppError.conflict('Email is already in use', 'EMAIL_TAKEN');
  }

  validatePublicKeyOrThrow(input.publicKey);
  await assertPublicKeyAvailable(input.publicKey);

  const user = await prisma.user.create({
    data: { username: input.username, email: input.email ?? null },
  });
  const device = await prisma.device.create({
    data: { userId: user.id, publicKey: input.publicKey, deviceLabel: input.deviceLabel ?? null },
  });

  if (input.email) {
    await issueEmailVerification(user.id, input.email);
  }

  const session = await issueSession(user.id, device.id);

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
    },
    device: { id: device.id, deviceLabel: device.deviceLabel },
    ...session,
  };
};

export const isUsernameAvailable = async (username: string): Promise<boolean> => {
  const existing = await prisma.user.findUnique({ where: { username } });
  return !existing;
};

export const createLoginChallenge = async (username: string) => {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    // Spec: generic error, don't leak whether the username exists.
    throw AppError.notFound('Invalid username or device', 'USER_NOT_FOUND');
  }

  const challenge = await prisma.challenge.create({
    data: {
      userId: user.id,
      nonce: generateRandomToken(24),
      expiresAt: addSeconds(env.CHALLENGE_TTL),
    },
  });

  return { challengeId: challenge.id, nonce: challenge.nonce };
};

export interface VerifyLoginInput {
  challengeId: string;
  signature: string;
  deviceId: string;
}

export const verifyLogin = async (input: VerifyLoginInput) => {
  const challenge = await prisma.challenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || challenge.used || challenge.expiresAt < new Date()) {
    throw AppError.unauthorized('Challenge is invalid, expired, or already used', 'INVALID_CHALLENGE');
  }

  const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
  if (!device || device.userId !== challenge.userId) {
    throw AppError.unauthorized('Device is not recognized for this account', 'INVALID_DEVICE');
  }

  const publicKey = parseDevicePublicKey(device.publicKey);
  if (!verifySignature(publicKey, challenge.nonce, input.signature)) {
    throw AppError.unauthorized('Signature verification failed', 'INVALID_SIGNATURE');
  }

  await prisma.$transaction([
    prisma.challenge.update({ where: { id: challenge.id }, data: { used: true } }),
    prisma.device.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } }),
  ]);

  return issueSession(challenge.userId, device.id);
};

export const refreshSession = async (refreshToken: string) => {
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!existing || existing.revoked || existing.expiresAt < new Date()) {
    throw AppError.unauthorized('Refresh token is invalid, expired, or revoked', 'INVALID_REFRESH_TOKEN');
  }

  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revoked: true } });
  return issueSession(existing.userId, existing.deviceId);
};

export const logout = async (refreshToken: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken) },
    data: { revoked: true },
  });
};

export const addEmail = async (userId: string, emailAddr: string): Promise<void> => {
  const existing = await prisma.user.findUnique({ where: { email: emailAddr } });
  if (existing && existing.id !== userId) {
    throw AppError.conflict('Email is already in use', 'EMAIL_TAKEN');
  }
  await prisma.user.update({ where: { id: userId }, data: { email: emailAddr, emailVerified: false } });
  await issueEmailVerification(userId, emailAddr);
};

export const verifyEmailToken = async (token: string): Promise<void> => {
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.used || record.expiresAt < new Date()) {
    throw AppError.badRequest('Verification link is invalid or expired', 'INVALID_VERIFICATION_TOKEN');
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { used: true } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { email: record.email, emailVerified: true },
    }),
  ]);
};

export const verifyEmailCode = async (userId: string, code: string): Promise<void> => {
  const record = await prisma.emailVerificationToken.findFirst({
    where: { userId, used: false },
    orderBy: { createdAt: 'desc' },
  });

  if (
    !record ||
    !record.codeHash ||
    !record.codeExpiresAt ||
    record.codeExpiresAt < new Date()
  ) {
    throw AppError.badRequest('Verification code is invalid or expired', 'INVALID_VERIFICATION_CODE');
  }

  if (record.codeAttempts >= env.EMAIL_CODE_MAX_ATTEMPTS) {
    throw AppError.badRequest(
      'Too many incorrect attempts. Request a new code.',
      'TOO_MANY_CODE_ATTEMPTS',
    );
  }

  if (hashToken(code) !== record.codeHash) {
    await prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { codeAttempts: { increment: 1 } },
    });
    throw AppError.badRequest('Verification code is invalid or expired', 'INVALID_VERIFICATION_CODE');
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { used: true } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { email: record.email, emailVerified: true },
    }),
  ]);
};

export interface RequestRecoveryInput {
  username?: string;
  email?: string;
}

// Spec deliberately asks for two things that conflict for the "found, but no email
// on file" case: a specific error message vs. never leaking account existence. This
// implementation resolves that in favor of anti-enumeration (always the same generic
// response) since the caller may be probing arbitrary usernames/emails that aren't
// their own — a distinguishable response would leak which accounts exist regardless
// of wording.
export const requestRecovery = async (input: RequestRecoveryInput): Promise<void> => {
  const user = input.username
    ? await prisma.user.findUnique({ where: { username: input.username } })
    : await prisma.user.findUnique({ where: { email: input.email } });

  if (user?.email && user.emailVerified) {
    const token = generateRandomToken();
    await prisma.recoveryToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: addSeconds(env.RECOVERY_TOKEN_TTL) },
    });
    sendRecoveryEmail(user.email, token);
  }
};

export interface ConfirmRecoveryInput {
  recoveryToken: string;
  newPublicKey: string;
  deviceLabel?: string;
}

export const confirmRecovery = async (input: ConfirmRecoveryInput) => {
  const record = await prisma.recoveryToken.findUnique({ where: { tokenHash: hashToken(input.recoveryToken) } });
  if (!record || record.used || record.expiresAt < new Date()) {
    throw AppError.badRequest('Recovery link is invalid or expired', 'INVALID_RECOVERY_TOKEN');
  }

  validatePublicKeyOrThrow(input.newPublicKey);
  await assertPublicKeyAvailable(input.newPublicKey);

  const device = await prisma.$transaction(async (tx) => {
    await tx.recoveryToken.update({ where: { id: record.id }, data: { used: true } });
    return tx.device.create({
      data: {
        userId: record.userId,
        publicKey: input.newPublicKey,
        deviceLabel: input.deviceLabel ?? null,
      },
    });
  });

  const session = await issueSession(record.userId, device.id);
  return { device: { id: device.id, deviceLabel: device.deviceLabel }, ...session };
};

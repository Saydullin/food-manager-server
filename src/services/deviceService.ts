import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { parseDevicePublicKey } from '../utils/crypto';

export interface AddDeviceInput {
  publicKey: string;
  deviceLabel?: string;
}

export const addDevice = async (userId: string, input: AddDeviceInput) => {
  try {
    parseDevicePublicKey(input.publicKey);
  } catch {
    throw AppError.badRequest('publicKey is not a valid base64-encoded SPKI DER key', 'INVALID_PUBLIC_KEY');
  }

  const existing = await prisma.device.findUnique({ where: { publicKey: input.publicKey } });
  if (existing) {
    throw AppError.conflict('This device public key is already registered', 'PUBLIC_KEY_TAKEN');
  }

  const device = await prisma.device.create({
    data: { userId, publicKey: input.publicKey, deviceLabel: input.deviceLabel ?? null },
  });

  return { id: device.id, deviceLabel: device.deviceLabel, createdAt: device.createdAt };
};

export const listDevices = async (userId: string) => {
  const devices = await prisma.device.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, deviceLabel: true, lastUsedAt: true, createdAt: true },
  });
  return devices;
};

export const revokeDevice = async (userId: string, deviceId: string): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== userId) {
    throw AppError.notFound('Device not found', 'DEVICE_NOT_FOUND');
  }

  await prisma.$transaction([
    prisma.refreshToken.updateMany({ where: { deviceId }, data: { revoked: true } }),
    prisma.device.delete({ where: { id: deviceId } }),
  ]);
};

import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';

/**
 * Parses a base64-encoded SubjectPublicKeyInfo (DER) — the format Android Keystore
 * exports for both Ed25519 and RSA public keys.
 */
export const parseDevicePublicKey = (publicKeyBase64: string): KeyObject => {
  const der = Buffer.from(publicKeyBase64, 'base64');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
};

/**
 * Verifies `signatureBase64` over `message` against the device's public key.
 * Supports Ed25519 (no digest algorithm) and RSA (RSASSA-PKCS1-v1_5 over SHA-256),
 * the two key types Android Keystore can produce for this use case.
 */
export const verifySignature = (
  publicKey: KeyObject,
  message: string,
  signatureBase64: string,
): boolean => {
  const signature = Buffer.from(signatureBase64, 'base64');
  const data = Buffer.from(message, 'utf8');

  const algorithm = publicKey.asymmetricKeyType === 'rsa' ? 'sha256' : null;

  try {
    return cryptoVerify(algorithm, data, publicKey, signature);
  } catch {
    return false;
  }
};

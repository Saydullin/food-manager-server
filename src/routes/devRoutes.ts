import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateBody } from '../middleware/validate';
import { signSchema } from '../validation/devSchemas';
import * as foodService from '../services/foodService';

/**
 * Test-only helpers that stand in for the Android Keystore (keypair generation +
 * signing) so tools like Postman — which can't do Ed25519/RSA signing on their
 * own — can drive the full challenge/verify flow. Mounted only outside production
 * (see routes/index.ts); never mirrors a real client, which never sends a private key.
 */
export const devRouter = Router();

devRouter.post(
  '/keypair',
  asyncHandler(async (_req, res) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    res.status(200).json({
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    });
  }),
);

devRouter.post(
  '/sign',
  validateBody(signSchema),
  asyncHandler(async (req, res) => {
    const keyObject = createPrivateKey({
      key: Buffer.from(req.body.privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = cryptoSign(null, Buffer.from(req.body.message, 'utf8'), keyObject).toString(
      'base64',
    );
    res.status(200).json({ signature });
  }),
);

// Seeds a fixed set of sample dishes so the food feed (GET /api/foods/feed) has
// something to return in Postman. Idempotent — safe to run repeatedly.
devRouter.get(
  '/seed-foods',
  asyncHandler(async (_req, res) => {
    const result = await foodService.seedSampleFoods();
    res.status(200).json(result);
  }),
);

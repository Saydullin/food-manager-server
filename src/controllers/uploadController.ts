import type { Response } from 'express';
import { env } from '../config/env';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/errors';

export const uploadImage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    throw AppError.badRequest(
      'No image file provided (expected multipart field "image")',
      'MISSING_FILE',
    );
  }

  const imageUrl = `${env.APP_BASE_URL}/uploads/${req.file.filename}`;
  res.status(201).json({ imageUrl });
});

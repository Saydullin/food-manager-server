import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof MulterError) {
    const messages: Partial<Record<MulterError['code'], string>> = {
      LIMIT_FILE_SIZE: `Image exceeds the maximum allowed size of ${env.UPLOAD_MAX_FILE_SIZE_MB}MB`,
      LIMIT_FILE_COUNT: 'Only one file may be uploaded at a time',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field (expected "image")',
    };
    res.status(400).json({
      error: { code: `UPLOAD_${err.code}`, message: messages[err.code] ?? err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      },
    });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};

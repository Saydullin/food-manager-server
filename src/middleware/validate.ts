import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** Validates + replaces `req.body` with the parsed (and coerced) result of `schema`. */
export const validateBody =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };

/** Validates + replaces `req.query` with the parsed result of `schema`. */
export const validateQuery =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    req.query = schema.parse(req.query);
    next();
  };

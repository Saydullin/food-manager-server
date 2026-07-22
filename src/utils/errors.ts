/**
 * Centralized application error type. Thrown anywhere in services/controllers
 * and turned into `{ error: { code, message } }` by the error-handling middleware.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }

  static badRequest(message: string, code = 'BAD_REQUEST') {
    return new AppError(400, code, message);
  }

  static unauthorized(message: string, code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }

  static forbidden(message: string, code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static notFound(message: string, code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    return new AppError(500, code, message);
  }
}

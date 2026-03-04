import type { Request, Response, NextFunction } from 'express'

interface ApiError {
  code?: string
  message?: string
}

/**
 * Central error handler — formats all errors as { error: { code, message } }.
 * Must be registered last with app.use().
 */
export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = 500
  res.status(status).json({
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.message ?? 'An unexpected error occurred',
    },
  })
}

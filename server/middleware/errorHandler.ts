import type { Request, Response, NextFunction } from 'express'

interface ApiError {
  code?: string
  message?: string
  stack?: string
}

/**
 * Central error handler — formats all errors as { error: { code, message } }.
 */
export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[ERROR]', err.stack ?? err)
  res.status(500).json({
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.message ?? 'An unexpected error occurred',
    },
  })
}

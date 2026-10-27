import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found', requestId: res.getHeader('X-Request-Id') });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err: error, requestId: res.getHeader('X-Request-Id'), path: req.path }, 'Unhandled request error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error', requestId: res.getHeader('X-Request-Id') });
}

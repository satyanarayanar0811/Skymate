import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request { auth?: { sub: string; role: 'customer' | 'admin' | 'support'; email?: string; guest?: boolean } }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ error: 'Authentication is not configured securely.' });
  try {
    const payload = jwt.verify(value.slice(7), secret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || !['customer', 'admin', 'support'].includes(String(payload.role))) {
      return res.status(401).json({ error: 'Invalid access token.' });
    }
    req.auth = { sub: payload.sub, role: payload.role as 'customer' | 'admin' | 'support', email: typeof payload.email === 'string' ? payload.email : undefined, guest: payload.guest === true };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired access token.' });
  }
}

export function requireRole(...roles: Array<'customer' | 'admin' | 'support'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: 'Insufficient permissions.' });
    next();
  };
}

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

const structuralSchema = z.object({
  body: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional()
});

export function validateRequest(req: Request, res: Response, next: NextFunction) {
  const result = structuralSchema.safeParse({ body: req.body ?? {} });
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid request structure', issues: result.error.issues.map(issue => ({ path: issue.path, message: issue.message })) });
  }
  next();
}

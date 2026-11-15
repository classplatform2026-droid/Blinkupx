import type { NextFunction, Request, Response } from 'express';

function sanitizeValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sanitizeValue);
  }
  if (val && typeof val === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k.startsWith('$') || k.includes('.')) {
        continue;
      }
      clean[k] = sanitizeValue(v);
    }
    return clean;
  }
  return val;
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  next();
}

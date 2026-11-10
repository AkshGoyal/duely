import { Request, Response, NextFunction } from 'express';

/** Fixed-window in-memory rate limiter keyed by IP. Fine for a single instance. */
export function rateLimit(opts: { windowMs: number; max: number; message: string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, opts.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { count: 1, reset: now + opts.windowMs });
      return next();
    }
    if (++h.count > opts.max) {
      res.status(429).type('text').send(opts.message);
      return;
    }
    next();
  };
}

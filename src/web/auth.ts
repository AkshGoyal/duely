import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookieSession from 'cookie-session';
import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from '../lib/rateLimit';
import { findUserByEmail, findUserById, User } from '../services/users';
import { html } from './html';
import { logoMark } from './icons';
import { barePage, Flash } from './layout';
import { btnPrimary, inputCls, labelCls } from './ui';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  console.warn('SESSION_SECRET not set: using a random secret (everyone is logged out on restart).');
  return crypto.randomBytes(32).toString('hex');
}

export const sessions = cookieSession({
  name: 'duely_session',
  keys: [sessionSecret()],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
});

/** One-shot message shown on the next page render. */
export function setFlash(req: Request, flash: Flash) {
  if (req.session) req.session.flash = flash;
}
export function takeFlash(req: Request): Flash | undefined {
  const f = req.session?.flash as Flash | undefined;
  if (req.session) req.session.flash = undefined;
  return f;
}

/** Loads req.user from the session when present. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const id = req.session?.userId;
  if (id) req.user = await findUserById(Number(id));
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/** Same-site paths only. Rejects //host and /\\host (browsers treat a backslash like a slash). */
const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?![\/\\])/.test(n) && !/[\\\s]/.test(n) ? n : '/');

function loginPage(opts: { error?: string; email?: string; next?: string }) {
  return barePage({
    title: 'Log in · Duely',
    body: html`
    <div class="min-h-screen flex flex-col items-center justify-center px-4">
      <a href="/" class="flex items-center gap-2 font-semibold text-xl tracking-tight mb-2">${logoMark('h-9 w-9')} Duely</a>
      <p class="mb-8 text-sm text-slate-500 text-center max-w-xs">Your own Claude chases overdue invoices. Duely keeps every pay link live and every promise on record.</p>
      <form method="post" action="/login" class="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-card p-6 sm:p-8 space-y-5">
        <div>
          <h1 class="text-lg font-semibold">Log in</h1>
        </div>
        ${opts.error ? html`<p role="alert" class="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">${opts.error}</p>` : ''}
        <input type="hidden" name="next" value="${opts.next ?? '/'}" />
        <div><label class="${labelCls}" for="email">Email</label>
          <input class="${inputCls}" id="email" name="email" type="email" autocomplete="username" required value="${opts.email ?? ''}" /></div>
        <div><label class="${labelCls}" for="password">Password</label>
          <input class="${inputCls}" id="password" name="password" type="password" autocomplete="current-password" required /></div>
        <button class="${btnPrimary} w-full" type="submit" data-loading="Logging in…">Log in</button>
        <div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 text-center">Demo account: <span class="font-mono whitespace-nowrap">demo@duely.app</span> / <span class="font-mono whitespace-nowrap">duely-demo-2026</span></div>
      </form>
    </div>`,
  });
}

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(String(loginPage({ next: safeNext(req.query.next) })));
});

authRouter.post(
  '/login',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Too many login attempts. Try again in a few minutes.' }),
  async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    const next = safeNext(req.body?.next);
    const user = email ? await findUserByEmail(email) : undefined;
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).send(String(loginPage({ error: 'Email or password is incorrect.', email, next })));
      return;
    }
    req.session!.userId = user.id;
    res.redirect(next);
  },
);

const logout = (req: Request, res: Response) => {
  req.session = null;
  res.redirect('/login');
};
authRouter.get('/logout', logout);
authRouter.post('/logout', logout);

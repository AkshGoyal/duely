import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookieSession from 'cookie-session';
import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from '../lib/rateLimit';
import { findUserByEmail, findUserById, User } from '../services/users';
import { html } from './html';
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

const safeNext = (n: unknown) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function loginPage(opts: { error?: string; email?: string; next?: string }) {
  return barePage({
    title: 'Log in · Duely',
    body: html`
    <div class="min-h-screen flex flex-col items-center justify-center px-4">
      <a href="/" class="flex items-center gap-2 font-semibold text-lg mb-8">
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">₹</span> Duely
      </a>
      <form method="post" action="/login" class="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <h1 class="text-lg font-semibold">Log in</h1>
          <p class="text-sm text-slate-500 mt-1">Your Claude chases. Duely remembers.</p>
        </div>
        ${opts.error ? html`<p class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">${opts.error}</p>` : ''}
        <input type="hidden" name="next" value="${opts.next ?? '/'}" />
        <div><label class="${labelCls}" for="email">Email</label>
          <input class="${inputCls}" id="email" name="email" type="email" autocomplete="username" required value="${opts.email ?? ''}" /></div>
        <div><label class="${labelCls}" for="password">Password</label>
          <input class="${inputCls}" id="password" name="password" type="password" autocomplete="current-password" required /></div>
        <button class="${btnPrimary} w-full" type="submit">Log in</button>
        <p class="text-xs text-slate-500 text-center">Demo: demo@duely.app / duely-demo-2026</p>
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

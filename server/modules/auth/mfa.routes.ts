import { createRequire } from 'node:module';

import express, { type RequestHandler } from 'express';

import { AppError, IS_PLATFORM } from '../../shared/utils.js';
import { getConnection, userDb } from '../database/index.js';

import { getMfaStore, requireRecentMfa } from './services/mfa-runtime.service.js';
import { getSessionRuntime } from './services/session-runtime.service.js';
import { clearSessionCookie, sessionCookie } from './services/session-transport.service.js';
import type { AuthSession } from './services/session-store.service.js';
import { MIN_PASSWORD_LENGTH } from './auth.service.js';

type AuthRequest = express.Request & { user?: { id: number; username: string }; authSession?: AuthSession; releaseAuthConnection?: () => void };
const bcrypt = createRequire(import.meta.url)('bcryptjs') as { hash(value: string, cost: number): Promise<string> };
const credentials = (req: AuthRequest) => {
  if (!req.user || !req.authSession) throw new AppError('A browser session is required', { code: 'AUTH_USER_REQUIRED', statusCode: 401 });
  return { user: req.user, session: req.authSession };
};

export function createMfaRouter(verifyPassword: (id: number, password: string, ip?: string) => Promise<boolean>, authenticate: RequestHandler) {
  const router = express.Router();
  const handle = (run: (req: AuthRequest, res: express.Response) => unknown): RequestHandler => async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await run(req, res); } catch (error) {
      if (error instanceof AppError && error.code === 'AUTH_RATE_LIMITED') {
        const retry = (error.details as { retryAfterSeconds?: number })?.retryAfterSeconds;
        if (retry) res.setHeader('Retry-After', String(retry));
      }
      if (error instanceof AppError && error.code === 'MFA_SESSION_REVOKED') {
        res.setHeader('X-Auth-Error', 'mfa-attempts-exceeded');
        res.setHeader('Set-Cookie', clearSessionCookie(req));
      }
      next(error);
    }
  };
  const passwordCheck = async (req: AuthRequest, id: number) => {
    if (typeof req.body?.password !== 'string' || !(await verifyPassword(id, req.body.password, req.ip))) {
      throw new AppError('Password is incorrect', { code: 'AUTH_INVALID_CREDENTIALS', statusCode: 403 });
    }
    // Password comparison is asynchronous: reject a session revoked while it was running.
    if (!req.authSession || !getSessionRuntime().store.getActive(req.authSession.id)) {
      throw new AppError('Please sign in again', { code: 'AUTH_TOKEN_INVALID', statusCode: 401 });
    }
  };
  /**
   * Replacing recovery codes and disabling TOTP weaken the second factor, so the recent-verification
   * window alone is not enough: the request itself must carry the password and a new authenticator code.
   * A recovery code is never accepted here, and the code goes through the same replay guard and
   * per-session attempt counter as /mfa/reauth.
   */
  const stepUp = async (req: AuthRequest, id: number, session: AuthSession) => {
    if (!getMfaStore().enabled(id)) throw new AppError('Enable TOTP first', { code: 'MFA_DISABLED', statusCode: 409 });
    await passwordCheck(req, id);
    requireRecentMfa(id, session);
    // A fifth wrong code revokes this session; keep this response deliverable when that closes its connections.
    req.releaseAuthConnection?.();
    getMfaStore().verifySessionTotp(id, session.id, req.body?.code, getSessionRuntime().store);
  };
  router.post('/mfa/verify', handle((req, res) => {
    const { userId, verifiedAt } = getMfaStore().completeLogin(req.body?.challenge, req.body?.code, req.body?.recovery === true);
    const user = userDb.getUserById(userId);
    if (!user) throw new AppError('Please sign in again', { code: 'AUTH_USER_REQUIRED', statusCode: 401 });
    const { secret, session } = getSessionRuntime().store.create(userId, req.get('user-agent'), verifiedAt);
    res.setHeader('Set-Cookie', sessionCookie(req, secret, session.expiresAt));
    userDb.updateLastLogin(userId);
    res.json({ success: true, user: { id: user.id, username: user.username } });
  }));
  router.get('/mfa/status', authenticate, handle((req, res) => {
    const { user, session } = credentials(req);
    res.json({ enabled: getMfaStore().enabled(user.id), verifiedAt: session.mfaVerifiedAt });
  }));
  router.post('/mfa/enroll', authenticate, handle(async (req, res) => {
    if (IS_PLATFORM) throw new AppError('TOTP cannot be used in platform mode', { code: 'MFA_PLATFORM_UNSUPPORTED', statusCode: 409 });
    const { user, session } = credentials(req);
    await passwordCheck(req, user.id);
    requireRecentMfa(user.id, session);
    res.json(getMfaStore().beginEnrollment(user.id, user.username, session.id));
  }));
  router.post('/mfa/activate', authenticate, handle((req, res) => {
    const { user, session } = credentials(req);
    if (IS_PLATFORM) throw new AppError('TOTP cannot be used in platform mode', { code: 'MFA_PLATFORM_UNSUPPORTED', statusCode: 409 });
    requireRecentMfa(user.id, session);
    const result = getMfaStore().activate(user.id, session.id, req.body?.code);
    const { store } = getSessionRuntime();
    store.markMfa(session.id, Date.now());
    store.revokeAll(user.id, session.id);
    res.json({ enabled: true, ...result });
  }));
  router.post('/mfa/reauth', authenticate, handle((req, res) => {
    const { user, session } = credentials(req);
    req.releaseAuthConnection?.();
    getMfaStore().verifySessionTotp(user.id, session.id, req.body?.code, getSessionRuntime().store);
    const verifiedAt = Date.now();
    getSessionRuntime().store.markMfa(session.id, verifiedAt);
    res.json({ success: true, verifiedAt });
  }));
  router.post('/mfa/disable', authenticate, handle(async (req, res) => {
    const { user, session } = credentials(req);
    await stepUp(req, user.id, session);
    getMfaStore().disable(user.id);
    const { store } = getSessionRuntime();
    store.markMfa(session.id, null);
    store.revokeAll(user.id, session.id);
    res.json({ enabled: false });
  }));
  router.post('/mfa/recovery-codes', authenticate, handle(async (req, res) => {
    const { user, session } = credentials(req);
    await stepUp(req, user.id, session);
    res.json({ recoveryCodes: getMfaStore().regenerateRecovery(user.id) });
  }));
  router.post('/password', authenticate, handle(async (req, res) => {
    const { user, session } = credentials(req);
    await passwordCheck(req, user.id);
    requireRecentMfa(user.id, session);
    const next = req.body?.newPassword;
    if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(next) > 72) {
      throw new AppError('Use at least 12 characters and at most 72 bytes', { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 });
    }
    const hash = await bcrypt.hash(next, 12);
    if (!getSessionRuntime().store.getActive(session.id)) throw new AppError('Please sign in again', { code: 'AUTH_TOKEN_INVALID', statusCode: 401 });
    requireRecentMfa(user.id, session);
    getConnection().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    getMfaStore().invalidateChallenges(user.id);
    getSessionRuntime().store.revokeAll(user.id, session.id);
    res.json({ success: true });
  }));
  return router;
}

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

import express from 'express';
import { TOTP } from 'otpauth';

import { AppError } from '../../../shared/utils.js';
import { getConnection, apiKeysDb } from '../../database/index.js';
import { settingsRoutes } from '../../settings/index.js';
import { authRoutes } from '../auth.module.js';
import { authenticateToken } from '../auth.middleware.js';
import { createApiSessionGuard } from '../services/api-session-guard.service.js';
import { getSessionRuntime } from '../services/session-runtime.service.js';

import { withIsolatedAuthDatabase } from './with-isolated-auth-database.js';

const bcrypt = createRequire(import.meta.url)('bcryptjs');
const password = 'synthetic-owner-password';
const otp = (secret: string) => new TOTP({ secret }).generate({ timestamp: Date.now() });
async function fixture(run: (base: string) => Promise<void>) {
  const old = process.env.REMOTECLI_MASTER_KEY;
  try {
    process.env.REMOTECLI_MASTER_KEY = randomBytes(32).toString('base64');
    await withIsolatedAuthDatabase(async (user) => {
      getConnection().prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(password, 4), user.id);
      const app = express();
      app.use('/api', createApiSessionGuard(authenticateToken)); app.use(express.json());
      app.use('/api/auth', authRoutes);
      app.get('/api/private', (_req, res) => res.json({ ok: true }));
      app.post('/api/settings/api-keys', (_req, res) => res.json({ ok: true }));
      app.use('/api/settings', settingsRoutes);
      app.post('/api/remote/peers/join', (_req, res) => res.json({ ok: true }));
      app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const known = error instanceof AppError;
        res.status(known ? error.statusCode : 500).json({ code: known ? error.code : 'INTERNAL', ...(known ? { details: error.details } : {}) });
      });
      const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
      try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
      finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  } finally {
    if (old === undefined) delete process.env.REMOTECLI_MASTER_KEY; else process.env.REMOTECLI_MASTER_KEY = old;
  }
}
function request(base: string, path: string, body?: unknown, cookie?: string, method = body === undefined ? 'GET' : 'POST') {
  return fetch(base + '/api' + path, { method,
    headers: { Origin: base, 'X-RemoteCLI-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const cookieOf = (response: Response) => response.headers.get('set-cookie')?.split(';', 1)[0];
async function login(base: string) {
  const response = await request(base, '/auth/login', { username: 'alice', password });
  assert.equal(response.status, 200); return response;
}
async function enroll(base: string, cookie: string) {
  const response = await request(base, '/auth/mfa/enroll', { password }, cookie);
  assert.equal(response.status, 200);
  const enrollment = await response.json();
  const activation = await request(base, '/auth/mfa/activate', { code: otp(enrollment.secret) }, cookie);
  assert.equal(activation.status, 200);
  return { ...enrollment, ...await activation.json() } as { secret: string; recoveryCodes: string[] };
}

test('A-01/A-02/A-04/K-02/K-08: password alone issues no MFA session; two simultaneous code submissions issue exactly one', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const a = cookieOf(await login(base))!, b = cookieOf(await login(base))!;
    const e = await enroll(base, a);
    assert.equal((await request(base, '/private', undefined, b)).status, 401);
    t.mock.timers.tick(30_000);
    const response = await login(base);
    assert.equal(cookieOf(response), undefined);
    const body = await response.json(); assert.equal(body.user, undefined); assert.equal(body.token, undefined);
    assert.equal((await request(base, '/private', undefined, `remotecli_session=${body.challenge}`)).status, 401);
    const otherChallenge = await (await login(base)).json();
    const responses = await Promise.all([body.challenge, otherChallenge.challenge].map(challenge => request(base, '/auth/mfa/verify', { challenge, code: otp(e.secret) })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200,403]);
    const cookie = cookieOf(responses.find(r => r.status === 200)!)!;
    assert.ok(cookie && cookie !== a);
    assert.equal((await request(base, '/private', undefined, cookie)).status, 200);
    assert.equal((await request(base, '/auth/user', undefined, cookie)).status, 200, 'reload does not need another OTP');
  });
});

test('T-06/K-09: two simultaneous logins cannot consume one recovery code twice', async () => {
  await fixture(async base => {
    const a = cookieOf(await login(base))!; const e = await enroll(base, a);
    const challenges = await Promise.all([login(base),login(base)]).then(rs => Promise.all(rs.map(r => r.json())));
    const replies = await Promise.all(challenges.map(c => request(base, '/auth/mfa/verify', { challenge: c.challenge, code: e.recoveryCodes[0], recovery: true })));
    assert.deepEqual(replies.map(r => r.status).sort(), [200,403]);
    const cookie = cookieOf(replies.find(r => r.status === 200)!)!;
    assert.equal((await request(base, '/settings/api-keys', {}, cookie)).status, 403, 'recovery is not fresh TOTP');
  });
});

test('C-09/K-10: sensitive operations require reauthentication at ten minutes; activation requires a fresh password', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const a = cookieOf(await login(base))!;
    assert.equal((await request(base, '/auth/mfa/enroll', { password: 'wrong' }, a)).status, 403);
    const e = await enroll(base, a);
    t.mock.timers.tick(599_999);
    assert.equal((await request(base, '/settings/api-keys', {}, a)).status, 200);
    t.mock.timers.tick(1);
    for (const path of ['/settings/api-keys','/remote/peers/join','/REMOTE/PEERS/JOIN','/auth/mfa/disable','/auth/mfa/recovery-codes']) {
      assert.equal((await request(base, path, {}, a)).status, 403, path);
    }
    const reauth = await request(base, '/auth/mfa/reauth', { code: otp(e.secret) }, a);
    assert.equal(reauth.status, 200);
    assert.equal((await request(base, '/settings/api-keys', {}, a)).status, 200);
    assert.equal((await request(base, '/remote/peers/join', {}, a)).status, 200);
  });
});

test('T-08/T-10/K-24: password change and disabling MFA preserve this session and revoke others', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const a = cookieOf(await login(base))!; const e = await enroll(base, a); t.mock.timers.tick(30_000);
    const challenge = await (await login(base)).json();
    const b = cookieOf(await request(base, '/auth/mfa/verify', { challenge: challenge.challenge, code: otp(e.secret) }))!;
    const changed = await request(base, '/auth/password', { password, newPassword: 'synthetic-new-owner-password' }, a);
    assert.equal(changed.status, 200);
    assert.equal((await request(base, '/private', undefined, a)).status, 200);
    assert.equal((await request(base, '/private', undefined, b)).status, 401);
    const { store } = getSessionRuntime();
    const other = store.create(1, '', Date.now());
    getConnection().prepare('UPDATE auth_sessions SET locked_at=1 WHERE id=?').run(other.session.id);
    t.mock.timers.tick(30_000);
    assert.equal((await request(base, '/auth/mfa/disable', { password: 'synthetic-new-owner-password', code: otp(e.secret) }, a)).status, 200);
    assert.equal(store.authenticate(other.secret), null);
    assert.equal((await request(base, '/private', undefined, a)).status, 200);
    const newLogin = await request(base, '/auth/login', { username: 'alice', password: 'synthetic-new-owner-password' });
    assert.ok(cookieOf(newLogin));
  });
});


test('G-04/L-02/L-09/L-11: locked cookie can only inspect, unlock with TOTP, or logout', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const cookie = cookieOf(await login(base))!;
    assert.equal((await request(base, '/auth/lock', {}, cookie)).status, 409);
    assert.equal((await (await request(base, '/auth/session-status', undefined, cookie)).json()).autoLock, null);
    const enrollment = await enroll(base, cookie);
    assert.equal((await (await request(base, '/auth/session-status', undefined, cookie)).json()).autoLock, true);
    const locked = await request(base, '/auth/lock', {}, cookie);
    assert.equal(locked.status, 200, 'lock response must survive closing the other transports');
    assert.equal(cookieOf(locked), undefined, 'locking does not replace or clear the cookie');
    for (const [path, body] of [
      ['/private', undefined], ['/auth/user', undefined], ['/auth/login', { username: 'alice', password }],
      ['/auth/mfa/verify', { challenge: 'fake', code: '000000' }], ['/auth/auto-lock', { enabled: false }],
    ] as const) {
      const response = await request(base, path, body, cookie, path === '/auth/auto-lock' ? 'PUT' : body === undefined ? 'GET' : 'POST');
      assert.equal(response.status, 423, path);
      assert.equal(response.headers.get('x-auth-error'), null, 'locked is not expired');
    }
    const status = await request(base, '/auth/session-status', undefined, cookie);
    assert.equal((await status.json()).locked, true);
    assert.equal((await request(base, '/auth/unlock', { code: enrollment.recoveryCodes[0] }, cookie)).status, 403);
    t.mock.timers.tick(30_000);
    const unlocked = await request(base, '/auth/unlock', { code: otp(enrollment.secret) }, cookie);
    assert.equal(unlocked.status, 200);
    assert.equal(cookieOf(unlocked), undefined);
    assert.equal((await request(base, '/private', undefined, cookie)).status, 200);
    assert.equal((await request(base, '/auth/lock', {}, cookie)).status, 200);
    assert.equal((await request(base, '/auth/logout', {}, cookie)).status, 200);
    assert.equal((await request(base, '/auth/session-status', undefined, cookie)).status, 401);
  });
});

test('L-08/L-12: turning off default auto-lock requires fresh TOTP, enabling it does not', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const cookie = cookieOf(await login(base))!;
    const enrollment = await enroll(base, cookie);
    t.mock.timers.tick(600_000);
    const stale = await request(base, '/auth/auto-lock', { enabled: false }, cookie, 'PUT');
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).code, 'MFA_REAUTH_REQUIRED');
    assert.equal((await request(base, '/auth/mfa/reauth', { code: otp(enrollment.secret) }, cookie)).status, 200);
    assert.equal((await request(base, '/auth/auto-lock', { enabled: false }, cookie, 'PUT')).status, 200);
    t.mock.timers.tick(600_000);
    assert.equal((await request(base, '/auth/auto-lock', { enabled: true }, cookie, 'PUT')).status, 200);
  });
});


test('R7-01: enabling API keys needs recent TOTP; disabling and accounts without TOTP do not', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const cookie = cookieOf(await login(base))!;
    const key = apiKeysDb.createApiKey(1, 'synthetic-key');
    const path = `/settings/api-keys/${key.id}/toggle`;
    for (const isActive of [false, true]) {
      assert.equal((await request(base, path, { isActive }, cookie, 'PATCH')).status, 200);
    }
    const enrollment = await enroll(base, cookie);
    t.mock.timers.tick(600_000);
    assert.equal((await request(base, path, { isActive: false }, cookie, 'PATCH')).status, 200);
    const refused = await request(base, path, { isActive: true }, cookie, 'PATCH');
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, 'MFA_REAUTH_REQUIRED');
    assert.equal(apiKeysDb.getApiKeys(1).find(k => k.id === key.id)?.is_active, 0);
    assert.equal((await request(base, '/auth/mfa/reauth', { code: otp(enrollment.secret) }, cookie)).status, 200);
    assert.equal((await request(base, path, { isActive: true }, cookie, 'PATCH')).status, 200);
    assert.equal(apiKeysDb.getApiKeys(1).find(k => k.id === key.id)?.is_active, 1);
  });
});


test('R7-02: increasing hours needs recent TOTP, decreasing does not; invalid input never changes policy', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const cookie = cookieOf(await login(base))!;
    const enrollment = await enroll(base, cookie);
    const status = async () => (await (await request(base, '/auth/session-status', undefined, cookie)).json()).idleHours;
    assert.equal(await status(), 24);
    t.mock.timers.tick(600_000);
    const refused = await request(base, '/auth/auto-lock', { idleHours: 48 }, cookie, 'PUT');
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, 'MFA_REAUTH_REQUIRED');
    assert.equal(await status(), 24);
    for (const idleHours of [0, 169, -1, 1.5, '2', null, true, {}, []]) {
      assert.equal((await request(base, '/auth/auto-lock', { idleHours }, cookie, 'PUT')).status, 400);
      assert.equal(await status(), 24);
    }
    assert.equal((await request(base, '/auth/auto-lock', {}, cookie, 'PUT')).status, 400);
    assert.equal((await request(base, '/auth/auto-lock', { idleHours: 1 }, cookie, 'PUT')).status, 200);
    assert.equal(await status(), 1);
    assert.equal((await request(base, '/auth/auto-lock', { idleHours: 1, enabled: false }, cookie, 'PUT')).status, 403);
    assert.equal((await request(base, '/auth/mfa/reauth', { code: otp(enrollment.secret) }, cookie)).status, 200);
    assert.equal((await request(base, '/auth/auto-lock', { idleHours: 168 }, cookie, 'PUT')).status, 200);
    assert.equal(await status(), 168);
    assert.equal((await request(base, '/auth/auto-lock', { idleHours: 48, enabled: false }, cookie, 'PUT')).status, 200);
    const saved = await (await request(base, '/auth/session-status', undefined, cookie)).json();
    assert.equal(saved.idleHours, 48); assert.equal(saved.autoLock, false);
  });
});


test('TH-01/02/05/06/08: unlock and reauth share five attempts only within the caller session', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const a=cookieOf(await login(base))!; const e=await enroll(base,a);
    t.mock.timers.tick(30_000);
    const challenge=await (await login(base)).json();
    const b=cookieOf(await request(base,'/auth/mfa/verify',{challenge:challenge.challenge,code:otp(e.secret)}))!;
    for(let n=1;n<=3;n++) {
      const response=await request(base,'/auth/mfa/reauth',{code:'bad'},a);
      assert.equal(response.status,403);assert.equal((await response.json()).details.attemptsRemaining,5-n);
    }
    assert.equal((await request(base,'/auth/lock',{},a)).status,200);
    const fourth=await request(base,'/auth/unlock',{code:'bad'},a);
    assert.equal(fourth.status,403);assert.equal((await fourth.json()).details.attemptsRemaining,1);
    const last=await request(base,'/auth/unlock',{code:'bad'},a);
    assert.equal(last.status,401);assert.equal((await last.json()).code,'MFA_SESSION_REVOKED');
    assert.equal(last.headers.get('X-Auth-Error'),'mfa-attempts-exceeded');
    assert.match(last.headers.get('Set-Cookie')! ,/Max-Age=0/);
    assert.equal((await request(base,'/private',undefined,a)).status,401);
    t.mock.timers.tick(30_000);
    assert.equal((await request(base,'/auth/mfa/reauth',{code:otp(e.secret)},b)).status,200);
    await request(base,'/auth/lock',{},b);t.mock.timers.tick(30_000);
    assert.equal((await request(base,'/auth/unlock',{code:otp(e.secret)},b)).status,200);
    t.mock.timers.tick(30_000);
    const fresh=await (await login(base)).json();
    assert.equal((await request(base,'/auth/mfa/verify',{challenge:fresh.challenge,code:otp(e.secret)})).status,200);
  });
});

test('TH-02: fifth reauth response survives revoking its own HTTP connection', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const a=cookieOf(await login(base))!;await enroll(base,a);
    for(let n=0;n<4;n++) assert.equal((await request(base,'/auth/mfa/reauth',{code:'bad'},a)).status,403);
    const last=await request(base,'/auth/mfa/reauth',{code:'bad'},a);
    assert.equal(last.status,401);assert.equal(last.headers.get('X-Auth-Error'),'mfa-attempts-exceeded');
  });
});


const totpRow = () => getConnection().prepare('SELECT enabled, seed_sealed, last_used_step FROM auth_totp WHERE user_id = 1').get() as { enabled: number; seed_sealed: Buffer | null };
const recoveryRows = () => getConnection().prepare('SELECT code_hash FROM auth_recovery_codes WHERE user_id = 1 ORDER BY code_hash').all();

for (const path of ['/auth/mfa/recovery-codes', '/auth/mfa/disable'] as const) {
  test(`MR-01/MR-02/MR-04/MR-07: ${path} needs the password, a recent verification and a new authenticator code`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    await fixture(async base => {
      const cookie = cookieOf(await login(base))!; const e = await enroll(base, cookie);
      const before = { totp: totpRow(), codes: recoveryRows() };
      const unchanged = () => { assert.deepEqual(totpRow().enabled, 1); assert.deepEqual(recoveryRows(), before.codes); };
      t.mock.timers.tick(30_000);
      const refuse = async (body: unknown, code: string) => {
        const response = await request(base, path, body, cookie);
        assert.equal(response.status, 403, JSON.stringify(body)); assert.equal((await response.json()).code, code); unchanged();
      };
      // (a) missing or wrong password, even with a valid code; the code is not consumed.
      await refuse({ code: otp(e.secret) }, 'AUTH_INVALID_CREDENTIALS');
      await refuse({ password: 'wrong-password', code: otp(e.secret) }, 'AUTH_INVALID_CREDENTIALS');
      // (b) missing or wrong code.
      await refuse({ password }, 'MFA_CODE_INVALID');
      await refuse({ password, code: '000000' }, 'MFA_CODE_INVALID');
      // (f) a recovery code is not an authenticator code.
      await refuse({ password, code: e.recoveryCodes[0] }, 'MFA_CODE_INVALID');
      // (c) a code already used by /mfa/reauth in this step is a replay.
      t.mock.timers.tick(30_000);
      const used = otp(e.secret);
      assert.equal((await request(base, '/auth/mfa/reauth', { code: used }, cookie)).status, 200);
      await refuse({ password, code: used }, 'MFA_CODE_INVALID');
      // (d) outside the ten-minute window, before the code is checked.
      t.mock.timers.tick(600_000);
      await refuse({ password, code: otp(e.secret) }, 'MFA_REAUTH_REQUIRED');
      assert.equal((await request(base, '/auth/mfa/reauth', { code: otp(e.secret) }, cookie)).status, 200);
      // (g)/(h) all three conditions met.
      t.mock.timers.tick(30_000);
      const response = await request(base, path, { password, code: otp(e.secret) }, cookie);
      assert.equal(response.status, 200);
      if (path === '/auth/mfa/recovery-codes') {
        const { recoveryCodes } = await response.json() as { recoveryCodes: string[] };
        assert.equal(recoveryCodes.length, 10);
        assert.notDeepEqual(recoveryRows(), before.codes);
        t.mock.timers.tick(30_000);
        const old = await request(base, '/auth/mfa/verify', { challenge: (await (await login(base)).json()).challenge, code: e.recoveryCodes[1], recovery: true });
        assert.equal(old.status, 403, 'an old recovery code no longer signs in');
        const fresh = await request(base, '/auth/mfa/verify', { challenge: (await (await login(base)).json()).challenge, code: recoveryCodes[0], recovery: true });
        assert.equal(fresh.status, 200);
      } else {
        assert.deepEqual(await response.json(), { enabled: false });
        assert.equal(totpRow().enabled, 0); assert.equal(totpRow().seed_sealed, null); assert.equal(recoveryRows().length, 0);
      }
    });
  });

  test(`MR-03/MR-07: ${path} refuses a session signed in with a recovery code`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    await fixture(async base => {
      const e = await enroll(base, cookieOf(await login(base))!);
      const challenge = (await (await login(base)).json()).challenge;
      const recovered = cookieOf(await request(base, '/auth/mfa/verify', { challenge, code: e.recoveryCodes[0], recovery: true }))!;
      t.mock.timers.tick(30_000);
      const response = await request(base, path, { password, code: otp(e.secret) }, recovered);
      assert.equal(response.status, 403); assert.equal((await response.json()).code, 'MFA_REAUTH_REQUIRED');
      assert.equal(totpRow().enabled, 1);
    });
  });
}

test('MR-04: wrong codes on a weakening action share the session attempt limit and end the session', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await fixture(async base => {
    const cookie = cookieOf(await login(base))!; await enroll(base, cookie);
    for (let n = 1; n <= 4; n++) {
      const response = await request(base, n % 2 ? '/auth/mfa/disable' : '/auth/mfa/recovery-codes', { password, code: '000000' }, cookie);
      assert.equal(response.status, 403); assert.equal((await response.json()).details.attemptsRemaining, 5 - n);
    }
    const last = await request(base, '/auth/mfa/disable', { password, code: '000000' }, cookie);
    assert.equal(last.status, 401); assert.equal((await last.json()).code, 'MFA_SESSION_REVOKED');
    assert.equal(last.headers.get('X-Auth-Error'), 'mfa-attempts-exceeded');
    assert.equal((await request(base, '/private', undefined, cookie)).status, 401);
    assert.equal(totpRow().enabled, 1);
  });
});

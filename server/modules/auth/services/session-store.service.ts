import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Database } from '../../database/index.js';

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_SESSION_IDLE_HOURS = 24;
export const SESSION_IDLE_LOCK_MS = DEFAULT_SESSION_IDLE_HOURS * 60 * 60 * 1000;
export const DEFAULT_SESSION_AUTO_LOCK = true;
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const MIGRATION_ID = 'auth-sessions-v1';

export type AuthSession = {
  id: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  lockedAt: number | null;
  revokedAt: number | null;
  mfaVerifiedAt: number | null;
  browser: string;
};

type SessionRow = {
  id: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  locked_at: number | null;
  revoked_at: number | null;
  mfa_verified_at: number | null;
  browser: string;
};

type EndReason = 'logout' | 'revoked' | 'expired';
export type ConnectionEndReason = EndReason | 'locked';
type SessionEnd = { sessionId: string; reason: ConnectionEndReason };

const digest = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const rowToSession = (row: SessionRow): AuthSession => ({
  id: row.id,
  userId: row.user_id,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
  lockedAt: row.locked_at,
  revokedAt: row.revoked_at,
  mfaVerifiedAt: row.mfa_verified_at,
  browser: row.browser,
});

/** Store only a bounded browser label, never arbitrary request-header contents. */
export function browserFamily(userAgent = ''): string {
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/OPR\//i.test(userAgent)) return 'Opera';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  if (/Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return 'Other';
}

/** Additive schema change. The migration marker and legacy tab-token epoch move atomically. */
export function migrateAuthSessions(db: Database, now = Date.now()): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        locked_at INTEGER,
        revoked_at INTEGER,
        mfa_verified_at INTEGER,
        browser TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
      CREATE TABLE IF NOT EXISTS auth_session_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        auto_lock INTEGER NOT NULL CHECK(auto_lock IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    db.exec(`CREATE TABLE IF NOT EXISTS auth_session_idle_policy (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      idle_hours INTEGER NOT NULL DEFAULT 24 CHECK(typeof(idle_hours) = 'integer' AND idle_hours BETWEEN 1 AND 168)
    )`);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run('auth-session-idle-policy-v1', now);
    db.exec(`CREATE TABLE IF NOT EXISTS auth_session_mfa_attempts (
      session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
      failures INTEGER NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 4)
    )`);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run('auth-session-mfa-attempts-v1', now);
    if (db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(MIGRATION_ID)) return;
    const stored = db.prepare<{ value: string }>('SELECT value FROM app_config WHERE key = ?')
      .get('auth.token_epoch');
    const epoch = Number.parseInt(stored?.value ?? '0', 10);
    const next = Number.isSafeInteger(epoch) && epoch >= 0 ? epoch + 1 : 1;
    db.prepare(`INSERT INTO app_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run('auth.token_epoch', String(next));
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(MIGRATION_ID, now);
  })();
}

/** Persistence and revocation, independent of HTTP, cookies, or a running server. */
export function createSessionStore(db: Database, now: () => number = () => Date.now()) {
  const ended = new Set<(event: SessionEnd) => void>();
  const activity = new Map<string, number>();
  const event = (session: AuthSession, kind: string, at: number) => {
    db.prepare('INSERT INTO auth_events (user_id, session_id, kind, created_at) VALUES (?, ?, ?, ?)')
      .run(session.userId, session.id, kind, at);
  };
  const notify = (sessionId: string, reason: ConnectionEndReason) => {
    activity.delete(sessionId);
    for (const listener of [...ended]) {
      try { listener({ sessionId, reason }); } catch {
        // One transport failing to close must not prevent revocation of the others.
      }
    }
  };
  const read = (id: string): AuthSession | null => {
    const row = db.prepare<SessionRow>('SELECT * FROM auth_sessions WHERE id = ?').get(id);
    return row ? rowToSession(row) : null;
  };
  const revoke = (id: string, userId: number, reason: EndReason = 'revoked'): boolean => {
    const changed = db.transaction(() => {
      const session = read(id);
      if (!session || session.userId !== userId || session.revokedAt !== null) return false;
      const at = now();
      const result = db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(at, id);
      if (result.changes !== 1) return false;
      db.prepare('DELETE FROM auth_session_mfa_attempts WHERE session_id=?').run(id);
      event(session, reason, at);
      return true;
    })();
    if (changed) notify(id, reason);
    return changed;
  };
  const mfaEnabled = (userId: number): boolean => Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_totp'").get()
    && db.prepare('SELECT 1 FROM auth_totp WHERE user_id=? AND enabled=1').get(userId));
  const autoLockEnabled = (userId: number): boolean => {
    const row = db.prepare<{ auto_lock: number }>('SELECT auto_lock FROM auth_session_preferences WHERE user_id=?').get(userId);
    return row ? row.auto_lock === 1 : DEFAULT_SESSION_AUTO_LOCK;
  };
  const idleLockHours = (userId: number): number =>
    db.prepare<{ idle_hours: number }>('SELECT idle_hours FROM auth_session_idle_policy WHERE user_id=?').get(userId)?.idle_hours
      ?? DEFAULT_SESSION_IDLE_HOURS;
  const lock = (id: string): boolean => {
    const changed = db.transaction(() => {
      const session = read(id);
      if (!session || session.revokedAt !== null || session.lockedAt !== null || session.expiresAt <= now() || !mfaEnabled(session.userId)) return false;
      const at = now();
      const result = db.prepare('UPDATE auth_sessions SET locked_at=? WHERE id=? AND revoked_at IS NULL AND locked_at IS NULL').run(at, id);
      if (result.changes !== 1) return false;
      event(session, 'locked', at);
      return true;
    })();
    if (changed) notify(id, 'locked');
    return changed;
  };
  const getCurrent = (id: string): AuthSession | null => {
    const session = read(id);
    if (!session || session.revokedAt !== null) return null;
    if (session.expiresAt <= now()) {
      revoke(id, session.userId, 'expired');
      return null;
    }
    const enabled = mfaEnabled(session.userId);
    if (session.mfaVerifiedAt === null && enabled) return null;
    if (session.lockedAt === null && enabled && autoLockEnabled(session.userId)
      && now() - (activity.get(id) ?? session.lastSeenAt) >= idleLockHours(session.userId) * 60 * 60 * 1000) {
      lock(id);
      return read(id);
    }
    return session;
  };
  const getActive = (id: string): AuthSession | null => {
    const session = getCurrent(id);
    return session?.lockedAt === null ? session : null;
  };

  return {
    create(userId: number, userAgent = '', mfaVerifiedAt: number | null = null): { secret: string; session: AuthSession } {
      const at = now();
      const secret = randomBytes(32).toString('base64url');
      const session: AuthSession = {
        id: randomUUID(), userId, createdAt: at, lastSeenAt: at,
        expiresAt: at + SESSION_MAX_AGE_MS, lockedAt: null, revokedAt: null,
        mfaVerifiedAt, browser: browserFamily(userAgent),
      };
      db.transaction(() => {
        db.prepare(`INSERT INTO auth_sessions
          (id, user_id, secret_hash, created_at, last_seen_at, expires_at, browser, mfa_verified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(session.id, userId, digest(secret), at, at, session.expiresAt, session.browser, mfaVerifiedAt);
        event(session, 'login', at);
      })();
      return { secret, session };
    },
    authenticate(secret: string, allowLocked = false): AuthSession | null {
      if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
      const row = db.prepare<{ id: string }>('SELECT id FROM auth_sessions WHERE secret_hash = ?').get(digest(secret));
      return row ? (allowLocked ? getCurrent(row.id) : getActive(row.id)) : null;
    },
    getActive,
    getCurrent,
    lock,
    autoLockEnabled,
    idleLockHours,
    setIdleLockHours(userId: number, hours: number) {
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new RangeError('Idle lock hours must be an integer from 1 to 168');
      db.prepare('INSERT INTO auth_session_idle_policy (user_id, idle_hours) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET idle_hours=excluded.idle_hours')
        .run(userId, hours);
    },
    setAutoLock(userId: number, enabled: boolean) {
      db.prepare('INSERT INTO auth_session_preferences (user_id, auto_lock) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET auto_lock=excluded.auto_lock')
        .run(userId, enabled ? 1 : 0);
    },
    unlock(id: string, userId: number, verifiedAt: number): boolean {
      const session = getCurrent(id);
      if (!session || session.userId !== userId || session.lockedAt === null || !mfaEnabled(userId)) return false;
      const at = now();
      db.transaction(() => {
        db.prepare('UPDATE auth_sessions SET locked_at=NULL, mfa_verified_at=?, last_seen_at=? WHERE id=?').run(verifiedAt, at, id);
        event(session, 'unlocked', at);
      })();
      activity.set(id, at);
      return true;
    },
    /** Records an account security change against the session that made it. */
    recordEvent(id: string, kind: 'recovery-codes-replaced' | 'mfa-disabled') {
      const session = read(id);
      if (session) event(session, kind, now());
    },
    resetMfaAttempts(id: string) {
      db.prepare('DELETE FROM auth_session_mfa_attempts WHERE session_id=?').run(id);
    },
    failMfaAttempt(id: string, userId: number): number {
      return db.transaction(() => {
        const session = getCurrent(id);
        if (!session || session.userId !== userId) return 0;
        const failures = (db.prepare<{ failures: number }>('SELECT failures FROM auth_session_mfa_attempts WHERE session_id=?').get(id)?.failures ?? 0) + 1;
        if (failures >= 5) {
          if (revoke(id, userId)) event(session, 'mfa-attempts-exceeded', now());
          return 0;
        }
        db.prepare(`INSERT INTO auth_session_mfa_attempts (session_id, failures) VALUES (?, ?)
          ON CONFLICT(session_id) DO UPDATE SET failures=excluded.failures`).run(id, failures);
        return 5 - failures;
      })();
    },
    markMfa(id: string, at: number | null) {
      db.prepare('UPDATE auth_sessions SET mfa_verified_at=?, locked_at=NULL WHERE id=? AND revoked_at IS NULL').run(at, id);
    },
    /** A successful HTTP request records activity; transport pings must not call this. */
    touch(id: string, userAgent = ''): AuthSession | null {
      const session = getActive(id);
      if (!session) return null;
      const at = now();
      activity.set(id, at);
      const browser = browserFamily(userAgent);
      if (browser !== session.browser) {
        db.transaction(() => {
          db.prepare('UPDATE auth_sessions SET browser = ? WHERE id = ?').run(browser, id);
          event(session, 'browser-changed', at);
        })();
      }
      if (at - session.lastSeenAt >= ACTIVITY_WRITE_INTERVAL_MS) {
        db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(at, id);
      }
      return { ...session, lastSeenAt: at, browser };
    },
    lastActivity(id: string): number | null {
      return activity.get(id) ?? read(id)?.lastSeenAt ?? null;
    },
    list(userId: number): AuthSession[] {
      return db.prepare<SessionRow>(`SELECT * FROM auth_sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`)
        .all(userId, now()).map(rowToSession);
    },
    revoke,
    revokeAll(userId: number, exceptId = ''): number {
      const ids = db.transaction(() => {
        const sessions = db.prepare<SessionRow>('SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND id != ?')
          .all(userId, exceptId).map(rowToSession);
        const at = now();
        db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?').run(at, userId, exceptId);
        for (const session of sessions) {
          db.prepare('DELETE FROM auth_session_mfa_attempts WHERE session_id=?').run(session.id);
          event(session, 'revoked', at);
        }
        return sessions.map((session) => session.id);
      })();
      for (const id of ids) notify(id, 'revoked');
      return ids.length;
    },
    /** Called by the runtime timer, so an idle open stream expires without another request. */
    expire(): number {
      const rows = db.prepare<SessionRow>('SELECT * FROM auth_sessions WHERE revoked_at IS NULL AND expires_at <= ?')
        .all(now());
      for (const row of rows) revoke(row.id, row.user_id, 'expired');
      for (const row of db.prepare<{ id: string }>('SELECT id FROM auth_sessions WHERE revoked_at IS NULL AND locked_at IS NULL').all()) getCurrent(row.id);
      return rows.length;
    },
    onEnd(listener: (event: SessionEnd) => void): () => void {
      ended.add(listener);
      return () => { ended.delete(listener); };
    },
  };
}

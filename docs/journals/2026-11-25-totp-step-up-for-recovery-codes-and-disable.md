# Technical Journal: Password and Authenticator Code for Replacing Recovery Codes and Disabling TOTP

**Date:** 2026-11-25  
**Author:** Claude Code Engineer  
**Status:** Implemented & Verified (automated tests and Chrome only)  

---

## 1. Problem Statement & Motivation

Two account actions weaken the second factor:
1. `POST /api/auth/mfa/recovery-codes` replaces the recovery codes and returns 10 new codes in clear text.
2. `POST /api/auth/mfa/disable` deletes the TOTP seed and the recovery codes, and revokes the other sessions.

Before this change, both routes checked one thing: the session had verified an authenticator code in the last 10 minutes (`MFA_FRESH_MS`, 600,000 ms).
A recent verification shows that a code was entered. It does not show that the user wants to weaken the second factor now.

Two similar routes already asked for more. `POST /api/auth/mfa/enroll` and `POST /api/auth/password` check the password inside the same request.
The two routes above did not.

Now both routes require the account password and a new authenticator code in the request body, in addition to the 10-minute window.

---

## 2. Key Architectural Decisions & Implementation

### Phase 1: One Ordered Check for Both Routes
- **Shared helper:** `stepUp` in `server/modules/auth/mfa.routes.ts` runs the checks in a fixed order. Both handlers are `async` and call it first.
- **Order of checks:**
  1. If TOTP is off, return 409 `MFA_DISABLED`.
  2. Check `password` from the body with `passwordCheck`. If it is missing or wrong, return 403 `AUTH_INVALID_CREDENTIALS`.
  3. Call `requireRecentMfa`. If the last verification is older than `MFA_FRESH_MS`, return 403 `MFA_REAUTH_REQUIRED`.
  4. Call `verifySessionTotp` with `code` from the body.
- **Why this order:** If the password is wrong, no authenticator code is spent. If the window has passed, the route stops before it reads the code.
- **Recovery codes are refused:** `verifySessionTotp` always runs with `recovery = false`, so a recovery code in `code` fails. A session that signed in with a recovery code has `mfaVerifiedAt = 0`, so step 3 always fails for it.
- **Same code rules as reauthentication:** A code works once (`last_used_step`). Wrong codes count per session. The 5th wrong code revokes the session and returns 401 `MFA_SESSION_REVOKED` with the header `X-Auth-Error: mfa-attempts-exceeded`.
- **Response delivery:** Before the code check, the route releases its tracked connection. This lets the 401 reach the client when the session is revoked.
- **Behavior change in `disable`:** If TOTP is already off, `disable` now returns 409 `MFA_DISABLED`. Before, it returned 200 `{ "enabled": false }` and revoked the other sessions. The Settings screen shows the button only when TOTP is on, so users do not see this.

| Status | Code | When |
|---|---|---|
| 409 | `MFA_DISABLED` | TOTP is off |
| 403 | `AUTH_INVALID_CREDENTIALS` | Password is missing or wrong |
| 403 | `MFA_REAUTH_REQUIRED` | Last verification is older than 10 minutes |
| 403 | `MFA_CODE_INVALID` | Code is wrong, already used, or a recovery code. The body has `attemptsRemaining`. |
| 401 | `MFA_SESSION_REVOKED` | 5th wrong code in this session |

### Phase 2: Session Events
- **New events:** `recovery-codes-replaced` and `mfa-disabled`. `recordEvent` in `session-store.service.ts` writes them to `auth_events`.
- **When they are written:** After the action succeeds. A refused request writes nothing.
- **Reading them:** At this commit no route or screen lists `auth_events`. Read the table directly.

### Phase 3: Settings Dialog
- **Component:** `TotpStepUpDialog.tsx` asks for the password and the code. It clears both fields when it sends them.
- **Focus:** The first field has focus when the dialog opens. Tab stays inside the dialog. Escape closes it. Focus returns to the button that opened it.
- **Entry points:** `TotpSettings.tsx` opens the dialog for "Replace recovery codes" and "Disable TOTP". `api.auth.mfaRecoveryCodes(password, code)` and `api.auth.mfaDisable(password, code)` send the body.
- **Error messages:** One message per error code in the table above. For `MFA_CODE_INVALID`, the dialog shows `attemptsRemaining` when it is present.
- **Strings:** Five new keys in the `auth` namespace under `security`: `stepUpHint`, `wrongPassword`, `reauthExpired`, `codeRejected`, `codeRejectedNoCount`. All 15 locales have them.
- **Stale verification:** Before it opens the dialog, the page reads `/api/auth/mfa/status`. If the last verification is older than 9 minutes (`STEP_UP_FRESH_MS`, client only), the page opens the existing authenticator dialog first.
- **Cost for the user:** In that case the user types two codes. The second code must come from the next 30-second step, because each code works once. We accept this cost.
- **Window ends while typing:** If the server answers `MFA_REAUTH_REQUIRED`, `api.ts` opens the authenticator dialog and retries the request once.

### Unchanged
- `MFA_FRESH_MS`, login, unlock, reauthentication, cookies, the request guard, and CSP.
- No new dependency.

---

## 3. Verification & Quality Gates

**What ran:**
- **Server tests:** `server/modules/auth/tests/mfa-api.test.ts` has 16 tests, all passing. Six are new and one changed. They cover a wrong or missing password, a missing, wrong or reused code, a request outside the window, a recovery-code session, a recovery code in `code`, success on both routes, 5 wrong codes, and the two events. Three of the new tests fail on the previous routes.
- **Client tests:** `src/modules/settings/tests/totp-step-up.test.tsx` has 10 tests, all passing. They cover the request body, focus, Tab, Escape, the stale-verification path, and each error message.
- **Full suites at commit `adc5030`:**
  - Server: 2648 tests, 2634 pass, 0 fail, 14 skipped (2642 tests before the change).
  - Client: 1467 tests pass in 200 files (1457 in 199 files before).
  - Crypto tests: 110 pass.
  - `tsc --noEmit`: 0 errors. Build: 0 errors.
  - Lint: 281 warnings and 2 errors, the same as before the change.
- **API check on a local preview, fake account:** 28 checks pass. They cover each error code, the refusal of recovery codes, the session limit, and the two events.
- **Browser check, headless Chrome at desktop size:** 12 checks pass. They cover the focus, the Tab loop, Escape, the error messages, and the success path of both actions.

**What did not run cleanly:**
- **Remote E2E suite:** The suite fails in timing-sensitive tests on a loaded machine. The terminal typing-latency test also fails before this change. A 25 MB upload test, a terminal replay test, and two suite startup hooks failed in single runs and passed when their files ran again alone. None of them uses these routes. No full run had only the typing-latency failure for the final commit.

**What was not checked:**
- Edge, Firefox, Safari, and a phone-size viewport.
- The 10-minute window with a real clock. The tests use a fake clock.

**Commits:** `d18898e`, `d62d2e8`, `7cea283`, `adc5030`.

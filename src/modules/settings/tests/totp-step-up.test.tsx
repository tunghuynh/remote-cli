import '@/modules/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import TotpSettings from '@/modules/settings/tabs/TotpSettings';
import { registerMfaReauth } from '@/shared/authToken';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const refusal = (code: string, details?: unknown) => json({ success: false, error: { code, message: 'Synthetic', details } }, 403);
// Credentials are built per run so no secret-looking text sits in the source.
const accountPassword = `pw-${crypto.randomUUID()}`;
const codes = Array.from({ length: 10 }, () => crypto.randomUUID().replace(/-/g, ''));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A TOTP-enabled account; `verifiedAt` is when the session last verified with the authenticator. */
function server(verifiedAt: number | null, action: (path: string, body: Record<string, unknown>) => Response) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/mfa/status') return json({ enabled: true, verifiedAt });
    if (url === '/api/auth/session-status') return json({ autoLock: true, idleHours: 24 });
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ path: url, body });
    return action(url, body);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}
async function open(name: string) {
  render(<TotpSettings />);
  const opener = await screen.findByRole('button', { name });
  opener.focus(); fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  return { opener, dialog };
}
function fill(password: string, code: string) {
  fireEvent.change(screen.getByLabelText('Current password', { selector: '#totp-step-up-password' }), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Authenticator code', { selector: '#totp-step-up-code' }), { target: { value: code } });
  fireEvent.submit(screen.getByRole('dialog'));
}

it('MR-06: replacing recovery codes asks for the password and a new code, sends both, then returns focus', async () => {
  const calls = server(Date.now(), () => json({ recoveryCodes: codes }));
  const { opener, dialog } = await open('Replace recovery codes');
  expect(calls).toEqual([]);
  expect(document.activeElement?.id).toBe('totp-step-up-password');
  expect(dialog.textContent).toContain('A recovery code is not accepted here.');
  fill(accountPassword, '123456');
  await screen.findByText(codes[0]);
  expect(calls).toEqual([{ path: '/api/auth/mfa/recovery-codes', body: { password: accountPassword, code: '123456' } }]);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('MR-06: disabling TOTP sends the password and code and reports the result', async () => {
  const calls = server(Date.now(), () => json({ enabled: false }));
  await open('Disable TOTP');
  fill(accountPassword, '654321');
  await screen.findByText('Two-factor authentication disabled. Other devices have been signed out.');
  expect(calls).toEqual([{ path: '/api/auth/mfa/disable', body: { password: accountPassword, code: '654321' } }]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('MR-06: a stale verification is renewed before the dialog opens, and cancelling it opens nothing', async () => {
  let answer = false;
  const reauth = vi.fn(async () => answer);
  const remove = registerMfaReauth(reauth);
  try {
    const calls = server(Date.now() - 9 * 60 * 1000, () => json({ recoveryCodes: codes }));
    render(<TotpSettings />);
    const opener = await screen.findByRole('button', { name: 'Replace recovery codes' });
    fireEvent.click(opener);
    await waitFor(() => expect(reauth).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    answer = true;
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    expect(reauth).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([]);
  } finally { remove(); }
});

it.each([
  ['AUTH_INVALID_CREDENTIALS', undefined, 'Password is incorrect.'],
  ['MFA_CODE_INVALID', { attemptsRemaining: 3 }, 'Incorrect or already used code. Wait for a new code. Attempts remaining: 3.'],
  ['MFA_CODE_INVALID', undefined, 'Incorrect or already used code. Wait for a new code and try again.'],
  ['MFA_DISABLED', undefined, 'Verification failed. Check your password or code and try again.'],
])('MR-04/MR-06: %s keeps the dialog open with its own message and empty fields', async (code, details, message) => {
  server(Date.now(), () => refusal(code, details));
  await open('Disable TOTP');
  fill(accountPassword, '123456');
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((screen.getByLabelText('Current password', { selector: '#totp-step-up-password' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Authenticator code', { selector: '#totp-step-up-code' }) as HTMLInputElement).value).toBe('');
  expect(screen.getByText('Enabled. New sign-ins require your authenticator.')).toBeTruthy();
});

it('MR-06: Tab stays inside the dialog and Escape closes it back to the opener without a request', async () => {
  const calls = server(Date.now(), () => json({}));
  const { opener, dialog } = await open('Replace recovery codes');
  const buttons = dialog.querySelectorAll('button');
  const last = buttons[buttons.length - 1];
  last.focus(); fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement?.id).toBe('totp-step-up-password');
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(calls).toEqual([]);
});

it.each([
  [true, 'Verification expired. Try again and enter an authenticator code when asked.'],
  [false, null],
])('MR-04/MR-06: an expired verification asks again once; verified=%s shows %s', async (verified, message) => {
  const reauth = vi.fn(async () => verified);
  const remove = registerMfaReauth(reauth);
  try {
    const calls = server(Date.now(), () => refusal('MFA_REAUTH_REQUIRED'));
    await open('Replace recovery codes');
    fill(accountPassword, '123456');
    await waitFor(() => expect(reauth).toHaveBeenCalledTimes(1));
    if (message) expect((await screen.findByRole('alert')).textContent).toBe(message);
    else {
      await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByRole('alert')).toBeNull();
    }
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(calls).toHaveLength(verified ? 2 : 1);
  } finally { remove(); }
});

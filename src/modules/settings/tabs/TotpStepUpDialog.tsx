import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';

import { ApiRequestError } from '@/shared/api';
import { Button, Input } from '@/shared/ui';

type TotpStepUpDialogProps = {
  title: string;
  confirmLabel: string;
  /** Sends the action with the typed password and authenticator code; throws ApiRequestError on refusal. */
  submit: (password: string, code: string) => Promise<void>;
  onClose: () => void;
  /** The control that opened the dialog; it may have been disabled while the dialog was being prepared. */
  returnFocusTo: HTMLElement | null;
};

/**
 * Asks for the account password and a new authenticator code before an action that weakens TOTP.
 * Both values are emptied the moment they are sent. Focus behaves like the authenticator reauth
 * dialog: it starts in the first field, Tab stays inside, Escape cancels, and closing returns focus
 * to the control that opened it.
 */
export default function TotpStepUpDialog({ title, confirmLabel, submit, onClose, returnFocusTo }: TotpStepUpDialogProps) {
  const { t } = useTranslation('auth');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const opener = useRef(returnFocusTo);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const target = opener.current;
    return () => {
      mounted.current = false;
      if (target?.isConnected) target.focus();
    };
  }, []);
  const explain = (caught: unknown) => {
    if (!(caught instanceof ApiRequestError)) return t('security.failed');
    if (caught.code === 'AUTH_INVALID_CREDENTIALS') return t('security.wrongPassword');
    if (caught.code === 'MFA_REAUTH_REQUIRED') return t('security.reauthExpired');
    if (caught.code === 'MFA_SESSION_REVOKED') return t('security.attemptsRevoked');
    if (caught.code === 'MFA_CODE_INVALID') {
      const remaining = (caught.details as { attemptsRemaining?: unknown } | undefined)?.attemptsRemaining;
      return typeof remaining === 'number' && Number.isInteger(remaining) && remaining > 0 && remaining < 5
        ? t('security.codeRejected', { count: remaining }) : t('security.codeRejectedNoCount');
    }
    return t('security.failed');
  };
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
    <form role="dialog" aria-modal="true" aria-labelledby="totp-step-up-title" className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-5 shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onClose(); return; }
        if (e.key !== 'Tab') return;
        const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const sentPassword = password, sentCode = code;
        setPassword(''); setCode(''); setError(''); setBusy(true);
        void submit(sentPassword, sentCode).then(() => { if (mounted.current) onClose(); }, (caught: unknown) => {
          // A cancelled authenticator prompt is the user's choice, not a failure.
          if (mounted.current && !(caught instanceof ApiRequestError && caught.code === 'MFA_REAUTH_CANCELLED')) setError(explain(caught));
        }).finally(() => { if (mounted.current) setBusy(false); });
      }}>
      <h2 id="totp-step-up-title" className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{t('security.stepUpHint')}</p>
      <label htmlFor="totp-step-up-password" className="block text-sm">{t('security.currentPassword')}</label>
      <Input id="totp-step-up-password" type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <label htmlFor="totp-step-up-code" className="block text-sm">{t('security.code')}</label>
      <Input id="totp-step-up-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{confirmLabel}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('security.cancel')}</Button>
      </div>
    </form>
  </div>;
}

import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { MFA_STATUS_CHANGED_EVENT } from '@/modules/auth';
import SessionLockSettings from '@/modules/settings/tabs/SessionLockSettings';
import TotpStepUpDialog from '@/modules/settings/tabs/TotpStepUpDialog';
import { api, readApiJson, ApiRequestError } from '@/shared/api';
import { requestMfaReauth } from '@/shared/authToken';
import { Button, Input } from '@/shared/ui';
import { isTargetMode } from '@/shared/transport/target-context';

type Enrollment = { secret: string; uri: string; expiresAt: number };
type StepUpAction = 'recovery' | 'disable';
/**
 * The server keeps a verification for 10 minutes; treating it as stale a minute early leaves time to type the
 * password and code, so the server does not ask for a second verification of a request that carries a code.
 */
const STEP_UP_FRESH_MS = 9 * 60 * 1000;
function EnrollmentQr({ uri }: { uri: string }) {
  const { t } = useTranslation('auth');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let active = true;
    void QRCode.toCanvas(element, uri, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).catch(() => { if (active) setError(true); });
    return () => { active = false; element.getContext('2d')?.clearRect(0, 0, element.width, element.height); };
  }, [uri]);
  return <>{error && <p role="alert">{t('security.qrError')}</p>}<canvas ref={canvas} aria-label={t('security.qrLabel')} className="max-w-full" /></>;
}

/** Enrollment and recovery material is held only while this settings view is open. */
export default function TotpSettings() {
  const { t } = useTranslation('auth');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stepUp, setStepUp] = useState<{ action: StepUpAction; opener: HTMLElement } | null>(null);
  useEffect(() => {
    if (isTargetMode()) return;
    let active = true;
    void api.auth.mfaStatus().then(readApiJson<{ enabled: boolean }>).then((d) => { if (active) setEnabled(d.enabled); })
      .catch(() => { if (active) setError(t('security.failed')); });
    return () => { active = false; };
  }, [t]);
  if (isTargetMode()) return null;
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (error) { if (!(error instanceof ApiRequestError && error.code === 'MFA_REAUTH_CANCELLED')) setError(t('security.failed')); }
    finally { setBusy(false); }
  };
  // The weakening request needs a recent verification and a new code; verify first so the code in the dialog is not spent twice.
  const openStepUp = (action: StepUpAction, opener: HTMLElement) => void run(async () => {
    const { verifiedAt } = await readApiJson<{ verifiedAt: number | null }>(await api.auth.mfaStatus());
    const fresh = typeof verifiedAt === 'number' && verifiedAt > 0 && Date.now() - verifiedAt < STEP_UP_FRESH_MS;
    if (!fresh && !await requestMfaReauth()) return;
    setStepUp({ action, opener });
  });
  const submitStepUp = async (password: string, code: string) => {
    if (stepUp?.action === 'recovery') {
      const result = await readApiJson<{ recoveryCodes: string[] }>(await api.auth.mfaRecoveryCodes(password, code)); setCodes(result.recoveryCodes);
      return;
    }
    await readApiJson(await api.auth.mfaDisable(password, code)); setEnabled(false); window.dispatchEvent(new Event(MFA_STATUS_CHANGED_EVENT)); setCodes([]); setEnrollment(null);
    setNotice(t('security.disabledNotice'));
  };
  return <section className="space-y-4 rounded-xl border border-border p-4" aria-labelledby="totp-title">
    <h2 id="totp-title" className="text-lg font-semibold">{t('security.title')}</h2>
    <p className="text-sm text-muted-foreground">{enabled === null ? t('security.loading') : enabled ? t('security.enabled') : t('security.disabled')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {codes.length > 0 && <div className="space-y-3">
      <p>{t('security.recoveryHint')}</p>
      <ul className="space-y-1 break-all font-mono text-xs">{codes.map((item) => <li key={item}>{item}</li>)}</ul>
      <Button onClick={() => setCodes([])}>{t('security.recoverySaved')}</Button>
    </div>}
    {enrollment ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const supplied = code; setCode('');
      const result = await readApiJson<{ recoveryCodes: string[] }>(await api.auth.mfaActivate(supplied));
      setCodes(result.recoveryCodes); setEnrollment(null); setEnabled(true); window.dispatchEvent(new Event(MFA_STATUS_CHANGED_EVENT));
    }); }}>
      <EnrollmentQr uri={enrollment.uri} />
      <p className="break-all text-sm">{t('security.setupKey')}: <code>{enrollment.secret}</code></p>
      <p className="text-sm">{t('security.validUntil', { time: new Date(enrollment.expiresAt).toLocaleTimeString() })}</p>
      <label htmlFor="totp-activate-code" className="block">{t('security.code')}</label>
      <Input id="totp-activate-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
      <Button type="submit" disabled={busy}>{t('security.activate')}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setEnrollment(null); setCode(''); }}>{t('security.cancelSetup')}</Button>
    </form> : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const supplied = password; setPassword(''); setCodes([]);
      setEnrollment(await readApiJson<Enrollment>(await api.auth.mfaEnroll(supplied)));
    }); }}>
      <label htmlFor="totp-password" className="block text-sm">{t('security.currentPassword')}</label>
      <Input id="totp-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" disabled={busy || enabled === null}>{enabled ? t('security.replaceAuthenticator') : t('security.setupAuthenticator')}</Button>
    </form>}
    {enabled && <SessionLockSettings />}
    {enabled && <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={(e) => openStepUp('recovery', e.currentTarget)}>{t('security.replaceRecovery')}</Button>
      <Button variant="destructive" disabled={busy} onClick={(e) => openStepUp('disable', e.currentTarget)}>{t('security.disableTotp')}</Button>
    </div>}
    {stepUp && <TotpStepUpDialog title={stepUp.action === 'recovery' ? t('security.replaceRecovery') : t('security.disableTotp')}
      confirmLabel={stepUp.action === 'recovery' ? t('security.replaceRecovery') : t('security.disableTotp')}
      submit={submitStepUp} onClose={() => setStepUp(null)} returnFocusTo={stepUp.opener} />}
    <form className="space-y-3 border-t pt-4" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const old = currentPassword, next = newPassword; setCurrentPassword(''); setNewPassword('');
      await readApiJson(await api.auth.changePassword(old, next));
      setNotice(t('security.passwordNotice'));
    }); }}>
      <h3 className="font-medium">{t('security.changePassword')}</h3>
      <label htmlFor="change-current-password" className="block text-sm">{t('security.currentPassword')}</label>
      <Input id="change-current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      <label htmlFor="change-new-password" className="block text-sm">{t('security.newPassword')}</label>
      <Input id="change-new-password" type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      <Button type="submit" disabled={busy || enabled === null}>{t('security.changePassword')}</Button>
    </form>
  </section>;
}

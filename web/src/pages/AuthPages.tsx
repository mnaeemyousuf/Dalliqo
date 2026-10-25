import { Languages } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/api/endpoints';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, Input } from '@/components/ui';
import { useErrorText } from '@/lib/hooks';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  const { lang, setLang } = useUi();
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 to-canvas p-4">
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-center justify-between">
          <BrandLogo className="h-10 w-auto" />
          <button className="btn-ghost text-xs" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>
            <Languages className="h-4 w-4" /> {lang === 'en' ? 'اردو' : 'English'}
          </button>
        </div>
        <p className="mb-6 text-sm font-medium text-muted">{t('app.tagline')}</p>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mb-4 mt-1 text-sm text-muted">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
      {message}
    </p>
  ) : null;
}

export function LoginPage() {
  const { t } = useTranslation();
  const signIn = useAuth((s) => s.signIn);
  const errorText = useErrorText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      signIn(await authApi.login(email, password));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link className="font-medium text-brand-600" to="/register">
            {t('auth.register')}
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBox message={error} />
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('auth.password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-brand-600">
            {t('auth.forgot')}
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const signIn = useAuth((s) => s.signIn);
  const errorText = useErrorText();
  const [form, setForm] = useState({ fullName: '', email: '', mobileNumber: '', businessName: '', password: '' });
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    setFieldErrors({});
    try {
      signIn(await authApi.register({ ...form, mobileNumber: form.mobileNumber || undefined }));
    } catch (err) {
      setError(errorText(err));
      const details = (err as { details?: { path: string; message: string }[] }).details;
      if (Array.isArray(details)) setFieldErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link className="font-medium text-brand-600" to="/login">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBox message={error} />
        <Input label={t('auth.businessName')} required value={form.businessName} onChange={set('businessName')} error={fieldErrors.businessName} />
        <Input label={t('auth.fullName')} required autoComplete="name" value={form.fullName} onChange={set('fullName')} error={fieldErrors.fullName} />
        <Input label={t('auth.email')} type="email" required autoComplete="email" value={form.email} onChange={set('email')} error={fieldErrors.email} />
        <Input label={t('auth.mobile')} type="tel" inputMode="tel" placeholder="0300 1234567" value={form.mobileNumber} onChange={set('mobileNumber')} error={fieldErrors.mobileNumber} />
        <Input label={t('auth.password')} type="password" required autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} hint={t('auth.passwordHint')} error={fieldErrors.password} />
        <Button type="submit" className="w-full" loading={loading}>
          {t('auth.register')}
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgot(email);
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthShell title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')} footer={<Link to="/login" className="text-brand-600">{t('auth.backToSignIn')}</Link>}>
      {sent ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">{t('auth.linkSent')}</p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <ErrorBox message={error} />
          <Input label={t('auth.email')} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" loading={loading}>
            {t('auth.sendLink')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t('auth.passwordsMismatch'));
    setLoading(true);
    try {
      await authApi.reset(params.get('token') ?? '', password);
      toast.success(t('auth.resetDone'));
      navigate('/login');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthShell title={t('auth.resetTitle')} footer={<Link to="/login" className="text-brand-600">{t('auth.backToSignIn')}</Link>}>
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBox message={error} />
        <Input label={t('auth.newPassword')} type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={t('auth.passwordHint')} />
        <Input label={t('auth.confirmPassword')} type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" className="w-full" loading={loading}>
          {t('common.save')}
        </Button>
      </form>
    </AuthShell>
  );
}

/** Shown to owner-created members until they replace their temporary password. */
export function ChangeTemporaryPasswordPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { setSession, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError(t('auth.passwordsMismatch'));
    setLoading(true);
    try {
      await authApi.changePassword(current, next);
      setSession(await authApi.me());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthShell title={t('auth.changeTempTitle')} subtitle={t('auth.changeTempSubtitle')} footer={<button className="text-brand-600" onClick={() => void signOut()}>{t('nav.logout')}</button>}>
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBox message={error} />
        <Input label={t('auth.currentPassword')} type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Input label={t('auth.newPassword')} type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={t('auth.passwordHint')} />
        <Input label={t('auth.confirmPassword')} type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" className="w-full" loading={loading}>
          {t('auth.changePassword')}
        </Button>
      </form>
    </AuthShell>
  );
}

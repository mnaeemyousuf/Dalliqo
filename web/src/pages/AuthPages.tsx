import { Languages, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';
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
  const points = [
    { icon: <Sparkles className="h-4 w-4" />, text: t('auth.brand.point1') },
    { icon: <WifiOff className="h-4 w-4" />, text: t('auth.brand.point2') },
    { icon: <ShieldCheck className="h-4 w-4" />, text: t('auth.brand.point3') },
  ];
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-[#0B1B4A] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="pointer-events-none absolute -start-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[#3B6CF0]/40 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 end-0 h-[24rem] w-[24rem] rounded-full bg-[#F59E0B]/20 blur-[120px]" />
        <div className="relative flex items-center gap-3">
          <BrandLogo variant="mark" className="h-10 w-10 rounded-xl" />
          <span className="text-lg font-extrabold tracking-tight">Dalliqo</span>
        </div>
        <div className="relative mt-auto max-w-lg animate-rise">
          <h2 className="text-4xl font-bold leading-[1.15] tracking-tight">{t('auth.brand.headline')}</h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">{t('auth.brand.subline')}</p>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="rounded-lg bg-white/10 p-2 ring-1 ring-white/15">{p.icon}</span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        {/* Stylised product preview */}
        <div className="relative mt-12 grid max-w-lg grid-cols-3 gap-3 [animation-delay:120ms] animate-rise">
          {[
            [t('auth.brand.kpi1'), '128'],
            [t('auth.brand.kpi2'), '42'],
            [t('auth.brand.kpi3'), '96%'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
              <p className="text-2xs font-semibold uppercase tracking-wider text-white/50">{label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-2/3 rounded-full bg-gradient-to-r from-[#6E93F6] to-[#F59E0B]" /></div>
            </div>
          ))}
        </div>
        <p className="relative mt-10 text-xs text-white/40">{t('app.tagline')}</p>
      </aside>

      {/* Form */}
      <main className="flex min-h-full flex-col bg-surface px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <BrandLogo className="h-9 w-auto lg:invisible" />
          <button className="btn-ghost !h-8 text-xs" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>
            <Languages className="h-4 w-4" /> {lang === 'en' ? 'اردو' : 'English'}
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="animate-rise">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mb-7 mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}
            {children}
          </div>
          {footer && <div className="mt-8 text-center text-sm text-muted [&_a]:font-semibold [&_a]:text-brand-600 hover:[&_a]:underline">{footer}</div>}
        </div>
        <p className="text-center text-2xs text-subtle">© {new Date().getFullYear()} Dalliqo · {t('app.tagline')}</p>
      </main>
    </div>
  );
}

function ErrorBox({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="animate-scale-in rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
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
        <Button type="submit" size="lg" className="w-full" loading={loading}>
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
        <Button type="submit" size="lg" className="w-full" loading={loading}>
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
          <Button type="submit" size="lg" className="w-full" loading={loading}>
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
        <Button type="submit" size="lg" className="w-full" loading={loading}>
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
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {t('auth.changePassword')}
        </Button>
      </form>
    </AuthShell>
  );
}

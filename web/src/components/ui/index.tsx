import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, SlidersHorizontal, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/*
 * Dalliqo design system — web primitives. Every page is built from these, so visual changes belong here
 * (tokens live in tailwind.config.js and index.css). APIs stay stable; styling is the design system's job.
 */

/* ───────────── Button ───────────── */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading, icon, size = 'md', className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(`btn-${variant}`, size === 'sm' && '!h-8 !gap-1.5 !rounded-lg !px-2.5 !text-xs', size === 'lg' && '!h-11 !px-5 !text-[15px]', className)}
      {...rest}
    >
      {loading ? <Loader2 className={clsx('animate-spin', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} /> : icon}
      {children}
    </button>
  );
});

/* ───────────── Form fields ───────────── */
interface FieldProps {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}
export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      {children(id)}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600 animate-fade-in dark:text-red-400" role="alert">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; hint?: ReactNode; wrapperClassName?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, wrapperClassName, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={wrapperClassName}>
      {(id) => <input ref={ref} id={id} className={clsx('input', error && '!border-red-500 focus:!shadow-[0_0_0_4px_rgb(239_68_68/0.14)]', className)} aria-invalid={!!error} {...rest} />}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  wrapperClassName?: string;
};
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, options, placeholder, wrapperClassName, className, ...rest },
  ref,
) {
  return (
    <Field label={label} error={error} className={wrapperClassName}>
      {(id) => (
        <select ref={ref} id={id} className={clsx('input', error && '!border-red-500', className)} aria-invalid={!!error} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string; wrapperClassName?: string };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, wrapperClassName, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} className={wrapperClassName}>
      {(id) => <textarea ref={ref} id={id} rows={3} className={clsx('input', error && '!border-red-500', className)} aria-invalid={!!error} {...rest} />}
    </Field>
  );
});

/** Native picker: accessible, localised by the browser, works on touch devices. */
export function DatePicker(props: Omit<InputProps, 'type'> & { withTime?: boolean }) {
  const { withTime = true, ...rest } = props;
  return <Input type={withTime ? 'datetime-local' : 'date'} {...rest} />;
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <label className={clsx('group flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink-2', disabled && 'cursor-not-allowed opacity-60')}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded-[5px] border-line-strong accent-brand-600 transition group-hover:scale-105"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** On/off switch for settings-style booleans. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('flex cursor-pointer select-none items-center gap-3 text-sm', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-brand-600' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-all duration-200 ease-spring', checked ? 'start-[1.125rem]' : 'start-0.5')} />
      </button>
      {label}
    </label>
  );
}

/* ───────────── Surfaces ───────────── */
export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={clsx('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

const BADGE: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  red: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20',
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
};
const DOT: Record<string, string> = { green: 'bg-emerald-500', blue: 'bg-sky-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-slate-400', purple: 'bg-violet-500' };
export type BadgeColor = keyof typeof BADGE;
export function Badge({ color = 'gray', children, className, dot = true }: { color?: BadgeColor; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('chip ring-1 ring-inset', BADGE[color], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[color])} />}
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} />;
}

/** Shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

/** Content-shaped loading state: a header, a few cards and table-like rows. */
export function PageLoader({ rows = 6 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-in space-y-4 py-2" role="status" aria-label={t('common.loading')}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="card divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex animate-rise flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="relative mb-3">
        <div className="absolute inset-0 -m-3 rounded-full bg-brand-500/5" />
        <div className="absolute inset-0 -m-1.5 rounded-full bg-brand-500/10" />
        <div className="relative rounded-2xl bg-surface p-3.5 text-brand-600 shadow-lift ring-1 ring-line">{icon ?? <Inbox className="h-6 w-6" />}</div>
      </div>
      <p className="text-[15px] font-semibold tracking-tight">{title}</p>
      {hint && <p className="max-w-sm text-sm leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex animate-rise flex-col items-center justify-center gap-2 py-16 text-center" role="alert">
      <div className="mb-2 rounded-2xl bg-red-50 p-3.5 text-red-600 ring-1 ring-red-600/10 dark:bg-red-500/10 dark:text-red-400">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="text-[15px] font-semibold tracking-tight">{message ?? t('common.somethingWrong')}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/* ───────────── Overlays ───────────── */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    // Keep the page behind the overlay still.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

const backdrop = 'fixed inset-0 z-50 animate-fade-in bg-slate-950/40 backdrop-blur-[2px] dark:bg-black/60';

function OverlayHeader({ title, onClose }: { title: ReactNode; onClose(): void }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <button className="icon-btn !h-8 !w-8 -me-2" onClick={onClose} aria-label="close">
        <X className="h-4 w-4" />
      </button>
    </header>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className={clsx(backdrop, 'flex items-end justify-center p-0 sm:items-center sm:p-4')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'flex max-h-[92vh] w-full animate-scale-in flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl',
          { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl' }[size],
        )}
      >
        <OverlayHeader title={title} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-6 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Side panel; slides from the end edge so it mirrors correctly in RTL. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className={clsx(backdrop, 'flex justify-end')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        role="dialog"
        aria-modal="true"
        className="flex h-full w-full max-w-2xl animate-slide-in-end flex-col border-s border-line bg-surface shadow-pop [--slide-from:100%] rtl:[--slide-from:-100%]"
      >
        <OverlayHeader title={title} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-6 py-3.5">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose, danger = true, loading }: { open: boolean; title: string; message?: string; confirmLabel?: string; onConfirm(): void; onClose(): void; danger?: boolean; loading?: boolean }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        {danger && (
          <div className="h-fit rounded-xl bg-red-50 p-2 text-red-600 dark:bg-red-500/10 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
        )}
        <p className="pt-1 text-sm leading-relaxed text-muted">{message ?? t('common.cannotUndo')}</p>
      </div>
    </Modal>
  );
}

/** Small menu anchored to a trigger button. */
export function Dropdown({ trigger, children, align = 'end', className }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-40 mt-2 min-w-[13rem] origin-top animate-scale-in rounded-xl border border-line bg-surface p-1.5 shadow-pop',
            align === 'end' ? 'end-0' : 'start-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ onClick, children, danger }: { onClick(): void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm font-medium transition-colors',
        danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-ink-2 hover:bg-ink/[0.05] hover:text-ink dark:hover:bg-white/[0.06]',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ───────────── Navigation ───────────── */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: NoInfer<T>; label: ReactNode; count?: number }[]; value: T; onChange(v: NoInfer<T>): void }) {
  return (
    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" role="tablist">
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={clsx(
              'relative -mb-px whitespace-nowrap px-3 pb-2.5 pt-2 text-sm font-semibold transition-colors',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            <span className={clsx('rounded-md px-1.5 py-1 transition-colors', !active && 'group-hover:bg-ink/5')}>{tab.label}</span>
            {tab.count !== undefined && (
              <span className={clsx('ms-1 rounded-full px-1.5 py-px text-2xs tabular', active ? 'bg-brand-600 text-on-brand' : 'bg-ink/[0.06] text-muted dark:bg-white/10')}>{tab.count}</span>
            )}
            <span className={clsx('absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-brand-600 transition-all duration-300 ease-out', active ? 'opacity-100' : 'scale-x-50 opacity-0')} />
          </button>
        );
      })}
    </div>
  );
}

/** Compact pill switch (date ranges, views). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: NoInfer<T>; label: ReactNode }[]; value: T; onChange(v: NoInfer<T>): void }) {
  return (
    <div className="inline-flex rounded-[10px] bg-ink/[0.05] p-0.5 dark:bg-white/[0.06]" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, total, limit, onChange }: { page: number; totalPages: number; total: number; limit: number; onChange(p: number): void }) {
  const { t } = useTranslation();
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-3.5 text-sm text-muted">
      <span className="ltr-nums text-xs font-medium">{t('common.showing', { from, to, total })}</span>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t('common.previous')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <span className="px-2 text-xs font-semibold text-ink-2">{t('common.page', { page, total: totalPages })}</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label={t('common.next')}>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

/* ───────────── Tables ───────────── */
export interface Column<T> {
  key: string;
  header: ReactNode;
  render(row: T): ReactNode;
  className?: string;
}

export function Table<T extends { _id: string }>({ columns, rows, onRowClick }: { columns: Column<T>[]; rows: T[]; onRowClick?(row: T): void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2/80">
            {columns.map((c) => (
              <th key={c.key} className={clsx('whitespace-nowrap px-4 py-2.5 text-start text-2xs font-semibold uppercase tracking-[0.06em] text-muted', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((row, idx) => (
            <tr
              key={row._id}
              style={{ ['--i' as string]: Math.min(idx, 12) }}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              className={clsx(
                'border-b border-line transition-colors last:border-0',
                onRowClick && 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50/60 focus-visible:outline-none dark:hover:bg-white/[0.03]',
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={clsx('px-4 py-3 align-middle text-ink-2', c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <div className="animate-fade-in" role="status">
      <div className="h-10 border-b border-line bg-surface-2/80" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-line px-4 py-3.5 last:border-0">
          {Array.from({ length: Math.min(cols, 6) }, (_, c) => (
            <Skeleton key={c} className={clsx('h-3', c === 0 ? 'w-28' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Server-paginated table with loading, empty and error states built in. */
export function DataTable<T extends { _id: string }>({
  columns,
  query,
  page,
  onPage,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  query: { data?: { items: T[]; meta: { page: number; totalPages: number; total: number; limit: number } }; isLoading: boolean; isError: boolean; error?: unknown; refetch(): unknown };
  page: number;
  onPage(p: number): void;
  onRowClick?(row: T): void;
  empty: ReactNode;
}) {
  if (query.isLoading) return <TableSkeleton cols={columns.length} />;
  if (query.isError) return <ErrorState message={(query.error as Error | undefined)?.message} onRetry={() => query.refetch()} />;
  const data = query.data!;
  if (!data.items.length) return <>{empty}</>;
  return (
    <>
      <Table columns={columns} rows={data.items} onRowClick={onRowClick} />
      <div className="border-t border-line px-4">
        <Pagination page={page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={onPage} />
      </div>
    </>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-600">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Round initials avatar with a stable colour per name. */
export function Avatar({ name, size = 'md', className }: { name?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const n = (name ?? '?').trim();
  const initials = n.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const hues = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600'];
  const hue = hues[[...n].reduce((s, ch) => s + ch.charCodeAt(0), 0) % hues.length];
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface',
        hue,
        { sm: 'h-7 w-7 text-2xs', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' }[size],
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Compact labelled figure used on detail pages (expected / received / outstanding …). */
export function MetricTile({ label, value, tone = 'default', className }: { label: ReactNode; value: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'brand'; className?: string }) {
  const accent = { default: 'bg-slate-400', good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', brand: 'bg-brand-600' }[tone];
  const text = { default: 'text-ink', good: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-red-600 dark:text-red-400', brand: 'text-brand-600' }[tone];
  return (
    <div className={clsx('card relative overflow-hidden p-4 animate-rise', className)}>
      <span className={clsx('absolute inset-y-3 start-0 w-1 rounded-e-full', accent)} aria-hidden />
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className={clsx('ltr-nums mt-1.5 text-xl font-bold tracking-tight', text)}>{value}</div>
    </div>
  );
}

/**
 * Filter panel: the main filters always visible, the rest behind "More filters" (opened automatically when one of
 * them is in use, and showing how many are active).
 */
export function FilterBar({ children, advanced, activeAdvanced = 0, className }: { children: ReactNode; advanced?: ReactNode; activeAdvanced?: number; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(activeAdvanced > 0);
  return (
    <div className={clsx('card mb-4 p-3', className)}>
      <div className="flex flex-wrap items-center gap-2 [&>*]:min-w-[10rem] [&>*]:flex-1">
        {children}
        {advanced && (
          <button
            type="button"
            className={clsx('btn-secondary !min-w-0 !flex-none', open && '!border-brand-500/40 !bg-brand-50 !text-brand-700 dark:!text-brand-ink')}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t('common.moreFilters')}
            {activeAdvanced > 0 && <span className="ltr-nums rounded-full bg-brand-600 px-1.5 text-2xs font-bold text-on-brand">{activeAdvanced}</span>}
          </button>
        )}
      </div>
      {advanced && (
        <div aria-hidden={!open} className={clsx('mt-3 animate-fade-in gap-2 border-t border-line pt-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6', open ? 'grid' : 'hidden')}>
          {advanced}
        </div>
      )}
    </div>
  );
}

/** Icon switch between list layouts (table / cards / board). */
export function ViewToggle<T extends string>({ value, onChange, options }: { value: T; onChange(v: NoInfer<T>): void; options: { value: NoInfer<T>; icon: ReactNode; label: string }[] }) {
  return (
    <div className="inline-flex rounded-[10px] bg-ink/[0.05] p-0.5 dark:bg-white/[0.06]" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('flex h-8 w-9 items-center justify-center rounded-lg transition-all duration-200', value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

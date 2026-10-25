import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
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

/* ───────────── Button ───────────── */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
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
      className={clsx(`btn-${variant}`, size === 'sm' && '!px-2.5 !py-1.5 !text-xs', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
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
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; hint?: ReactNode; wrapperClassName?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, wrapperClassName, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={wrapperClassName}>
      {(id) => <input ref={ref} id={id} className={clsx('input', error && '!border-red-500', className)} aria-invalid={!!error} {...rest} />}
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
        <select ref={ref} id={id} className={clsx('input', className)} {...rest}>
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
      {(id) => <textarea ref={ref} id={id} rows={3} className={clsx('input', className)} {...rest} />}
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
    <label className={clsx('flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="h-4 w-4 rounded border-line accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ───────────── Surfaces ───────────── */
export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={clsx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

const BADGE: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  purple: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
};
export type BadgeColor = keyof typeof BADGE;
export function Badge({ color = 'gray', children, className }: { color?: BadgeColor; children: ReactNode; className?: string }) {
  return <span className={clsx('chip', BADGE[color], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function PageLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <Spinner /> {t('common.loading')}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="rounded-full bg-brand-50 p-3 text-brand-600">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center" role="alert">
      <div className="rounded-full bg-red-100 p-3 text-red-600 dark:bg-red-900/40">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="font-medium">{message ?? t('common.somethingWrong')}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
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
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={clsx('card max-h-[90vh] w-full overflow-hidden', { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size])}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost !p-1" onClick={onClose} aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" className="flex h-full w-full max-w-2xl flex-col bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost !p-1" onClick={onClose} aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
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
      <p className="text-sm text-muted">{message ?? t('common.cannotUndo')}</p>
    </Modal>
  );
}

/** Small menu anchored to a trigger button. */
export function Dropdown({ trigger, children, align = 'end' }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className={clsx('card absolute z-40 mt-1 min-w-[12rem] py-1', align === 'end' ? 'end-0' : 'start-0')}>{children(() => setOpen(false))}</div>
      )}
    </div>
  );
}
export function MenuItem({ onClick, children, danger }: { onClick(): void; children: ReactNode; danger?: boolean }) {
  return (
    <button className={clsx('flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-canvas', danger && 'text-red-600')} onClick={onClick}>
      {children}
    </button>
  );
}

/* ───────────── Navigation ───────────── */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: NoInfer<T>; label: ReactNode; count?: number }[]; value: T; onChange(v: NoInfer<T>): void }) {
  return (
    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            value === tab.value ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ms-1.5 rounded-full bg-canvas px-1.5 text-xs">{tab.count}</span>}
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
    <div className="flex items-center justify-between gap-2 px-1 py-3 text-sm text-muted">
      <span className="ltr-nums">{t('common.showing', { from, to, total })}</span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t('common.previous')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <span className="px-2">{t('common.page', { page, total: totalPages })}</span>
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
          <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.key} className={clsx('px-3 py-2 text-start font-medium', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row._id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-canvas')}
            >
              {columns.map((c) => (
                <td key={c.key} className={clsx('px-3 py-2.5 align-middle', c.className)}>
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
  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <ErrorState message={(query.error as Error | undefined)?.message} onRetry={() => query.refetch()} />;
  const data = query.data!;
  if (!data.items.length) return <>{empty}</>;
  return (
    <>
      <Table columns={columns} rows={data.items} onRowClick={onRowClick} />
      <Pagination page={page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={onPage} />
    </>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

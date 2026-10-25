import clsx from 'clsx';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToasts } from '@/store/toast';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  const navigate = useNavigate();
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info;
        return (
          <div
            key={t.id}
            className={clsx('card pointer-events-auto flex items-start gap-3 p-3 shadow-lg', t.href && 'cursor-pointer')}
            onClick={() => t.href && (navigate(t.href.replace(/^\/(followups|matches)\/.+$/, '/$1')), dismiss(t.id))}
          >
            <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', t.kind === 'success' ? 'text-emerald-600' : t.kind === 'error' ? 'text-red-600' : 'text-brand-600')} />
            <div className="flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.body && <p className="text-xs text-muted">{t.body}</p>}
            </div>
            <button onClick={(e) => (e.stopPropagation(), dismiss(t.id))} className="text-muted hover:text-ink" aria-label="dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

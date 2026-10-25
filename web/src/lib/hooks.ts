import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { categoryApi, memberApi } from '@/api/endpoints';
import { ApiError, toApiError } from '@/api/client';
import { toast } from '@/store/toast';
import { useCan } from '@/store/auth';
import { PERMISSIONS } from '@recrm/shared';

export function useDebounce<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Translated, user-friendly message for an API error. */
export function useErrorText() {
  const { t, i18n } = useTranslation();
  return (err: unknown) => {
    const e = err instanceof ApiError ? err : toApiError(err);
    const key = `errors.${e.code}`;
    return i18n.exists(key) ? t(key) : e.message || t('common.somethingWrong');
  };
}

/** Shows an error toast; returns field errors from a VALIDATION_ERROR for inline display. */
export function useOnError() {
  const text = useErrorText();
  return (err: unknown): Record<string, string> => {
    const e = toApiError(err);
    toast.error(text(e));
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) {
      return Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [d.path.split('.')[0], d.message]));
    }
    return {};
  };
}

/** Options for a translated enum select. */
export function useEnumOptions(group: string, values: readonly string[]) {
  const { t } = useTranslation();
  return values.map((v) => ({ value: v, label: t(`enums.${group}.${v}`) }));
}

export function useCategories() {
  const { i18n } = useTranslation();
  const q = useQuery({ queryKey: ['categories'], queryFn: () => categoryApi.list(), staleTime: 5 * 60_000 });
  const name = (id?: string) => {
    const c = q.data?.find((x) => x._id === id);
    return c ? (i18n.language === 'ur' && c.nameUr ? c.nameUr : c.name) : undefined;
  };
  const options = (q.data ?? []).map((c) => ({ value: c._id, label: (i18n.language === 'ur' && c.nameUr) || c.name }));
  return { ...q, name, options };
}

export function useMembers() {
  const canRead = useCan(PERMISSIONS.MEMBERS_READ);
  const q = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list(), enabled: canRead, staleTime: 5 * 60_000 });
  const active = (q.data?.items ?? []).filter((m) => m.status === 'ACTIVE');
  const name = (userId?: string) => active.find((m) => m.user._id === userId)?.user.fullName;
  const options = active.map((m) => ({ value: m.user._id, label: m.user.fullName }));
  return { ...q, name, options };
}

/** Reads ?page=… style state from the URL so lists survive reloads and back navigation. */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const read = () => {
    const sp = new URLSearchParams(window.location.search);
    return Object.fromEntries(Object.keys(defaults).map((k) => [k, sp.get(k) ?? defaults[k]])) as T;
  };
  const [state, setState] = useState<T>(read);
  const update = (patch: Partial<T>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) if (v && v !== defaults[k]) sp.set(k, v);
      const qs = sp.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      return next;
    });
  };
  return [state, update] as const;
}

import { useQueries } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ownerApi } from '@/api/endpoints';
import { Select } from '@/components/ui';

/** Chips for the chosen ids plus a dropdown to add one more. */
export function MultiPicker({ label, values, onChange, options, names, placeholder, max = 10 }: { label: string; values: string[]; onChange(v: string[]): void; options: { value: string; label: string }[]; names: Record<string, string>; placeholder: string; max?: number }) {
  const free = options.filter((o) => !values.includes(o.value));
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      {!!values.length && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-600 dark:bg-brand-600/20">
              {names[v] ?? options.find((o) => o.value === v)?.label ?? '…'}
              <button type="button" aria-label="Remove" className="rounded-full hover:bg-brand-100" onClick={() => onChange(values.filter((x) => x !== v))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {values.length < max && <Select aria-label={label} placeholder={placeholder} options={free} value="" onChange={(e) => e.target.value && onChange([...values, e.target.value])} />}
    </div>
  );
}

/** Names of owners already linked to a record (they may not be in the current search results). */
export function useOwnerNames(ids: string[]) {
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: ['owner', id], queryFn: () => ownerApi.get(id), staleTime: 5 * 60_000 })) });
  return Object.fromEntries(qs.flatMap((q) => (q.data ? [[q.data._id, q.data.fullName]] : []))) as Record<string, string>;
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Lock, Paperclip, Pencil, Plus, Tags, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PAYMENT_METHODS, PERMISSIONS, TRANSACTION_TYPES, type TransactionType } from '@recrm/shared';
import { exportApi, transactionApi } from '@/api/endpoints';
import type { Transaction, TransactionCategory } from '@/api/types';
import { BranchField } from '@/components/branches';
import { DocumentsPanel } from '@/components/domain/panels';
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Table, Tabs, type Column } from '@/components/ui';
import { formatDate, formatPkr } from '@/lib/format';
import { useDebounce, useEnumOptions, useErrorText, useOnError, useUrlState } from '@/lib/hooks';
import { useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const refName = (v: unknown, key: string) => (v && typeof v === 'object' ? String((v as Record<string, unknown>)[key] ?? '') : '');
const refId = (v: unknown) => (v && typeof v === 'object' ? String((v as { _id: string })._id) : v ? String(v) : '');

/** Category label in the current language (Urdu name when there is one). */
export function useCategoryLabel() {
  const { i18n } = useTranslation();
  return (c?: Partial<TransactionCategory> | null) => (!c ? '—' : i18n.language === 'ur' && c.nameUr ? c.nameUr : (c.name ?? '—'));
}

export function useTransactionCategories(includeArchived = false) {
  return useQuery({ queryKey: ['transactionCategories', includeArchived], queryFn: () => transactionApi.categories(includeArchived), staleTime: 5 * 60_000 });
}

function TypeBadge({ type }: { type: TransactionType }) {
  const { t } = useTranslation();
  return <Badge color={type === 'INCOME' ? 'green' : 'red'}>{t(`enums.transactionType.${type}`)}</Badge>;
}

/* ═════════════ Entry form ═════════════ */

export function TransactionFormDrawer({ onClose, entry, defaults }: { onClose(): void; entry?: Transaction; defaults?: { type?: TransactionType; dealId?: string; clientId?: string } }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const label = useCategoryLabel();
  const cats = useTransactionCategories();
  const methods = useEnumOptions('paymentMethod', PAYMENT_METHODS);
  const types = useEnumOptions('transactionType', TRANSACTION_TYPES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    branchId: entry?.branchId ?? '',
    type: (entry?.type ?? defaults?.type ?? 'EXPENSE') as TransactionType,
    categoryId: refId(entry?.categoryId),
    amount: entry ? String(entry.amount) : '',
    date: (entry?.date ?? new Date().toISOString()).slice(0, 10),
    method: entry?.method ?? 'CASH',
    description: entry?.description ?? '',
    reference: entry?.reference ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const options = (cats.data ?? []).filter((c) => c.type === form.type).map((c) => ({ value: c._id, label: label(c) }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(form.branchId ? { branchId: form.branchId } : {}),
        type: form.type,
        categoryId: form.categoryId,
        amount: Number(form.amount),
        date: new Date(form.date).toISOString(),
        method: form.method,
        description: form.description || undefined,
        reference: form.reference || undefined,
        ...(!entry && defaults?.dealId ? { dealId: defaults.dealId } : {}),
        ...(!entry && defaults?.clientId ? { clientId: defaults.clientId } : {}),
      };
      return entry ? transactionApi.update(entry._id, { ...body, baseVersion: entry.version }) : transactionApi.create({ ...body, uuid: crypto.randomUUID() });
    },
    onSuccess: () => {
      toast.success(entry ? t('finance.updated') : t('finance.saved'));
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'finance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => setErrors(onError(e)),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title={entry ? t('finance.edit') : t('finance.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} disabled={!form.categoryId || !(Number(form.amount) > 0)} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <BranchField value={form.branchId} onChange={(v) => setForm((f) => ({ ...f, branchId: v }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('finance.type')} options={types} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TransactionType, categoryId: '' }))} />
          <Select label={t('finance.category')} placeholder="—" options={options} value={form.categoryId} onChange={set('categoryId')} error={errors.categoryId} />
          <Input label={t('finance.amount')} type="number" min={1} value={form.amount} onChange={set('amount')} error={errors.amount} />
          <Input label={t('common.date')} type="date" value={form.date} onChange={set('date')} />
          <Select label={t('deal.method')} options={methods} value={form.method} onChange={set('method')} />
          <Input label={t('deal.reference')} value={form.reference} onChange={set('reference')} />
        </div>
        <Input label={t('finance.description')} value={form.description} onChange={set('description')} />
      </form>
    </Drawer>
  );
}

/* ═════════════ Categories ═════════════ */

function CategoriesModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const label = useCategoryLabel();
  const cats = useTransactionCategories(true);
  const types = useEnumOptions('transactionType', TRANSACTION_TYPES);
  const [form, setForm] = useState({ name: '', nameUr: '', type: 'EXPENSE' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['transactionCategories'] });
  const add = useMutation({
    mutationFn: () => transactionApi.createCategory({ ...form, nameUr: form.nameUr || undefined, uuid: crypto.randomUUID() }),
    onSuccess: () => (setForm({ name: '', nameUr: '', type: form.type }), refresh()),
    onError,
  });
  const archive = useMutation({ mutationFn: (c: TransactionCategory) => transactionApi.updateCategory(c._id, { archived: !c.archivedAt }), onSuccess: refresh, onError });
  return (
    <Modal open onClose={onClose} title={t('finance.categories')}>
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <Input label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label={t('finance.nameUr')} dir="rtl" value={form.nameUr} onChange={(e) => setForm({ ...form, nameUr: e.target.value })} />
        <Select label={t('finance.type')} options={types} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
        <Button loading={add.isPending} disabled={!form.name.trim()} onClick={() => add.mutate()} icon={<Plus className="h-4 w-4" />}>{t('common.add')}</Button>
      </div>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
        {(cats.data ?? []).map((c) => (
          <li key={c._id} className={`flex items-center justify-between py-1.5 ${c.archivedAt ? 'text-muted line-through' : ''}`}>
            <span>
              <TypeBadge type={c.type} /> {label(c)} {c.isSystem && <Lock className="inline h-3 w-3 text-muted" aria-label={t('finance.builtIn')} />}
            </span>
            <Button variant="ghost" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => archive.mutate(c)}>
              {c.archivedAt ? t('common.restore') : t('common.archive')}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ═════════════ Entries page ═════════════ */

function ReceiptsModal({ entry, onClose }: { entry: Transaction; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <Modal open onClose={onClose} title={t('finance.receipts')}>
      <DocumentsPanel entityType="transaction" entityId={entry._id} />
    </Modal>
  );
}

export function FinancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const label = useCategoryLabel();
  const canCreate = useCan(PERMISSIONS.FINANCE_CREATE);
  const canUpdate = useCan(PERMISSIONS.FINANCE_UPDATE);
  const canDelete = useCan(PERMISSIONS.FINANCE_DELETE);
  // The report needs reports:read (like every report); without it only the entries are shown.
  const canReports = useCan(PERMISSIONS.REPORTS_READ);
  const [filters, setFilters] = useUrlState({ tab: 'entries', q: '', type: '', categoryId: '', method: '', from: '', to: '', page: '1' });
  const q = useDebounce(filters.q, 300);
  const params = { q, type: filters.type, categoryId: filters.categoryId, method: filters.method, from: filters.from, to: filters.to ? `${filters.to}T23:59:59` : '', page: Number(filters.page), limit: 20 };
  const list = useQuery({ queryKey: ['transactions', params], queryFn: () => transactionApi.list(params), placeholderData: (p) => p, enabled: filters.tab === 'entries' || !canReports });
  const cats = useTransactionCategories();
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [receipts, setReceipts] = useState<Transaction | null>(null);
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (x: Transaction) => transactionApi.remove(x._id),
    onSuccess: () => (toast.success(t('finance.deleted')), setRemoving(null), void qc.invalidateQueries({ queryKey: ['transactions'] }), void qc.invalidateQueries({ queryKey: ['reports', 'finance'] })),
    onError,
  });
  const f = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ [k]: e.target.value, page: '1' } as never);
  const columns: Column<Transaction>[] = [
    { key: 'date', header: t('common.date'), render: (x) => <span className="ltr-nums">{formatDate(x.date)}</span> },
    { key: 'type', header: t('finance.type'), render: (x) => <TypeBadge type={x.type} /> },
    { key: 'category', header: t('finance.category'), render: (x) => label(typeof x.categoryId === 'object' ? x.categoryId : null) },
    {
      key: 'amount',
      header: t('finance.amount'),
      render: (x) => <span className={`ltr-nums font-medium ${x.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>{x.type === 'EXPENSE' ? '−' : '+'}{formatPkr(x.amount)}</span>,
    },
    { key: 'method', header: t('deal.method'), render: (x) => t(`enums.paymentMethod.${x.method}`) },
    {
      key: 'link',
      header: t('finance.linkedTo'),
      render: (x) =>
        x.dealId && typeof x.dealId === 'object' ? (
          <Link className="ltr-nums hover:underline" to={`/deals/${x.dealId._id}`} onClick={(e) => e.stopPropagation()}>{x.dealId.dealNo}</Link>
        ) : (
          refName(x.clientId, 'fullName') || '—'
        ),
    },
    { key: 'desc', header: t('finance.description'), render: (x) => <span className="line-clamp-1">{x.description || '—'}</span> },
    {
      key: 'actions',
      header: '',
      render: (x) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" aria-label={t('finance.receipts')} onClick={() => setReceipts(x)}><Paperclip className="h-4 w-4" /></Button>
          {x.source === 'COMMISSION' ? (
            <Badge color="blue">{t('finance.fromCommission')}</Badge>
          ) : (
            <>
              {canUpdate && <Button variant="ghost" size="sm" aria-label={t('common.edit')} onClick={() => setEditing(x)}><Pencil className="h-4 w-4" /></Button>}
              {canDelete && <Button variant="ghost" size="sm" aria-label={t('common.delete')} onClick={() => setRemoving(x)}><Trash2 className="h-4 w-4" /></Button>}
            </>
          )}
        </span>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title={t('finance.title')}
        subtitle={t('finance.subtitle')}
        actions={
          <>
            {canUpdate && <Button variant="secondary" icon={<Tags className="h-4 w-4" />} onClick={() => setCatsOpen(true)}>{t('finance.categories')}</Button>}
            {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('finance.add')}</Button>}
          </>
        }
      />
      <div className="mb-4">
        <Tabs value={canReports ? filters.tab : 'entries'} onChange={(v) => setFilters({ tab: v })} tabs={[{ value: 'entries', label: t('finance.entries') }, ...(canReports ? [{ value: 'report', label: t('finance.report') }] : [])]} />
      </div>
      {filters.tab === 'report' && canReports ? (
        <FinanceReport />
      ) : (
        <>
          <Card className="mb-4" bodyClassName="grid gap-3 md:grid-cols-6">
            <Input placeholder={t('finance.searchPlaceholder')} value={filters.q} onChange={f('q')} aria-label={t('common.search')} />
            <Select options={useEnumOptions('transactionType', TRANSACTION_TYPES)} placeholder={`${t('finance.type')}: ${t('common.all')}`} value={filters.type} onChange={f('type')} />
            <Select options={(cats.data ?? []).filter((c) => !filters.type || c.type === filters.type).map((c) => ({ value: c._id, label: label(c) }))} placeholder={`${t('finance.category')}: ${t('common.all')}`} value={filters.categoryId} onChange={f('categoryId')} />
            <Select options={useEnumOptions('paymentMethod', PAYMENT_METHODS)} placeholder={`${t('deal.method')}: ${t('common.all')}`} value={filters.method} onChange={f('method')} />
            <Input type="date" aria-label={t('common.from')} value={filters.from} onChange={f('from')} />
            <Input type="date" aria-label={t('common.to')} value={filters.to} onChange={f('to')} />
          </Card>
          {list.isLoading ? (
            <PageLoader />
          ) : list.isError ? (
            <ErrorState onRetry={() => list.refetch()} />
          ) : !list.data!.items.length ? (
            <EmptyState title={t('finance.empty')} hint={t('finance.emptyHint')} icon={<Wallet className="h-6 w-6" />} action={canCreate ? <Button onClick={() => setEditing('new')}>{t('finance.add')}</Button> : undefined} />
          ) : (
            <>
              <Table columns={columns} rows={list.data!.items} />
              <Pagination page={Number(filters.page)} totalPages={list.data!.meta.totalPages} total={list.data!.meta.total} limit={20} onChange={(p) => setFilters({ page: String(p) })} />
            </>
          )}
        </>
      )}
      {editing && <TransactionFormDrawer entry={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {receipts && <ReceiptsModal entry={receipts} onClose={() => setReceipts(null)} />}
      {catsOpen && <CategoriesModal onClose={() => setCatsOpen(false)} />}
      <ConfirmDialog
        open={!!removing}
        title={t('finance.deleteTitle')}
        message={t('finance.deleteMessage')}
        danger
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

/* ═════════════ Report ═════════════ */

export function FinanceReport() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const [groupBy, setGroupBy] = useState<'month' | 'category'>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = { groupBy, from: from || undefined, to: to ? `${to}T23:59:59` : undefined };
  const q = useQuery({ queryKey: ['reports', 'finance', params], queryFn: () => transactionApi.report(params) });
  const canExport = useCan(PERMISSIONS.EXPORTS_CREATE);
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (resource: 'finance' | 'transactions', format: 'xlsx' | 'pdf') => {
    setBusy(`${resource}-${format}`);
    try {
      await exportApi.download(resource, format, { groupBy, from, to: to ? `${to}T23:59:59` : '' });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const rowLabel = (r: { key: string; label: string; labelUr?: string }) => (groupBy === 'category' && i18n.language === 'ur' && r.labelUr ? r.labelUr : r.label);
  return (
    <Card title={t('finance.reportTitle')}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select label={t('deal.groupBy')} options={[{ value: 'month', label: t('deal.byMonth') }, { value: 'category', label: t('finance.byCategory') }]} value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'month' | 'category')} />
        <Input label={t('common.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t('common.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {canExport && (
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'finance-xlsx'} onClick={() => void download('finance', 'xlsx')}>{t('report.excel')}</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'finance-pdf'} onClick={() => void download('finance', 'pdf')}>{t('report.pdf')}</Button>
            <Button variant="ghost" icon={<Download className="h-4 w-4" />} loading={busy === 'transactions-xlsx'} onClick={() => void download('transactions', 'xlsx')}>{t('finance.allEntries')}</Button>
          </>
        )}
      </div>
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
            <div><p className="text-muted">{t('finance.income')}</p><p className="ltr-nums text-base font-semibold text-emerald-600">{formatPkr(q.data.totals.income)}</p></div>
            <div><p className="text-muted">{t('finance.expense')}</p><p className="ltr-nums text-base font-semibold text-red-600">{formatPkr(q.data.totals.expense)}</p></div>
            <div><p className="text-muted">{t('finance.net')}</p><p className={`ltr-nums text-base font-semibold ${q.data.totals.net < 0 ? 'text-red-600' : ''}`}>{formatPkr(q.data.totals.net)}</p></div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-1 text-start">{groupBy === 'month' ? t('deal.month') : t('finance.category')}</th>
                <th className="py-1 text-end">{t('finance.income')}</th>
                <th className="py-1 text-end">{t('finance.expense')}</th>
                <th className="py-1 text-end">{t('finance.net')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="ltr-nums py-1.5">{rowLabel(r)}</td>
                  <td className="ltr-nums py-1.5 text-end">{formatPkr(r.income)}</td>
                  <td className="ltr-nums py-1.5 text-end">{formatPkr(r.expense)}</td>
                  <td className={`ltr-nums py-1.5 text-end ${r.net < 0 ? 'text-red-600' : ''}`}>{formatPkr(r.net)}</td>
                </tr>
              ))}
              {!q.data.rows.length && <tr><td colSpan={4} className="py-2 text-muted">{t('finance.empty')}</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

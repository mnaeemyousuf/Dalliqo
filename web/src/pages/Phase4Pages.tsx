import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bookmark, CheckCircle2, Circle, Download, FileUp, QrCode, ShieldCheck, Trash2 } from 'lucide-react';
import { PERMISSIONS, VERIFICATION_STATUSES, type VerificationStatus } from '@recrm/shared';
import { toApiError } from '@/api/client';
import { dealApi as dealApprovalApi, verificationApi, inventoryApi } from '@/api/endpoints';
import type { ImportResult, Property } from '@/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Input, MetricTile, Modal, PageHeader, PageLoader, Pagination, Select, Textarea, Checkbox, type BadgeColor } from '@/components/ui';
import { formatDate, formatPkr, relativeTime } from '@/lib/format';
import { useEnumOptions, useMembers, useOnError } from '@/lib/hooks';
import { useCan } from '@/store/auth';
import { toast } from '@/store/toast';

export const VERIFICATION_COLOR: Record<VerificationStatus, BadgeColor> = {
  NOT_SUBMITTED: 'gray',
  PENDING: 'amber',
  IN_REVIEW: 'blue',
  CHANGES_REQUESTED: 'purple',
  APPROVED: 'green',
  REJECTED: 'red',
};

export function VerificationBadgeSmall({ status }: { status?: VerificationStatus }) {
  const { t } = useTranslation();
  if (!status || status === 'NOT_SUBMITTED') return null;
  return <Badge color={VERIFICATION_COLOR[status]}>{t(`verification.status.${status}`)}</Badge>;
}

/* ═════════════ Verification tab (property detail) ═════════════ */

export function VerificationPanel({ property }: { property: Property }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const members = useMembers();
  const canSubmit = useCan(PERMISSIONS.VERIFICATION_SUBMIT);
  const canDecide = useCan(PERMISSIONS.VERIFICATION_DECIDE);
  const key = ['verification', property._id];
  const q = useQuery({ queryKey: key, queryFn: () => verificationApi.get(property._id) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['property', property._id] });
  };
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [decision, setDecision] = useState<{ decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'; remarks: string; next: string } | null>(null);
  const submit = useMutation({ mutationFn: () => verificationApi.submit(property._id, note || undefined), onSuccess: () => (setNote(''), toast.success(t('verification.submitted')), refresh()), onError });
  const assign = useMutation({ mutationFn: () => verificationApi.assign(property._id, assignee), onSuccess: refresh, onError });
  const tick = useMutation({ mutationFn: (v: { key: string; done: boolean }) => verificationApi.checklist(property._id, v.key, v.done), onSuccess: refresh, onError });
  const decide = useMutation({
    mutationFn: () => verificationApi.decide(property._id, { decision: decision!.decision, remarks: decision!.remarks || undefined, nextVerificationAt: decision!.next || undefined }),
    onSuccess: () => (setDecision(null), toast.success(t('verification.decided')), refresh()),
    onError,
  });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <PageLoader />;
  const v = q.data;
  const open = ['PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(v.status);
  const done = v.checklist.filter((c) => c.done).length;
  // Only members who can approve verifications can be assigned (owners hold every permission).
  const officers = (members.data?.items ?? [])
    .filter((m) => m.status === 'ACTIVE' && (m.role === 'OWNER' || m.permissions.includes(PERMISSIONS.VERIFICATION_DECIDE)))
    .map((m) => ({ value: m.user._id, label: m.user.fullName }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-brand-600" />
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{t('verification.title')}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge color={VERIFICATION_COLOR[v.status]}>{t(`verification.status.${v.status}`)}</Badge>
                {v.verifiedAt && <span className="text-xs text-muted">{t('verification.verifiedOn', { date: formatDate(v.verifiedAt), name: members.name(v.verifiedBy ?? undefined) ?? '' })}</span>}
                {v.nextVerificationAt && <span className="text-xs text-muted">· {t('verification.next', { date: formatDate(v.nextVerificationAt) })}</span>}
              </div>
            </div>
          </div>
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t('verification.disclaimer')}</p>
          {v.remarks && <p className="mt-3 text-sm"><span className="font-semibold">{t('verification.remarks')}:</span> {v.remarks}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {canSubmit && (v.status === 'NOT_SUBMITTED' || v.status === 'CHANGES_REQUESTED' || v.status === 'APPROVED' || v.status === 'REJECTED') && (
              <>
                <Input wrapperClassName="min-w-[14rem] flex-1" placeholder={t('verification.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button loading={submit.isPending} onClick={() => submit.mutate()}>{v.status === 'NOT_SUBMITTED' ? t('verification.submit') : t('verification.resubmit')}</Button>
              </>
            )}
            {canDecide && open && (
              <>
                <Button variant="primary" onClick={() => setDecision({ decision: 'APPROVED', remarks: '', next: '' })}>{t('verification.approve')}</Button>
                <Button variant="secondary" onClick={() => setDecision({ decision: 'CHANGES_REQUESTED', remarks: '', next: '' })}>{t('verification.sendBack')}</Button>
                <Button variant="danger" onClick={() => setDecision({ decision: 'REJECTED', remarks: '', next: '' })}>{t('verification.reject')}</Button>
              </>
            )}
          </div>
          {canSubmit && open && officers.length > 0 && (
            <div className="mt-4 flex items-end gap-2 border-t border-line pt-4">
              <Select wrapperClassName="flex-1" label={t('verification.assignTo')} placeholder={members.name(v.assignedTo ?? undefined) ?? '—'} options={officers} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
              <Button variant="secondary" disabled={!assignee} loading={assign.isPending} onClick={() => assign.mutate()}>{t('lead.assign')}</Button>
            </div>
          )}
        </Card>
        <Card title={t('verification.checklist')} actions={<span className="ltr-nums text-xs font-semibold text-muted">{done}/{v.checklist.length}</span>}>
          <ul className="space-y-1">
            {v.checklist.map((c) => (
              <li key={c.key}>
                <button
                  disabled={!canSubmit || !open || tick.isPending}
                  onClick={() => tick.mutate({ key: c.key, done: !c.done })}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm transition-colors hover:bg-surface-2 disabled:cursor-default"
                >
                  {c.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="h-5 w-5 shrink-0 text-subtle" />}
                  <span className={c.done ? 'text-muted' : 'text-ink'}>{t(`verification.items.${c.key}`)}</span>
                  {v.missingDocuments.includes(c.key) && <Badge color="amber" className="ms-auto">{t('verification.docMissing')}</Badge>}
                  {c.doneAt && <span className="ltr-nums ms-auto text-2xs text-muted">{formatDate(c.doneAt)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {!open && <p className="mt-3 text-xs text-muted">{t('verification.checklistLocked')}</p>}
        </Card>
      </div>
      <div className="space-y-4">
        {(v.missingDocuments.length > 0 || v.expiringDocuments.length > 0) && (
          <Card title={t('verification.attention')}>
            <ul className="space-y-2 text-sm">
              {v.missingDocuments.map((k) => (
                <li key={k} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />{t('verification.missing', { item: t(`verification.items.${k}`) })}</li>
              ))}
              {v.expiringDocuments.map((d) => (
                <li key={d.fileName} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />{t('verification.expiring', { name: d.fileName, date: formatDate(d.expiresAt) })}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{t('verification.uploadHint')}</p>
          </Card>
        )}
        <Card title={t('lead.history')}>
          {!v.history.length ? (
            <p className="text-sm text-muted">—</p>
          ) : (
            <ol className="relative space-y-3 border-s border-line ps-4">
              {[...v.history].reverse().map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -start-[1.32rem] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-surface" />
                  <p className="font-medium">{t(`verification.actions.${h.action}`, { defaultValue: h.action })}</p>
                  <p className="text-xs text-muted">{members.name(h.by ?? undefined) ?? ''} · {relativeTime(h.at)}</p>
                  {h.remarks && <p className="mt-0.5 text-xs text-ink-2">{h.remarks}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision ? t(`verification.decisionTitle.${decision.decision}`) : ''}
        footer={<Button loading={decide.isPending} onClick={() => decide.mutate()}>{t('common.confirm')}</Button>}
      >
        {decision && (
          <div className="space-y-3">
            <Textarea label={t('verification.remarks')} required={decision.decision !== 'APPROVED'} value={decision.remarks} onChange={(e) => setDecision({ ...decision, remarks: e.target.value })} />
            {decision.decision === 'APPROVED' && <Input label={t('verification.nextDate')} type="date" value={decision.next} onChange={(e) => setDecision({ ...decision, next: e.target.value })} hint={t('verification.nextHint')} />}
            <p className="text-xs text-muted">{t('verification.disclaimer')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ═════════════ Verification queue page ═════════════ */

export function VerificationsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const statuses = useEnumOptions('verificationStatus', VERIFICATION_STATUSES).map((o) => ({ ...o, label: t(`verification.status.${o.value}`) }));
  const q = useQuery({ queryKey: ['verifications', status, mine, page], queryFn: () => verificationApi.queue({ status: status || undefined, mine: mine || undefined, page, limit: 20 }) });
  return (
    <div>
      <PageHeader title={t('verification.queueTitle')} subtitle={t('verification.queueSubtitle')} />
      <Card className="mb-4" bodyClassName="flex flex-wrap items-center gap-3 !p-3">
        <Select wrapperClassName="w-56" placeholder={t('verification.openOnly')} options={statuses} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} />
        <Checkbox label={t('verification.assignedToMe')} checked={mine} onChange={(v) => (setMine(v), setPage(1))} />
      </Card>
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <PageLoader />
      ) : !q.data.items.length ? (
        <EmptyState title={t('verification.queueEmpty')} icon={<ShieldCheck className="h-6 w-6" />} />
      ) : (
        <Card bodyClassName="!p-0">
          <ul className="divide-y divide-line">
            {q.data.items.map((p) => (
              <li key={p._id}>
                <Link to={`/properties/${p._id}?tab=verification`} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                  <span className="ltr-nums font-bold text-brand-600">{p.propertyId}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{[p.society, p.block, p.plotNumber].filter(Boolean).join(', ')}</span>
                  <span className="ltr-nums text-sm font-semibold">{formatPkr(p.askingPrice)}</span>
                  <Badge color={VERIFICATION_COLOR[p.verification?.status ?? 'NOT_SUBMITTED']}>{t(`verification.status.${p.verification?.status ?? 'NOT_SUBMITTED'}`)}</Badge>
                  {p.verification?.submittedAt && <span className="text-xs text-muted">{relativeTime(p.verification.submittedAt)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} limit={20} onChange={setPage} />}
    </div>
  );
}

/* ═════════════ Property import + QR ═════════════ */

export function PropertyImportModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const members = useMembers();
  const file = useRef<HTMLInputElement>(null);
  const [agentId, setAgentId] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (f: File) => inventoryApi.importProperties(f, { agentId: agentId || undefined }),
    onSuccess: (r) => (setResult(r), void qc.invalidateQueries({ queryKey: ['properties'] })),
    onError,
  });
  const close = () => (setResult(null), onClose());
  return (
    <Modal open={open} onClose={close} title={t('property.import.title')} footer={<Button variant="secondary" onClick={close}>{t('common.close')}</Button>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <MetricTile tone="good" label={t('lead.import.created')} value={result.created} />
            <MetricTile tone="warn" label={t('lead.import.duplicates')} value={result.duplicates.length} />
            <MetricTile tone="bad" label={t('lead.import.errors')} value={result.errors.length} />
          </div>
          {[...result.duplicates.map((d) => `${t('lead.import.row')} ${d.row}: ${t('property.import.duplicateOf', { id: d.existing })}`), ...result.errors.map((e) => `${t('lead.import.row')} ${e.row}: ${e.message}`)].map((line, i) => (
            <p key={i} className="text-xs text-muted">{line}</p>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('property.import.hint')}</p>
          <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => inventoryApi.downloadTemplate().catch(onError)}>{t('lead.import.template')}</Button>
          <Select label={t('property.import.agent')} placeholder="—" options={members.options} value={agentId} onChange={(e) => setAgentId(e.target.value)} />
          <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && run.mutate(e.target.files[0])} />
          <Button icon={<FileUp className="h-4 w-4" />} loading={run.isPending} onClick={() => file.current?.click()}>{t('lead.import.choose')}</Button>
        </div>
      )}
    </Modal>
  );
}

export function PropertyQrButton({ property }: { property: Property }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const [url, setUrl] = useState<string | null>(null);
  const open = async () => {
    try {
      setUrl(await inventoryApi.qrObjectUrl(property._id));
    } catch (e) {
      onError(e);
    }
  };
  return (
    <>
      <Button variant="secondary" icon={<QrCode className="h-4 w-4" />} onClick={() => void open()}>{t('property.qr.button')}</Button>
      <Modal open={!!url} onClose={() => (url && URL.revokeObjectURL(url), setUrl(null))} title={`${t('property.qr.title')} · ${property.propertyId}`}
        footer={url && <a className="btn btn-primary" href={url} download={`${property.propertyId}-qr.png`}><Download className="h-4 w-4" />{t('property.qr.download')}</a>}>
        {url && (
          <div className="flex flex-col items-center gap-3">
            <img src={url} alt={t('property.qr.title')} className="h-64 w-64 rounded-xl ring-1 ring-line" />
            <p className="text-center text-xs text-muted">{t('property.qr.hint')}</p>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ═════════════ Deal close approval ═════════════ */

export function ApprovalBanner({ deal }: { deal: { _id: string; approval?: { status: string; requestedBy?: string; requestedAt?: string; note?: string | null } | null } }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const members = useMembers();
  const canApprove = useCan(PERMISSIONS.DEALS_APPROVE);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') => dealApprovalApi.decideApproval(deal._id, decision, note || undefined),
    onSuccess: () => (setNote(''), void qc.invalidateQueries({ queryKey: ['deal', deal._id] }), void qc.invalidateQueries({ queryKey: ['deals'] })),
    onError,
  });
  if (deal.approval?.status !== 'PENDING') return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <ShieldCheck className="h-5 w-5 text-amber-600" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t('deal.approval.pending')}</span>{' '}
        <span className="text-muted">{t('deal.approval.requestedBy', { name: members.name(deal.approval.requestedBy) ?? '', time: deal.approval.requestedAt ? relativeTime(deal.approval.requestedAt) : '' })}</span>
      </p>
      {canApprove && (
        <>
          <Input wrapperClassName="w-56" placeholder={t('verification.remarks')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" loading={decide.isPending && decide.variables === 'APPROVED'} onClick={() => decide.mutate('APPROVED')}>{t('verification.approve')}</Button>
          <Button size="sm" variant="secondary" loading={decide.isPending && decide.variables === 'REJECTED'} onClick={() => decide.mutate('REJECTED')}>{t('verification.reject')}</Button>
        </>
      )}
    </div>
  );
}

/* ═════════════ Saved views ═════════════ */

/** Save the current list filters under a name, and re-apply saved (own or shared) views. */
export function SavedViews({ page, params, onApply }: { page: 'clients' | 'properties' | 'deals' | 'followups'; params: Record<string, string>; onApply(p: Record<string, string>): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const key = ['saved-views', page];
  const q = useQuery({ queryKey: key, queryFn: () => inventoryApi.views(page) });
  const [saving, setSaving] = useState<{ name: string; shared: boolean } | null>(null);
  const create = useMutation({
    mutationFn: () => inventoryApi.createView({ page, name: saving!.name, params: Object.fromEntries(Object.entries(params).filter(([k, v]) => v && k !== 'page' && k !== 'view')), shared: saving!.shared }),
    onSuccess: () => (setSaving(null), toast.success(t('views.saved')), void qc.invalidateQueries({ queryKey: key })),
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => inventoryApi.removeView(id), onSuccess: () => void qc.invalidateQueries({ queryKey: key }), onError: (e) => toast.error(toApiError(e).message) });
  const views = q.data ?? [];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Bookmark className="h-4 w-4 text-muted" />
      {views.map((v) => (
        <span key={v._id} className="chip ring-1 ring-inset ring-line">
          <button className="hover:text-brand-600" onClick={() => onApply(v.params)}>{v.name}</button>
          {v.shared && <span className="text-2xs text-muted">· {t('views.shared')}</span>}
          <button aria-label={t('common.delete')} className="text-subtle hover:text-red-600" onClick={() => remove.mutate(v._id)}><Trash2 className="h-3 w-3" /></button>
        </span>
      ))}
      <button className="chip text-brand-600 ring-1 ring-inset ring-brand-200 hover:bg-brand-50" onClick={() => setSaving({ name: '', shared: false })}>+ {t('views.save')}</button>
      <Modal open={!!saving} onClose={() => setSaving(null)} title={t('views.save')} footer={<Button disabled={!saving?.name.trim()} loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>}>
        {saving && (
          <div className="space-y-3">
            <Input label={t('common.name')} autoFocus value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} />
            <Checkbox label={t('views.shareWithTeam')} checked={saving.shared} onChange={(v) => setSaving({ ...saving, shared: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

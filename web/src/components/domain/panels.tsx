import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Pencil, Plus, StickyNote, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DOCUMENT_CATEGORIES, FOLLOWUP_TYPES, PERMISSIONS, PRIORITIES } from '@recrm/shared';
import { activityApi, clientApi, documentApi, followUpApi, noteApi, propertyApi } from '@/api/endpoints';
import type { FollowUp } from '@/api/types';
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Modal, PageLoader, Select, Textarea, DatePicker, Input } from '@/components/ui';
import { PriorityBadge } from '@/components/domain';
import { formatBytes, formatDate, relativeTime, toLocalInput } from '@/lib/format';
import { useDebounce, useEnumOptions, useMembers, useOnError } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

type Entity = 'client' | 'property' | 'owner' | 'followUp';

export function NotesPanel({ entityType, entityId }: { entityType: Entity; entityId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const me = useAuth((s) => s.user?._id);
  const canManageAll = useCan(PERMISSIONS.NOTES_MANAGE_ALL);
  const [content, setContent] = useState('');
  const key = ['notes', entityType, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => noteApi.list(entityType, entityId) });
  const add = useMutation({
    mutationFn: () => noteApi.create(entityType, entityId, content.trim()),
    onSuccess: () => {
      setContent('');
      toast.success(t('note.added'));
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
    onError,
  });
  const remove = useMutation({ mutationFn: noteApi.remove, onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError });

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (content.trim()) add.mutate();
        }}
      >
        <Textarea placeholder={t('note.placeholder')} value={content} onChange={(e) => setContent(e.target.value)} maxLength={5000} />
        <div className="flex justify-end">
          <Button type="submit" loading={add.isPending} disabled={!content.trim()} icon={<Plus className="h-4 w-4" />}>
            {t('note.add')}
          </Button>
        </div>
      </form>
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <EmptyState title={t('note.noNotes')} />
      ) : (
        <ol className="space-y-3">
          {q.data!.items.map((n) => {
            const author = typeof n.createdBy === 'object' ? n.createdBy : null;
            return (
              <li key={n._id} className="rounded-lg border border-line p-3">
                <p className="whitespace-pre-wrap text-sm">{n.content}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>
                    {author?.fullName} · {relativeTime(n.createdAt)}
                  </span>
                  {(author?._id === me || canManageAll) && (
                    <button className="hover:text-red-600" onClick={() => remove.mutate(n._id)} aria-label={t('common.delete')}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ActivityPanel({ entityId }: { entityId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['activities', entityId], queryFn: () => activityApi.list({ entityId, limit: 100 }) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data!.items.length) return <EmptyState title={t('activity.noActivity')} />;
  return (
    <ol className="relative space-y-4 border-s border-line ps-5">
      {q.data!.items.map((a) => (
        <li key={a._id} className="relative">
          <span className="absolute -start-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-4 ring-surface" />
          <p className="text-sm">{a.summary}</p>
          <p className="text-xs text-muted">
            {a.actorUserId?.fullName} · {formatDate(a.createdAt, true)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Renames a stored document (metadata only; the stored object keeps its safe key). */
export function RenameDocumentModal({ doc, onClose, onSaved }: { doc: { _id: string; fileName: string } | null; onClose(): void; onSaved?(): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (doc && doc._id !== lastId) {
    setLastId(doc._id);
    setName(doc.fileName);
  }
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!doc || !name.trim()) return;
    setSaving(true);
    try {
      await documentApi.update(doc._id, { fileName: name.trim() });
      toast.success(t('document.renamed'));
      onSaved?.();
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      title={t('document.rename')}
      size="sm"
      footer={
        <Button loading={saving} disabled={!name.trim()} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      }
    >
      <form onSubmit={(e) => void save(e)}>
        <Input label={t('document.fileName')} value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} />
      </form>
    </Modal>
  );
}

export function DocumentsPanel({ entityType, entityId }: { entityType: 'client' | 'property' | 'owner'; entityId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canUpload = useCan(PERMISSIONS.DOCUMENTS_UPLOAD);
  const canDelete = useCan(PERMISSIONS.DOCUMENTS_DELETE);
  const categories = useEnumOptions('documentCategory', DOCUMENT_CATEGORIES);
  const [category, setCategory] = useState('OTHER');
  const [progress, setProgress] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [toRename, setToRename] = useState<{ _id: string; fileName: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const key = ['documents', entityType, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => documentApi.list({ entityType, entityId, limit: 100 }) });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setProgress(0);
      try {
        await documentApi.upload({ entityType, entityId, category }, file, setProgress);
        toast.success(t('document.uploaded'), file.name);
      } catch (e) {
        onError(e);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['activities'] });
  }

  async function open(id: string) {
    try {
      const { url } = await documentApi.downloadUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      onError(e);
    }
  }

  async function share(id: string) {
    try {
      const { url, fileName } = await documentApi.downloadUrl(id);
      if (navigator.share) await navigator.share({ title: fileName, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t('common.copied'));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onError(e);
    }
  }

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3">
          <Select label={t('document.category')} options={categories} value={category} onChange={(e) => setCategory(e.target.value)} wrapperClassName="w-48" />
          <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={(e) => void upload(e.target.files)} />
          <Button icon={<Upload className="h-4 w-4" />} loading={progress !== null} onClick={() => input.current?.click()}>
            {progress !== null ? `${progress}%` : t('document.upload')}
          </Button>
          <p className="text-xs text-muted">{t('document.allowed')}</p>
        </div>
      )}
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <EmptyState title={t('document.noDocuments')} icon={<FileText className="h-6 w-6" />} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data!.items.map((d) => (
            <li key={d._id} className="flex items-center gap-3 py-2.5">
              {d.thumbnailUrl ? <img src={d.thumbnailUrl} alt="" className="h-10 w-10 rounded object-cover" /> : <FileText className="h-10 w-10 p-2 text-muted" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.fileName}</p>
                <p className="text-xs text-muted">
                  <Badge>{t(`enums.documentCategory.${d.category}`)}</Badge> · {formatBytes(d.fileSize)} · {formatDate(d.createdAt)}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void open(d._id)} icon={<Download className="h-4 w-4" />}>
                {t('document.preview')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void share(d._id)}>
                {t('common.share')}
              </Button>
              {canUpload && (
                <Button size="sm" variant="ghost" onClick={() => setToRename(d)} aria-label={t('document.rename')}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" onClick={() => setToDelete(d._id)} aria-label={t('common.delete')}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RenameDocumentModal doc={toRename} onClose={() => setToRename(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ['documents'] })} />
      <ConfirmDialog
        open={!!toDelete}
        title={t('common.areYouSure')}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try {
            await documentApi.remove(toDelete!);
            void qc.invalidateQueries({ queryKey: key });
          } catch (e) {
            onError(e);
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

/** Create a follow-up; client and property can be preset from the page it is opened on. */
export function FollowUpForm({ open, onClose, clientId, propertyId }: { open: boolean; onClose(): void; clientId?: string; propertyId?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const me = useAuth((s) => s.user?._id);
  const members = useMembers();
  const types = useEnumOptions('followUpType', FOLLOWUP_TYPES);
  const priorities = useEnumOptions('priority', PRIORITIES);
  const inAnHour = new Date(Date.now() + 3_600_000);
  inAnHour.setMinutes(0, 0, 0);
  const [form, setForm] = useState({ clientId: clientId ?? '', propertyId: propertyId ?? '', type: 'CALL', dueAt: toLocalInput(inAnHour), priority: 'MEDIUM', notes: '', assignedTo: me ?? '', reminderMinutesBefore: '30' });
  const [clientSearch, setClientSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const cq = useDebounce(clientSearch, 250);
  const pq = useDebounce(propertySearch, 250);
  const clients = useQuery({ queryKey: ['clients', 'pick', cq], queryFn: () => clientApi.list({ q: cq, limit: 20 }), enabled: open && !clientId });
  const properties = useQuery({ queryKey: ['properties', 'pick', pq], queryFn: () => propertyApi.list({ q: pq, limit: 20 }), enabled: open && !propertyId });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      followUpApi.create({
        clientId: form.clientId,
        propertyId: form.propertyId || undefined,
        type: form.type,
        dueAt: new Date(form.dueAt).toISOString(),
        priority: form.priority,
        notes: form.notes || undefined,
        assignedTo: form.assignedTo || undefined,
        reminderMinutesBefore: Number(form.reminderMinutesBefore),
      }),
    onSuccess: () => {
      toast.success(t('followup.created'));
      for (const k of ['followups', 'myDay', 'dashboard', 'activities']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('followup.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!form.clientId || !form.dueAt} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate())}>
        {!clientId && (
          <div className="sm:col-span-2">
            <Input label={t('followup.client')} placeholder={t('client.searchPlaceholder')} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
            <Select
              wrapperClassName="mt-2"
              placeholder={t('followup.selectClient')}
              options={(clients.data?.items ?? []).map((c) => ({ value: c._id, label: `${c.fullName} — ${c.mobileNumber}` }))}
              value={form.clientId}
              onChange={set('clientId')}
            />
          </div>
        )}
        {!propertyId && (
          <div className="sm:col-span-2">
            <Input label={t('followup.property')} placeholder={t('property.searchPlaceholder')} value={propertySearch} onChange={(e) => setPropertySearch(e.target.value)} />
            <Select
              wrapperClassName="mt-2"
              placeholder={t('followup.selectProperty')}
              options={(properties.data?.items ?? []).map((p) => ({ value: p._id, label: `${p.propertyId} — ${p.society ?? p.area ?? ''}` }))}
              value={form.propertyId}
              onChange={set('propertyId')}
            />
          </div>
        )}
        <Select label={t('followup.type')} options={types} value={form.type} onChange={set('type')} />
        <DatePicker label={t('followup.dueAt')} value={form.dueAt} onChange={set('dueAt')} required />
        <Select label={t('followup.priority')} options={priorities} value={form.priority} onChange={set('priority')} />
        <Select
          label={t('followup.reminderBefore')}
          options={[0, 15, 30, 60, 120, 1440].map((m) => ({ value: String(m), label: `${m} ${t('common.minutes')}` }))}
          value={form.reminderMinutesBefore}
          onChange={set('reminderMinutesBefore')}
        />
        {members.options.length > 0 && <Select label={t('followup.assignedTo')} options={members.options} value={form.assignedTo} onChange={set('assignedTo')} wrapperClassName="sm:col-span-2" />}
        <Textarea label={t('common.notes')} value={form.notes} onChange={set('notes')} wrapperClassName="sm:col-span-2" />
      </form>
    </Modal>
  );
}

export function FollowUpItem({ f, showClient = true }: { f: FollowUp; showClient?: boolean }) {
  const { t } = useTranslation();
  const canUpdateFollowUps = useCan(PERMISSIONS.FOLLOWUPS_UPDATE);
  const qc = useQueryClient();
  const onError = useOnError();
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDue, setNewDue] = useState(() => toLocalInput(new Date(f.dueAt)));
  const reschedule = useMutation({
    mutationFn: () => followUpApi.update(f._id, { dueAt: new Date(newDue).toISOString() }),
    onSuccess: () => {
      toast.success(t('followup.rescheduled'));
      setRescheduleOpen(false);
      for (const k of ['followups', 'myDay', 'dashboard', 'activities']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError,
  });
  const client = typeof f.clientId === 'object' ? f.clientId : null;
  const property = typeof f.propertyId === 'object' ? f.propertyId : null;
  const assignee = typeof f.assignedTo === 'object' ? f.assignedTo : null;
  const open = f.status === 'PENDING' || f.status === 'OVERDUE';
  const complete = useMutation({
    mutationFn: () => followUpApi.complete(f._id, outcome || undefined),
    onSuccess: () => {
      toast.success(t('followup.completed'));
      setOutcomeOpen(false);
      for (const k of ['followups', 'myDay', 'dashboard', 'activities']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError,
  });
  const color = { PENDING: 'blue', OVERDUE: 'red', COMPLETED: 'green', CANCELLED: 'gray' } as const;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="ltr-nums w-32 shrink-0 text-xs text-muted">{formatDate(f.dueAt, true)}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {t(`enums.followUpType.${f.type}`)}
          {showClient && client && (
            <>
              {' · '}
              <Link to={`/clients/${client._id}`} className="hover:underline">
                {client.fullName}
              </Link>
            </>
          )}
          {property && (
            <>
              {' · '}
              <Link to={`/properties/${property._id}`} className="ltr-nums text-muted hover:underline">
                {property.propertyId}
              </Link>
            </>
          )}
        </p>
        <p className="text-xs text-muted">
          {assignee?.fullName}
          {f.notes ? ` · ${f.notes}` : ''}
          {f.outcome ? ` · ${f.outcome}` : ''}
        </p>
      </div>
      <PriorityBadge priority={f.priority} />
      <Badge color={color[f.status]}>{t(`enums.followUpStatus.${f.status}`)}</Badge>
      <Button size="sm" variant="ghost" onClick={() => setNotesOpen(true)} aria-label={t('note.title')} title={t('note.title')}>
        <StickyNote className="h-4 w-4" />
      </Button>
      {open && canUpdateFollowUps && (
        <Button size="sm" variant="ghost" onClick={() => (setNewDue(toLocalInput(new Date(Math.max(Date.now() + 3_600_000, new Date(f.dueAt).getTime())))), setRescheduleOpen(true))}>
          {t('followup.reschedule')}
        </Button>
      )}
      {open && (
        <Button size="sm" variant="secondary" onClick={() => setOutcomeOpen(true)}>
          {t('followup.complete')}
        </Button>
      )}
      <Modal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title={t('followup.reschedule')}
        size="sm"
        footer={
          <Button loading={reschedule.isPending} disabled={!newDue} onClick={() => reschedule.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        <DatePicker label={t('followup.newTime')} value={newDue} onChange={(e) => setNewDue(e.target.value)} required />
      </Modal>
      <Drawer open={notesOpen} onClose={() => setNotesOpen(false)} title={[t('note.title'), t(`enums.followUpType.${f.type}`), client?.fullName].filter(Boolean).join(' · ')}>
        <NotesPanel entityType="followUp" entityId={f._id} />
      </Drawer>
      <Modal
        open={outcomeOpen}
        onClose={() => setOutcomeOpen(false)}
        title={t('followup.complete')}
        size="sm"
        footer={
          <Button loading={complete.isPending} onClick={() => complete.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        <Textarea label={t('followup.outcome')} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </Modal>
    </li>
  );
}

export function FollowUpsPanel({ clientId, propertyId }: { clientId?: string; propertyId?: string }) {
  const { t } = useTranslation();
  const canCreate = useCan(PERMISSIONS.FOLLOWUPS_CREATE);
  const [formOpen, setFormOpen] = useState(false);
  const q = useQuery({ queryKey: ['followups', { clientId, propertyId }], queryFn: () => followUpApi.list({ clientId, propertyId, limit: 100 }) });
  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
            {t('followup.add')}
          </Button>
        </div>
      )}
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <EmptyState title={t('followup.noFollowUps')} />
      ) : (
        <ul className="divide-y divide-line">{q.data!.items.map((f) => <FollowUpItem key={f._id} f={f} showClient={!clientId} />)}</ul>
      )}
      {formOpen && <FollowUpForm open onClose={() => setFormOpen(false)} clientId={clientId} propertyId={propertyId} />}
    </div>
  );
}


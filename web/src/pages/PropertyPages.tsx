import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarPlus, Crosshair, MessageCircle, ExternalLink, LayoutGrid, MapPin, Pencil, Plus, RefreshCw, Rows3, Share2, Star, Trash2, Upload, Video } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LISTING_PURPOSES, PERMISSIONS, PROPERTY_STATUS_TRANSITIONS, PROPERTY_STATUSES, PROPERTY_TYPES, SIZE_UNITS, type PropertyStatus } from '@recrm/shared';
import { ownerApi, propertyApi } from '@/api/endpoints';
import type { FileAsset, Property } from '@/api/types';
import { MatchCard, PropertyCard, PropertyStatusBadge, locationLabel, useSizeLabel, usePropertyShareText, VerificationBadge } from '@/components/domain';
import { ActivityPanel, DocumentsPanel, FollowUpForm, FollowUpsPanel, NotesPanel } from '@/components/domain/panels';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Tabs, Textarea, type Column } from '@/components/ui';
import { formatDate, formatPkr, waHref } from '@/lib/format';
import { useDebounce, useEnumOptions, useOnError, useUrlState } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const ownerOf = (p: Property) => (typeof p.ownerId === 'object' ? p.ownerId : undefined);
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** Accepts "24.92, 67.09" or a Google Maps URL containing @lat,lng or q=lat,lng. */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(decodeURIComponent(input));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/* ───────────── Form ───────────── */

export function PropertyFormDrawer({ open, onClose, property }: { open: boolean; onClose(): void; property?: Property }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const defaultUnit = useAuth((s) => s.business?.defaultSizeUnit ?? 'SQ_YARD');
  const types = useEnumOptions('propertyType', PROPERTY_TYPES);
  const purposes = useEnumOptions('listingPurpose', LISTING_PURPOSES);
  const units = useEnumOptions('sizeUnit', SIZE_UNITS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ownerSearch, setOwnerSearch] = useState('');
  const owners = useQuery({ queryKey: ['owners', 'pick', useDebounce(ownerSearch, 250)], queryFn: () => ownerApi.list({ q: ownerSearch, limit: 30 }), enabled: open });
  const [form, setForm] = useState({
    propertyType: property?.propertyType ?? 'RESIDENTIAL_PLOT',
    listingPurpose: property?.listingPurpose ?? 'SALE',
    title: property?.title ?? '',
    area: property?.area ?? '',
    society: property?.society ?? '',
    block: property?.block ?? '',
    street: property?.street ?? '',
    plotNumber: property?.plotNumber ?? '',
    city: property?.city ?? 'Karachi',
    size: property?.size?.toString() ?? '',
    sizeUnit: property?.sizeUnit ?? defaultUnit,
    askingPrice: property?.askingPrice?.toString() ?? '',
    expectedFinalPrice: property?.expectedFinalPrice?.toString() ?? '',
    minimumPrice: property?.minimumPrice?.toString() ?? '',
    ownerId: ownerOf(property ?? ({} as Property))?._id ?? (typeof property?.ownerId === 'string' ? property.ownerId : ''),
    description: property?.description ?? '',
    latitude: property?.latitude?.toString() ?? '',
    longitude: property?.longitude?.toString() ?? '',
    bedrooms: property?.bedrooms?.toString() ?? '',
    bathrooms: property?.bathrooms?.toString() ?? '',
    floors: property?.floors?.toString() ?? '',
  });
  const [negotiable, setNegotiable] = useState(property?.negotiable ?? true);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const residential = ['HOUSE', 'FLAT', 'APARTMENT', 'PORTION'].includes(form.propertyType);

  const pasteLocation = (value: string) => {
    const c = parseCoordinates(value);
    if (c) setForm((f) => ({ ...f, latitude: String(c.lat), longitude: String(c.lng) }));
  };
  const useMyLocation = () =>
    navigator.geolocation?.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) })),
      () => toast.error(t('common.somethingWrong')),
      { enableHighAccuracy: true, timeout: 10_000 },
    );

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        propertyType: form.propertyType,
        listingPurpose: form.listingPurpose,
        size: num(form.size),
        sizeUnit: form.sizeUnit,
        askingPrice: num(form.askingPrice),
        negotiable,
      };
      for (const k of ['title', 'area', 'society', 'block', 'street', 'plotNumber', 'city', 'description'] as const) body[k] = form[k] || undefined;
      for (const k of ['expectedFinalPrice', 'minimumPrice', 'bedrooms', 'bathrooms', 'floors'] as const) body[k] = num(form[k]);
      const lat = num(form.latitude);
      const lng = num(form.longitude);
      if (lat !== undefined && lng !== undefined) Object.assign(body, { latitude: lat, longitude: lng });
      else if (property?.latitude !== undefined) Object.assign(body, { latitude: null, longitude: null });
      body.ownerId = form.ownerId || (property ? null : undefined);
      return property ? propertyApi.update(property._id, { ...body, baseVersion: property.version }) : propertyApi.create(body);
    },
    onSuccess: (saved) => {
      toast.success(property ? t('property.updated') : t('property.created'));
      void qc.invalidateQueries({ queryKey: ['properties'] });
      void qc.invalidateQueries({ queryKey: ['property', saved._id] });
      onClose();
      if (!property) navigate(`/properties/${saved._id}`);
    },
    onError: (e) => setErrors(onError(e)),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={property ? `${t('property.edit')} · ${property.propertyId}` : t('property.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('property.type')} options={types} value={form.propertyType} onChange={set('propertyType')} />
          <Select label={t('property.purpose')} options={purposes} value={form.listingPurpose} onChange={set('listingPurpose')} />
          <Input label={t('property.titleField')} value={form.title} onChange={set('title')} wrapperClassName="sm:col-span-2" />
          <Input label={t('property.society')} value={form.society} onChange={set('society')} placeholder="Gulshan-e-Iqbal" />
          <Input label={t('property.area')} value={form.area} onChange={set('area')} />
          <Input label={t('property.block')} value={form.block} onChange={set('block')} placeholder="13-D" />
          <Input label={t('property.plotNumber')} value={form.plotNumber} onChange={set('plotNumber')} />
          <Input label={t('property.street')} value={form.street} onChange={set('street')} />
          <Input label={t('property.city')} value={form.city} onChange={set('city')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={t('property.size')} type="number" min={0} step="any" required value={form.size} onChange={set('size')} error={errors.size} />
          <Select label={t('property.sizeUnit')} options={units} value={form.sizeUnit} onChange={set('sizeUnit')} />
          <div />
          <Input label={t('property.askingPrice')} type="number" min={0} step={1000} required value={form.askingPrice} onChange={set('askingPrice')} error={errors.askingPrice} hint={formatPkr(num(form.askingPrice))} />
          <Input label={t('property.minimumPrice')} type="number" min={0} step={1000} value={form.minimumPrice} onChange={set('minimumPrice')} error={errors.minimumPrice} hint={form.minimumPrice ? formatPkr(num(form.minimumPrice)) : undefined} />
          <Input label={t('property.expectedFinalPrice')} type="number" min={0} step={1000} value={form.expectedFinalPrice} onChange={set('expectedFinalPrice')} />
        </div>
        <Checkbox label={t('property.negotiable')} checked={negotiable} onChange={setNegotiable} />
        {residential && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={t('property.bedrooms')} type="number" min={0} value={form.bedrooms} onChange={set('bedrooms')} />
            <Input label={t('property.bathrooms')} type="number" min={0} value={form.bathrooms} onChange={set('bathrooms')} />
            <Input label={t('property.floors')} type="number" min={0} value={form.floors} onChange={set('floors')} />
          </div>
        )}
        <div className="space-y-2 rounded-lg border border-line p-3">
          <p className="flex items-center gap-1 text-sm font-medium">
            <MapPin className="h-4 w-4" /> {t('property.location')}
          </p>
          <Input placeholder={t('property.pickOnMap')} onChange={(e) => pasteLocation(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={t('property.latitude')} type="number" step="any" value={form.latitude} onChange={set('latitude')} />
            <Input label={t('property.longitude')} type="number" step="any" value={form.longitude} onChange={set('longitude')} />
            <div className="flex items-end">
              <Button variant="secondary" icon={<Crosshair className="h-4 w-4" />} onClick={useMyLocation}>
                {t('property.useMyLocation')}
              </Button>
            </div>
          </div>
          {form.latitude && form.longitude && <MapPreview lat={Number(form.latitude)} lng={Number(form.longitude)} height={180} />}
        </div>
        <div>
          <Input label={t('property.owner')} placeholder={t('owner.searchPlaceholder')} value={ownerSearch} onChange={(e) => setOwnerSearch(e.target.value)} />
          <Select
            wrapperClassName="mt-2"
            placeholder={t('property.noOwner')}
            options={[
              ...(owners.data?.items ?? []).map((o) => ({ value: o._id, label: `${o.fullName} — ${o.mobileNumber}` })),
              ...(property && ownerOf(property) && !owners.data?.items.some((o) => o._id === ownerOf(property)!._id)
                ? [{ value: ownerOf(property)!._id, label: ownerOf(property)!.fullName }]
                : []),
            ]}
            value={form.ownerId}
            onChange={set('ownerId')}
          />
        </div>
        <Textarea label={t('common.description')} rows={4} value={form.description} onChange={set('description')} />
      </form>
    </Drawer>
  );
}

/** Keyless Google Maps embed. Mobile uses the native Google Maps SDK. */
export function MapPreview({ lat, lng, height = 240 }: { lat: number; lng: number; height?: number }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return (
    <iframe
      title="map"
      className="w-full rounded-lg border border-line"
      style={{ height }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      src={`https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`}
    />
  );
}

/* ───────────── List ───────────── */

export function PropertiesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const size = useSizeLabel();
  const canCreate = useCan(PERMISSIONS.PROPERTIES_CREATE);
  const [filters, setFilters] = useUrlState({
    q: '', propertyType: '', status: '', listingPurpose: '', area: '', society: '', block: '', minPrice: '', maxPrice: '', minSize: '', maxSize: '', sizeUnit: 'SQ_YARD', ownerId: '', verification: '', sort: '-updatedAt', page: '1', view: 'grid',
  });
  const [formOpen, setFormOpen] = useState(false);
  const q = useDebounce(filters.q, 300);
  const society = useDebounce(filters.society, 300);
  const area = useDebounce(filters.area, 300);
  const page = Number(filters.page);
  const hasSize = filters.minSize || filters.maxSize;
  const params = { ...filters, q, area, society, page, limit: filters.view === 'grid' ? 24 : 20, view: undefined, sizeUnit: hasSize ? filters.sizeUnit : undefined };
  const query = useQuery({ queryKey: ['properties', params], queryFn: () => propertyApi.list(params), placeholderData: (prev) => prev });
  const types = useEnumOptions('propertyType', PROPERTY_TYPES);
  const statuses = useEnumOptions('propertyStatus', PROPERTY_STATUSES);
  const purposes = useEnumOptions('listingPurpose', LISTING_PURPOSES);
  const units = useEnumOptions('sizeUnit', SIZE_UNITS);
  const ownerOptions = useQuery({ queryKey: ['owners', 'filter'], queryFn: () => ownerApi.list({ sort: 'fullName', limit: 100 }), staleTime: 60_000 });
  const f = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ [k]: e.target.value, page: '1' } as never);

  const columns: Column<Property>[] = [
    { key: 'id', header: t('property.id'), render: (p) => <span className="ltr-nums font-medium text-brand-600">{p.propertyId}</span> },
    { key: 'type', header: t('property.type'), render: (p) => `${t(`enums.propertyType.${p.propertyType}`)} · ${t(`enums.listingPurpose.${p.listingPurpose}`)}` },
    { key: 'location', header: t('property.location'), render: (p) => locationLabel(p) },
    { key: 'size', header: t('property.size'), render: (p) => size(p.size, p.sizeUnit) },
    { key: 'price', header: t('property.askingPrice'), render: (p) => formatPkr(p.askingPrice) },
    { key: 'owner', header: t('property.owner'), render: (p) => ownerOf(p)?.fullName ?? '—' },
    { key: 'status', header: t('common.status'), render: (p) => <PropertyStatusBadge status={p.status} /> },
    { key: 'matches', header: t('nav.matches'), render: (p) => <span className="ltr-nums">{p.matchCount}</span> },
  ];
  const empty = <EmptyState title={t('property.noProperties')} hint={t('property.noPropertiesHint')} action={canCreate && <Button onClick={() => setFormOpen(true)}>{t('property.add')}</Button>} />;

  return (
    <div>
      <PageHeader
        title={t('property.title')}
        actions={
          <>
            <div className="flex rounded-lg border border-line">
              <button className={`btn-ghost !rounded-e-none ${filters.view === 'table' ? 'bg-canvas text-ink' : ''}`} onClick={() => setFilters({ view: 'table', page: '1' })} title={t('property.tableView')}>
                <Rows3 className="h-4 w-4" />
              </button>
              <button className={`btn-ghost !rounded-s-none ${filters.view === 'grid' ? 'bg-canvas text-ink' : ''}`} onClick={() => setFilters({ view: 'grid', page: '1' })} title={t('property.gridView')}>
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                {t('property.add')}
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4" bodyClassName="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Input wrapperClassName="md:col-span-2" placeholder={t('property.searchPlaceholder')} value={filters.q} onChange={f('q')} aria-label={t('common.search')} />
        <Select options={types} placeholder={`${t('common.type')}: ${t('common.all')}`} value={filters.propertyType} onChange={f('propertyType')} />
        <Select options={statuses} placeholder={`${t('common.status')}: ${t('common.all')}`} value={filters.status} onChange={f('status')} />
        <Select options={purposes} placeholder={`${t('property.purpose')}: ${t('common.all')}`} value={filters.listingPurpose} onChange={f('listingPurpose')} />
        <Input placeholder={t('property.area')} value={filters.area} onChange={f('area')} />
        <Input placeholder={t('property.society')} value={filters.society} onChange={f('society')} />
        <Input placeholder={t('property.block')} value={filters.block} onChange={f('block')} />
        <Input type="number" placeholder={t('property.minPrice')} value={filters.minPrice} onChange={f('minPrice')} />
        <Input type="number" placeholder={t('property.maxPrice')} value={filters.maxPrice} onChange={f('maxPrice')} />
        <Input type="number" placeholder={t('client.minSize')} value={filters.minSize} onChange={f('minSize')} />
        <Input type="number" placeholder={t('client.maxSize')} value={filters.maxSize} onChange={f('maxSize')} />
        <Select options={units} value={filters.sizeUnit} onChange={f('sizeUnit')} aria-label={t('property.sizeUnit')} />
        <Select
          options={[
            { value: 'stale', label: t('property.needsVerification') },
            { value: 'fresh', label: t('property.recentlyVerified') },
          ]}
          placeholder={`${t('property.verification')}: ${t('common.all')}`}
          value={filters.verification}
          onChange={f('verification')}
          aria-label={t('property.verification')}
        />
        <Select
          options={(ownerOptions.data?.items ?? []).map((o) => ({ value: o._id, label: o.fullName }))}
          placeholder={`${t('property.owner')}: ${t('common.all')}`}
          value={filters.ownerId}
          onChange={f('ownerId')}
          aria-label={t('property.owner')}
        />
        <Select
          options={[
            { value: '-updatedAt', label: t('common.updatedAt') },
            { value: '-createdAt', label: t('common.createdAt') },
            { value: 'askingPrice', label: `${t('property.askingPrice')} ↑` },
            { value: '-askingPrice', label: `${t('property.askingPrice')} ↓` },
            { value: '-sizeSqft', label: `${t('property.size')} ↓` },
            { value: '-matchCount', label: t('nav.matches') },
            { value: 'propertyId', label: t('property.id') },
          ]}
          value={filters.sort}
          onChange={f('sort')}
          aria-label={t('common.sortBy')}
        />
      </Card>

      {filters.view === 'grid' ? (
        query.isLoading ? (
          <PageLoader />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : !query.data!.items.length ? (
          empty
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{query.data!.items.map((p) => <PropertyCard key={p._id} property={p} />)}</div>
            <Pagination page={page} totalPages={query.data!.meta.totalPages} total={query.data!.meta.total} limit={24} onChange={(p) => setFilters({ page: String(p) })} />
          </>
        )
      ) : (
        <Card bodyClassName="!p-0">
          <DataTable columns={columns} query={query} page={page} onPage={(p) => setFilters({ page: String(p) })} onRowClick={(p) => navigate(`/properties/${p._id}`)} empty={empty} />
        </Card>
      )}
      {formOpen && <PropertyFormDrawer open onClose={() => setFormOpen(false)} />}
    </div>
  );
}

/* ───────────── Media gallery ───────────── */

function MediaGallery({ property }: { property: Property }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canEdit = useCan(PERMISSIONS.PROPERTIES_UPDATE);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<File[]>([]);
  const [viewing, setViewing] = useState<FileAsset | null>(null);
  const key = ['media', property._id];
  const q = useQuery({ queryKey: key, queryFn: () => propertyApi.media(property._id) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['property', property._id] });
    void qc.invalidateQueries({ queryKey: ['properties'] });
  };

  async function upload(files: File[]) {
    if (!files.length) return;
    setProgress(0);
    try {
      await propertyApi.uploadMedia(property._id, files, setProgress);
      setFailed([]);
      toast.success(t('common.changesSaved'));
    } catch (e) {
      setFailed(files);
      onError(e);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
      refresh();
    }
  }

  const action = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => void upload(Array.from(e.target.files ?? []))} />
          <Button icon={<Upload className="h-4 w-4" />} loading={progress !== null} onClick={() => input.current?.click()}>
            {progress !== null ? t('property.uploading', { percent: progress }) : t('property.uploadMedia')}
          </Button>
          {failed.length > 0 && progress === null && (
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void upload(failed)}>
              {t('common.retry')} ({failed.length})
            </Button>
          )}
        </div>
      )}
      {q.isLoading ? (
        <PageLoader />
      ) : !q.data?.length ? (
        <EmptyState title={t('property.noMedia')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {q.data.map((m) => (
            <div key={m._id} className="group relative overflow-hidden rounded-lg border border-line">
              <button className="block aspect-[4/3] w-full bg-canvas" onClick={() => setViewing(m)}>
                {m.kind === 'image' ? (
                  <img src={m.thumbnailUrl ?? m.fileUrl} alt={m.fileName} loading="lazy" className="h-full w-full object-cover" />
                ) : m.thumbnailUrl ? (
                  <img src={m.thumbnailUrl} alt={m.fileName} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-muted">
                    <Video className="h-8 w-8" />
                  </span>
                )}
              </button>
              {property.coverImageUrl === m.fileUrl && (
                <span className="absolute start-2 top-2">
                  <Badge color="amber">
                    <Star className="h-3 w-3" /> {t('property.cover')}
                  </Badge>
                </span>
              )}
              {canEdit && (
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 p-2 opacity-0 transition group-hover:opacity-100">
                  {m.kind === 'image' && property.coverImageUrl !== m.fileUrl && (
                    <button className="rounded bg-white/90 p-1 text-slate-800" title={t('property.setCover')} onClick={() => void action(() => propertyApi.updateMedia(m._id, { setCover: true }))}>
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button className="rounded bg-white/90 p-1 text-red-600" title={t('common.delete')} onClick={() => void action(() => propertyApi.removeMedia(m._id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.fileName ?? ''} size="lg">
        {viewing?.kind === 'video' ? (
          <video src={viewing.fileUrl} controls className="max-h-[70vh] w-full" />
        ) : (
          viewing && <img src={viewing.fileUrl} alt={viewing.fileName} className="max-h-[70vh] w-full object-contain" />
        )}
      </Modal>
    </div>
  );
}

/* ───────────── Detail ───────────── */

type PropTab = 'overview' | 'media' | 'matches' | 'followups' | 'documents' | 'notes' | 'activity';

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || children === 0 ? children : '—'}</dd>
    </div>
  );
}

export function PropertyDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const size = useSizeLabel();
  const canEdit = useCan(PERMISSIONS.PROPERTIES_UPDATE);
  const canDelete = useCan(PERMISSIONS.PROPERTIES_DELETE);
  const [tab, setTab] = useState<PropTab>('overview');
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<PropertyStatus>('RESERVED');
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyNote, setVerifyNote] = useState('');
  const shareText = usePropertyShareText();
  const q = useQuery({ queryKey: ['property', id], queryFn: () => propertyApi.get(id) });
  const verify = useMutation({
    mutationFn: () => propertyApi.verify(id, verifyNote.trim() || undefined),
    onSuccess: () => {
      toast.success(t('property.verified'));
      setVerifying(false);
      setVerifyNote('');
      for (const k of [['property', id], ['properties'], ['activities', id], ['dashboard']]) void qc.invalidateQueries({ queryKey: k });
    },
    onError,
  });
  const matches = useQuery({ queryKey: ['matches', 'property', id], queryFn: () => propertyApi.matches(id, { limit: 50 }), enabled: tab === 'matches' || tab === 'overview' });
  const statusMut = useMutation({
    mutationFn: () => propertyApi.setStatus(id, nextStatus, reason || undefined),
    onSuccess: () => {
      toast.success(t('property.statusChanged'));
      setStatusOpen(false);
      setReason('');
      for (const k of [['property', id], ['properties'], ['matches'], ['activities', id], ['dashboard']]) void qc.invalidateQueries({ queryKey: k });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => propertyApi.remove(id),
    onSuccess: () => {
      toast.success(t('property.deletedMsg'));
      void qc.invalidateQueries({ queryKey: ['properties'] });
      navigate('/properties');
    },
    onError,
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const owner = ownerOf(p);
  const transitions = PROPERTY_STATUS_TRANSITIONS[p.status];

  const shareWhatsApp = () => window.open(waHref(undefined, shareText(p)), '_blank', 'noopener');
  const share = async () => {
    const url = p.googleMapsUrl ?? (p.latitude ? `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}` : '');
    const text = `${p.propertyId} · ${size(p.size, p.sizeUnit)} ${t(`enums.propertyType.${p.propertyType}`)} · ${locationLabel(p)} · ${formatPkr(p.askingPrice)}`;
    try {
      if (navigator.share) await navigator.share({ title: p.propertyId, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast.success(t('common.copied'));
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="ltr-nums">{p.propertyId}</span>
            <PropertyStatusBadge status={p.status} />
            <VerificationBadge property={p} showFresh />
          </span>
        }
        subtitle={`${size(p.size, p.sizeUnit)} ${t(`enums.propertyType.${p.propertyType}`)} · ${locationLabel(p)} · ${formatPkr(p.askingPrice)}`}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" onClick={() => (setNextStatus(transitions[0]), setStatusOpen(true))}>
                {t('property.changeStatus')}
              </Button>
            )}
            <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setFollowUp(true)}>
              {t('followup.single')}
            </Button>
            {canEdit && (
              <Button variant="secondary" icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setVerifying(true)}>
                {t('property.verify')}
              </Button>
            )}
            <Button variant="secondary" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />} onClick={shareWhatsApp}>
              WhatsApp
            </Button>
            <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={() => void share()}>
              {t('common.share')}
            </Button>
            {canEdit && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={t('common.delete')}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            )}
          </>
        }
      />
      <Tabs<PropTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: t('property.tabs.overview') },
          { value: 'media', label: t('property.tabs.media') },
          { value: 'matches', label: t('property.tabs.matches'), count: p.matchCount },
          { value: 'followups', label: t('property.tabs.followups') },
          { value: 'documents', label: t('property.tabs.documents') },
          { value: 'notes', label: t('property.tabs.notes') },
          { value: 'activity', label: t('property.tabs.activity') },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {p.coverImageUrl && <img src={p.coverImageUrl} alt="" className="max-h-80 w-full rounded-xl object-cover" />}
            <Card title={t('common.details')}>
              <dl className="grid gap-3 sm:grid-cols-3">
                <Info label={t('property.purpose')}>{t(`enums.listingPurpose.${p.listingPurpose}`)}</Info>
                <Info label={t('property.society')}>{p.society}</Info>
                <Info label={t('property.area')}>{p.area}</Info>
                <Info label={t('property.block')}>{p.block}</Info>
                <Info label={t('property.plotNumber')}>{p.plotNumber}</Info>
                <Info label={t('property.street')}>{p.street}</Info>
                <Info label={t('property.size')}>{size(p.size, p.sizeUnit)}</Info>
                <Info label={t('property.askingPrice')}>{formatPkr(p.askingPrice)}</Info>
                <Info label={t('property.minimumPrice')}>{p.minimumPrice ? formatPkr(p.minimumPrice) : ''}</Info>
                <Info label={t('property.expectedFinalPrice')}>{p.expectedFinalPrice ? formatPkr(p.expectedFinalPrice) : ''}</Info>
                <Info label={t('property.negotiable')}>{p.negotiable ? t('common.yes') : t('common.no')}</Info>
                <Info label={t('property.bedrooms')}>{p.bedrooms}</Info>
                <Info label={t('property.bathrooms')}>{p.bathrooms}</Info>
                <Info label={t('property.floors')}>{p.floors}</Info>
                <Info label={t('common.createdAt')}>{formatDate(p.createdAt)}</Info>
              </dl>
              {p.description && <p className="mt-4 whitespace-pre-wrap text-sm">{p.description}</p>}
            </Card>
            <Card title={t('property.matches', { count: p.matchCount })}>
              {matches.data?.items.length ? (
                <div className="space-y-2">{matches.data.items.slice(0, 5).map((m) => <MatchCard key={m._id} match={m} perspective="property" />)}</div>
              ) : (
                <p className="text-sm text-muted">{t('match.noMatches')}</p>
              )}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title={t('property.owner')}>
              {owner ? (
                <div className="space-y-1">
                  <Link to={`/owners/${owner._id}`} className="font-medium hover:underline">
                    {owner.fullName}
                  </Link>
                  <p className="ltr-nums text-sm text-muted">{owner.mobileNumber}</p>
                </div>
              ) : (
                <p className="text-sm text-muted">{t('property.noOwner')}</p>
              )}
            </Card>
            <Card
              title={t('property.location')}
              actions={
                p.googleMapsUrl && (
                  <a href={p.googleMapsUrl} target="_blank" rel="noreferrer" className="btn-ghost !p-1 text-xs">
                    <ExternalLink className="h-4 w-4" /> {t('common.openInMaps')}
                  </a>
                )
              }
            >
              {p.latitude !== undefined && p.longitude !== undefined ? <MapPreview lat={p.latitude} lng={p.longitude} /> : <p className="text-sm text-muted">—</p>}
            </Card>
          </div>
        </div>
      )}
      {tab === 'media' && (
        <Card>
          <MediaGallery property={p} />
        </Card>
      )}
      {tab === 'matches' &&
        (matches.isLoading ? (
          <PageLoader />
        ) : !matches.data?.items.length ? (
          <EmptyState title={t('match.noMatches')} hint={t('match.noMatchesHint')} />
        ) : (
          <div className="space-y-2">{matches.data.items.map((m) => <MatchCard key={m._id} match={m} perspective="property" />)}</div>
        ))}
      {tab === 'followups' && <FollowUpsPanel propertyId={id} />}
      {tab === 'documents' && <Card><DocumentsPanel entityType="property" entityId={id} /></Card>}
      {tab === 'notes' && <Card><NotesPanel entityType="property" entityId={id} /></Card>}
      {tab === 'activity' && <Card><ActivityPanel entityId={id} /></Card>}

      {editing && <PropertyFormDrawer open property={p} onClose={() => setEditing(false)} />}
      {followUp && <FollowUpForm open onClose={() => setFollowUp(false)} propertyId={id} />}
      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={t('property.changeStatus')}
        size="sm"
        footer={
          <Button loading={statusMut.isPending} onClick={() => statusMut.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        <div className="space-y-3">
          <Select label={t('common.status')} options={transitions.map((s) => ({ value: s, label: t(`enums.propertyStatus.${s}`) }))} value={nextStatus} onChange={(e) => setNextStatus(e.target.value as PropertyStatus)} />
          <Input label={t('property.statusReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
      <Modal
        open={verifying}
        onClose={() => setVerifying(false)}
        title={t('property.verify')}
        size="sm"
        footer={
          <Button loading={verify.isPending} icon={<BadgeCheck className="h-4 w-4" />} onClick={() => verify.mutate()}>
            {t('property.verify')}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-muted">{t('property.verifyHint')}</p>
        <Input label={t('property.verifyNote')} value={verifyNote} maxLength={300} onChange={(e) => setVerifyNote(e.target.value)} />
      </Modal>
      <ConfirmDialog open={confirmDelete} title={t('common.areYouSure')} message={t('property.deleteConfirm', { id: p.propertyId })} loading={remove.isPending} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />
    </div>
  );
}

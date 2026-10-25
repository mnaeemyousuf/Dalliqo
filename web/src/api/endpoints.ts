import type { AxiosProgressEvent } from 'axios';
import { api, apiPage, clean, http, toApiError } from './client';
import type {
  Activity,
  Analytics,
  AppNotification,
  AuditEntry,
  Business,
  Category,
  Client,
  DashboardSummary,
  DeviceSession,
  FileAsset,
  FollowUp,
  Match,
  Member,
  MyDay,
  Note,
  Owner,
  Property,
  Session,
  Settings,
  User,
} from './types';

type Params = Record<string, unknown>;
type Body = Record<string, unknown>;

export const authApi = {
  login: (email: string, password: string) =>
    api<Session & { accessToken: string }>({ method: 'POST', url: '/auth/login', data: { email, password, deviceName: 'Web browser' } }),
  register: (body: Body) => api<Session & { accessToken: string }>({ method: 'POST', url: '/auth/register', data: { ...body, deviceName: 'Web browser' } }),
  me: () => api<Session>({ url: '/auth/me' }),
  logout: () => api<null>({ method: 'POST', url: '/auth/logout', data: {} }),
  logoutAll: () => api<null>({ method: 'POST', url: '/auth/logout-all' }),
  forgot: (email: string) => api<null>({ method: 'POST', url: '/auth/forgot-password', data: { email } }),
  reset: (token: string, newPassword: string) => api<null>({ method: 'POST', url: '/auth/reset-password', data: { token, newPassword } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<null>({ method: 'POST', url: '/auth/change-password', data: { currentPassword, newPassword } }),
  updateProfile: (body: Body) => api<User>({ method: 'PATCH', url: '/auth/me', data: body }),
  sessions: () => api<DeviceSession[]>({ url: '/auth/sessions' }),
  revokeSession: (id: string) => api<null>({ method: 'DELETE', url: `/auth/sessions/${id}` }),
};

export const businessApi = {
  get: () => api<Business>({ url: '/business' }),
  update: (body: Body) => api<Business>({ method: 'PATCH', url: '/business', data: body }),
};

export const memberApi = {
  list: (params?: Params) => apiPage<Member>('/members', { limit: 100, ...params }),
  create: (body: Body) => api<Member>({ method: 'POST', url: '/members', data: body }),
  update: (id: string, body: Body) => api<Member>({ method: 'PATCH', url: `/members/${id}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/members/${id}` }),
  resetPassword: (id: string, temporaryPassword: string) => api<null>({ method: 'POST', url: `/members/${id}/reset-password`, data: { temporaryPassword } }),
};

export const categoryApi = {
  list: (includeArchived = false) => api<Category[]>({ url: '/client-categories', params: includeArchived ? { includeArchived: true } : undefined }),
  create: (body: Body) => api<Category>({ method: 'POST', url: '/client-categories', data: body }),
  update: (id: string, body: Body) => api<Category>({ method: 'PATCH', url: `/client-categories/${id}`, data: body }),
};

export const clientApi = {
  list: (params: Params) => apiPage<Client>('/clients', params),
  get: (id: string) => api<Client>({ url: `/clients/${id}` }),
  create: (body: Body) => api<Client>({ method: 'POST', url: '/clients', data: body }),
  update: (id: string, body: Body) => api<Client>({ method: 'PATCH', url: `/clients/${id}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/clients/${id}` }),
  communicate: (id: string, channel: string, note?: string) => api<Client>({ method: 'POST', url: `/clients/${id}/communications`, data: clean({ channel, note }) }),
  matches: (id: string, params?: Params) => apiPage<Match>(`/clients/${id}/matches`, params),
};

export const ownerApi = {
  list: (params: Params) => apiPage<Owner>('/owners', params),
  get: (id: string) => api<Owner>({ url: `/owners/${id}` }),
  create: (body: Body) => api<Owner>({ method: 'POST', url: '/owners', data: body }),
  update: (id: string, body: Body) => api<Owner>({ method: 'PATCH', url: `/owners/${id}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/owners/${id}` }),
};

export const propertyApi = {
  list: (params: Params) => apiPage<Property>('/properties', params),
  get: (id: string) => api<Property>({ url: `/properties/${id}` }),
  create: (body: Body) => api<Property>({ method: 'POST', url: '/properties', data: body }),
  update: (id: string, body: Body) => api<Property>({ method: 'PATCH', url: `/properties/${id}`, data: body }),
  setStatus: (id: string, status: string, reason?: string) => api<Property>({ method: 'POST', url: `/properties/${id}/status`, data: clean({ status, reason }) }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/properties/${id}` }),
  verify: (id: string, note?: string) => api<Property>({ method: 'POST', url: `/properties/${id}/verify`, data: clean({ note }) }),
  matches: (id: string, params?: Params) => apiPage<Match>(`/properties/${id}/matches`, params),
  media: (id: string) => api<FileAsset[]>({ url: `/properties/${id}/media` }),
  async uploadMedia(id: string, files: File[], onProgress?: (percent: number) => void) {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    try {
      const r = await http.post<{ data: FileAsset[] }>(`/properties/${id}/media`, form, {
        timeout: 10 * 60_000,
        onUploadProgress: (e: AxiosProgressEvent) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
      return r.data.data;
    } catch (e) {
      throw toApiError(e);
    }
  },
  updateMedia: (id: string, body: Body) => api<FileAsset>({ method: 'PATCH', url: `/media/${id}`, data: body }),
  removeMedia: (id: string) => api<null>({ method: 'DELETE', url: `/media/${id}` }),
};

export const documentApi = {
  list: (params: Params) => apiPage<FileAsset>('/documents', params),
  async upload(fields: { entityType: string; entityId: string; category: string; fileName?: string }, file: File, onProgress?: (p: number) => void) {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => v && form.append(k, v));
    form.append('file', file);
    try {
      const r = await http.post<{ data: FileAsset }>('/documents', form, {
        timeout: 10 * 60_000,
        onUploadProgress: (e: AxiosProgressEvent) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
      return r.data.data;
    } catch (e) {
      throw toApiError(e);
    }
  },
  downloadUrl: (id: string) => api<{ url: string; expiresAt: string; fileName: string }>({ url: `/documents/${id}/download` }),
  update: (id: string, body: Body) => api<FileAsset>({ method: 'PATCH', url: `/documents/${id}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/documents/${id}` }),
};

export const noteApi = {
  list: (entityType: string, entityId: string) => apiPage<Note>('/notes', { entityType, entityId, limit: 100 }),
  create: (entityType: string, entityId: string, content: string) => api<Note>({ method: 'POST', url: '/notes', data: { entityType, entityId, content } }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/notes/${id}` }),
};

export const activityApi = {
  list: (params: Params) => apiPage<Activity>('/activities', params),
};

export const matchApi = {
  list: (params: Params) => apiPage<Match>('/matches', params),
  setStatus: (id: string, status: string) => api<Match>({ method: 'PATCH', url: `/matches/${id}`, data: { status } }),
  recalculate: () => api<{ properties: number; matches: number }>({ method: 'POST', url: '/matches/recalculate', data: {} }),
};

export const followUpApi = {
  list: (params: Params) => apiPage<FollowUp>('/followups', params),
  create: (body: Body) => api<FollowUp>({ method: 'POST', url: '/followups', data: body }),
  update: (id: string, body: Body) => api<FollowUp>({ method: 'PATCH', url: `/followups/${id}`, data: body }),
  complete: (id: string, outcome?: string) => api<FollowUp>({ method: 'POST', url: `/followups/${id}/complete`, data: clean({ outcome }) }),
};

export const notificationApi = {
  list: (params: Params) => apiPage<AppNotification>('/notifications', params),
  read: (id: string) => api<AppNotification>({ method: 'POST', url: `/notifications/${id}/read` }),
  readAll: (category?: string) => api<{ updated: number }>({ method: 'POST', url: '/notifications/read-all', data: clean({ category }) }),
};

export const dashboardApi = {
  summary: () => api<DashboardSummary>({ url: '/dashboard' }),
  analytics: (range: string) => api<Analytics>({ url: '/dashboard/analytics', params: { range } }),
  myDay: (scope: 'mine' | 'all') => api<MyDay>({ url: '/my-day', params: { scope } }),
  search: (q: string) => api<{ clients: Client[]; properties: Property[]; owners: Owner[]; matches: Match[] }>({ url: '/search', params: { q } }),
};

export const settingsApi = {
  get: () => api<Settings>({ url: '/settings' }),
  update: (body: Body) => api<Settings>({ method: 'PATCH', url: '/settings', data: body }),
};

export const auditApi = {
  list: (params: Params) => apiPage<AuditEntry>('/audit-logs', params),
};

export const exportApi = {
  /** Downloads a generated file through the authenticated client and saves it. */
  async download(resource: string, format: 'xlsx' | 'pdf', filters: Params) {
    try {
      const r = await http.get<Blob>(`/exports/${resource}`, { params: clean({ ...filters, format }), responseType: 'blob', timeout: 5 * 60_000 });
      const name = /filename="([^"]+)"/.exec(String(r.headers['content-disposition']))?.[1] ?? `${resource}.${format}`;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      // Error bodies arrive as Blobs when responseType is blob.
      const data = (e as { response?: { data?: Blob } }).response?.data;
      if (data instanceof Blob) {
        const body = JSON.parse(await data.text()) as { code?: string; message?: string };
        throw toApiError({ isAxiosError: true, response: { status: 400, data: body }, message: body.message });
      }
      throw toApiError(e);
    }
  },
};

import type { AxiosProgressEvent } from 'axios';
import { api, apiPage, clean, http, toApiError } from './client';
import type {
  Activity,
  Analytics,
  AppNotification,
  AuditEntry,
  Branch,
  Business,
  Category,
  Client,
  CommissionReport,
  DashboardSummary,
  Deal,
  DeviceSession,
  FinanceReport,
  Agreement,
  AgreementTemplate,
  Transaction,
  TransactionCategory,
  FileAsset,
  FollowUp,
  Match,
  Member,
  MyDay,
  Note,
  Owner,
  Property,
  Session,
  LeadReport,
  Verification,
  SavedView,
  Lease,
  InstallmentPlan,
  WebsiteSettings,
  Inquiry,
  Campaign,
  CampaignReport,
  PortalLinkInfo,
  WhatsAppStatus,
  CashFlowReport,
  AgingReport,
  AgentStatement,
  RentRoll,
  InventoryReport,
  ImportResult,
  SubscriptionInfo,
  PlatformBusiness,
  Settings,
  User,
} from './types';
import type { Entitlements } from '@recrm/shared';

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

export const branchApi = {
  list: (includeArchived = false) => api<Branch[]>({ url: '/branches', params: includeArchived ? { includeArchived: true } : undefined }),
  create: (body: Body) => api<Branch>({ method: 'POST', url: '/branches', data: body }),
  update: (id: string, body: Body) => api<Branch>({ method: 'PATCH', url: `/branches/${id}`, data: body }),
};

export const dealApi = {
  list: (params: Params) => apiPage<Deal>('/deals', params),
  get: (id: string) => api<Deal & { summary: NonNullable<Deal['summary']> }>({ url: `/deals/${id}` }),
  create: (body: Body) => api<Deal>({ method: 'POST', url: '/deals', data: body }),
  update: (id: string, body: Body) => api<Deal>({ method: 'PATCH', url: `/deals/${id}`, data: body }),
  stage: (id: string, body: Body) => api<Deal>({ method: 'POST', url: `/deals/${id}/stage`, data: body }),
  addPayment: (id: string, body: Body) => api<Deal>({ method: 'POST', url: `/deals/${id}/payments`, data: body }),
  removePayment: (id: string, paymentId: string) => api<Deal>({ method: 'DELETE', url: `/deals/${id}/payments/${paymentId}` }),
  addPayout: (id: string, body: Body) => api<Deal>({ method: 'POST', url: `/deals/${id}/payouts`, data: body }),
  updatePayout: (id: string, payoutId: string, body: Body) => api<Deal>({ method: 'PATCH', url: `/deals/${id}/payouts/${payoutId}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/deals/${id}` }),
  addOffer: (id: string, body: Body) => api<Deal>({ method: 'POST', url: `/deals/${id}/offers`, data: body }),
  respondOffer: (id: string, offerId: string, status: 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN') => api<Deal>({ method: 'POST', url: `/deals/${id}/offers/${offerId}/respond`, data: { status } }),
  approveCommission: (id: string) => api<Deal>({ method: 'POST', url: `/deals/${id}/commission/approve` }),
  payExternal: (id: string, shareId: string, amount: number) => api<Deal>({ method: 'POST', url: `/deals/${id}/external/${shareId}/pay`, data: { amount } }),
  decideApproval: (id: string, decision: 'APPROVED' | 'REJECTED', note?: string) => api<Deal>({ method: 'POST', url: `/deals/${id}/approval`, data: { decision, ...(note ? { note } : {}) } }),
  setChecklist: (id: string, key: string, done: boolean, label?: string) => api<Deal>({ method: 'POST', url: `/deals/${id}/checklist`, data: clean({ key, done, label }) }),
  report: (params: Params) => api<CommissionReport>({ url: '/reports/commissions', params: clean(params) }),
};

export const brochureApi = {
  text: (id: string, params: Params) => api<{ text: string; whatsappUrl: string }>({ url: `/properties/${id}/brochure`, params: clean({ ...params, format: 'text' }) }),
  /** Downloads the PDF / PNG through the authenticated client. */
  async download(id: string, params: Params & { format: 'pdf' | 'png' }) {
    try {
      const r = await http.get<Blob>(`/properties/${id}/brochure`, { params: clean(params), responseType: 'blob', timeout: 2 * 60_000 });
      const name = /filename="([^"]+)"/.exec(String(r.headers['content-disposition']))?.[1] ?? `brochure.${params.format}`;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      throw toApiError(e);
    }
  },
};

export const agreementApi = {
  list: (params: Params) => apiPage<Agreement>('/agreements', params),
  get: (id: string) => api<Agreement>({ url: `/agreements/${id}` }),
  create: (body: Body) => api<Agreement>({ method: 'POST', url: '/agreements', data: body }),
  update: (id: string, body: Body) => api<Agreement>({ method: 'PATCH', url: `/agreements/${id}`, data: body }),
  render: (id: string, body: Body = {}) => api<Agreement>({ method: 'POST', url: `/agreements/${id}/render`, data: body }),
  addVersion: (id: string, body: string) => api<Agreement>({ method: 'POST', url: `/agreements/${id}/versions`, data: { body } }),
  status: (id: string, body: Body) => api<Agreement>({ method: 'POST', url: `/agreements/${id}/status`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/agreements/${id}` }),
  templates: (params: Params = {}) => api<AgreementTemplate[]>({ url: '/agreement-templates', params: clean(params) }),
  createTemplate: (body: Body) => api<AgreementTemplate>({ method: 'POST', url: '/agreement-templates', data: body }),
  updateTemplate: (id: string, body: Body) => api<AgreementTemplate>({ method: 'PATCH', url: `/agreement-templates/${id}`, data: body }),
  /** Fetches the PDF through the authenticated client and opens it in a new tab. */
  async openPdf(id: string, version?: number) {
    // Open the tab during the click (a window opened after an await is blocked as a popup).
    const tab = window.open('', '_blank');
    try {
      const r = await http.get<Blob>(`/agreements/${id}/pdf`, { params: clean({ version }), responseType: 'blob', timeout: 60_000 });
      const name = /filename="([^"]+)"/.exec(String(r.headers['content-disposition']))?.[1] ?? 'agreement.pdf';
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        // Popups blocked entirely: download instead.
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      throw toApiError(e);
    }
  },
};

export const transactionApi = {
  list: (params: Params) => apiPage<Transaction>('/transactions', params),
  get: (id: string) => api<Transaction>({ url: `/transactions/${id}` }),
  create: (body: Body) => api<Transaction>({ method: 'POST', url: '/transactions', data: body }),
  update: (id: string, body: Body) => api<Transaction>({ method: 'PATCH', url: `/transactions/${id}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/transactions/${id}` }),
  categories: (includeArchived = false) => api<TransactionCategory[]>({ url: '/transaction-categories', params: includeArchived ? { includeArchived: true } : undefined }),
  createCategory: (body: Body) => api<TransactionCategory>({ method: 'POST', url: '/transaction-categories', data: body }),
  updateCategory: (id: string, body: Body) => api<TransactionCategory>({ method: 'PATCH', url: `/transaction-categories/${id}`, data: body }),
  report: (params: Params) => api<FinanceReport>({ url: '/reports/finance', params: clean(params) }),
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
  assign: (id: string, userId: string | null, note?: string) => api<Client>({ method: 'POST', url: `/clients/${id}/assign`, data: { userId, ...(note ? { note } : {}) } }),
  leadReport: (params: Params) => api<LeadReport>({ url: '/reports/leads', params: clean(params) }),
  async importExcel(file: File, opts: { assignedTo?: string; source?: string } = {}) {
    const form = new FormData();
    form.append('file', file);
    if (opts.assignedTo) form.append('assignedTo', opts.assignedTo);
    if (opts.source) form.append('source', opts.source);
    try {
      const r = await http.post<{ data: ImportResult }>('/clients/import', form, { timeout: 5 * 60_000 });
      return r.data.data;
    } catch (e) {
      throw toApiError(e);
    }
  },
  async downloadTemplate() {
    try {
      const r = await http.get<Blob>('/clients/import/template', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dalliqo-leads-template.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      throw toApiError(e);
    }
  },
};

async function blobDownload(url: string, fileName: string) {
  try {
    const r = await http.get<Blob>(url, { responseType: 'blob' });
    const href = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (e) {
    throw toApiError(e);
  }
}

export const verificationApi = {
  get: (id: string) => api<Verification>({ url: `/properties/${id}/verification` }),
  submit: (id: string, note?: string) => api<Property>({ method: 'POST', url: `/properties/${id}/verification/submit`, data: clean({ note }) ?? {} }),
  assign: (id: string, userId: string) => api<Property>({ method: 'POST', url: `/properties/${id}/verification/assign`, data: { userId } }),
  checklist: (id: string, key: string, done: boolean) => api<Property>({ method: 'POST', url: `/properties/${id}/verification/checklist`, data: { key, done } }),
  decide: (id: string, body: Body) => api<Property>({ method: 'POST', url: `/properties/${id}/verification/decide`, data: clean(body) }),
  queue: (params: Params) => apiPage<Property>('/verifications', params),
};

export const inventoryApi = {
  async importProperties(file: File, opts: { agentId?: string } = {}) {
    const form = new FormData();
    form.append('file', file);
    if (opts.agentId) form.append('agentId', opts.agentId);
    try {
      const r = await http.post<{ data: ImportResult }>('/properties/import', form, { timeout: 5 * 60_000 });
      return r.data.data;
    } catch (e) {
      throw toApiError(e);
    }
  },
  downloadTemplate: () => blobDownload('/properties/import/template', 'dalliqo-properties-template.xlsx'),
  async qrObjectUrl(id: string) {
    try {
      const r = await http.get<Blob>(`/properties/${id}/qr`, { responseType: 'blob' });
      return URL.createObjectURL(r.data);
    } catch (e) {
      throw toApiError(e);
    }
  },
  views: (page: string) => api<SavedView[]>({ url: '/saved-views', params: { page } }),
  createView: (body: Body) => api<SavedView>({ method: 'POST', url: '/saved-views', data: body }),
  removeView: (id: string) => api<null>({ method: 'DELETE', url: `/saved-views/${id}` }),
};

export const aiApi = {
  status: () => api<{ configured: boolean; model: string | null; usedThisMonth: number; monthlyLimit: number; tools: string[] }>({ url: '/ai/status' }),
  assistant: (messages: { role: 'user' | 'assistant'; content: string }[]) => api<{ answer: string; toolsUsed: string[]; proposals?: unknown[] }>({ method: 'POST', url: '/ai/assistant', data: { messages }, timeout: 180_000 }),
  describe: (propertyId: string, language: 'en' | 'ur') => api<{ headline: string; description: string; source: 'ai' | 'template' }>({ method: 'POST', url: `/ai/properties/${propertyId}/description`, data: { language }, timeout: 120_000 }),
  priceEstimate: (propertyId: string) => api<{ low?: number; mid?: number | null; high?: number; perSqft?: number; comparables: number; sold?: number; confidence?: 'LOW' | 'MEDIUM' | 'HIGH'; scope?: string; position?: 'ABOVE' | 'BELOW' | 'WITHIN'; askingPrice?: number; disclaimer: string }>({ url: `/ai/properties/${propertyId}/price-estimate` }),
  brief: (clientId: string, language: 'en' | 'ur') => api<{ summary: string; nextAction: string; message: string; risks: string[]; source: 'ai' | 'rules' }>({ method: 'POST', url: `/ai/clients/${clientId}/brief`, data: { language }, timeout: 120_000 }),
  forecast: () => api<{ months: { month: string; weighted: number; bestCase: number; deals: number; installments: number; rent: number }[]; totals: { weightedCommission: number; bestCaseCommission: number; installments: number; rent: number }; leads: { month: string; created: number; won: number }[]; expectedLeadsNextMonth: number; method: string }>({ url: '/ai/forecast' }),
};

export const websiteApi = {
  get: () => api<WebsiteSettings>({ url: '/website' }),
  update: (body: Body) => api<WebsiteSettings>({ method: 'PUT', url: '/website', data: body }),
  publish: (propertyId: string, body: Body) => api<Property>({ method: 'POST', url: `/properties/${propertyId}/publish`, data: body }),
};

export const inquiryApi = {
  list: (params: Params) => apiPage<Inquiry>('/inquiries', params),
  setStatus: (id: string, status: string) => api<Inquiry>({ method: 'PATCH', url: `/inquiries/${id}`, data: { status } }),
};

export const campaignApi = {
  list: (params: Params) => apiPage<Campaign>('/campaigns', params),
  get: (id: string) => api<Campaign>({ url: `/campaigns/${id}` }),
  create: (body: Body) => api<Campaign>({ method: 'POST', url: '/campaigns', data: clean(body) }),
  update: (id: string, body: Body) => api<Campaign>({ method: 'PATCH', url: `/campaigns/${id}`, data: body }),
  remove: (id: string) => api<null>({ method: 'DELETE', url: `/campaigns/${id}` }),
  report: () => api<CampaignReport>({ url: '/reports/campaigns' }),
};

export const portalApi = {
  create: (body: Body) => api<{ _id: string; url: string; expiresAt: string; phone?: string | null }>({ method: 'POST', url: '/portal-links', data: body }),
  list: (kind: string, partyId: string) => api<PortalLinkInfo[]>({ url: '/portal-links', params: { kind, partyId } }),
  revoke: (id: string) => api<PortalLinkInfo>({ method: 'DELETE', url: `/portal-links/${id}` }),
};

export const whatsappApi = {
  status: () => api<WhatsAppStatus>({ url: '/whatsapp' }),
  update: (body: Body) => api<WhatsAppStatus>({ method: 'PUT', url: '/whatsapp', data: body }),
  send: (body: Body) => api<{ mode: 'link'; url: string } | { mode: 'cloud'; messageId: string | null }>({ method: 'POST', url: '/whatsapp/send', data: body }),
  syncTemplates: () => api<WhatsAppStatus>({ method: 'POST', url: '/whatsapp/templates/sync' }),
};

export const installmentApi = {
  list: (params: Params) => apiPage<InstallmentPlan>('/installments', params),
  get: (id: string) => api<InstallmentPlan>({ url: `/installments/${id}` }),
  create: (body: Body) => api<InstallmentPlan>({ method: 'POST', url: '/installments', data: clean(body) }),
  pay: (id: string, body: Body) => api<InstallmentPlan>({ method: 'POST', url: `/installments/${id}/payments`, data: clean(body) }),
  cancel: (id: string, reason: string) => api<InstallmentPlan>({ method: 'POST', url: `/installments/${id}/cancel`, data: { reason } }),
};

export const financeReportApi = {
  cashFlow: (params: Params) => api<CashFlowReport>({ url: '/reports/cash-flow', params: clean(params) }),
  aging: () => api<AgingReport>({ url: '/reports/aging' }),
  agentStatement: (params: Params) => api<AgentStatement>({ url: '/reports/agent-statement', params: clean(params) }),
  agentStatementPdf: (userId: string) => blobDownload(`/reports/agent-statement?userId=${encodeURIComponent(userId)}&format=pdf`, 'commission-statement.pdf'),
};

export const receiptApi = {
  download: (kind: 'lease' | 'installment' | 'deal', id: string, paymentId: string) => blobDownload(`/receipts/${kind}/${id}/${paymentId}`, `receipt-${paymentId.slice(0, 8)}.pdf`),
};

export const leaseApi = {
  list: (params: Params) => apiPage<Lease>('/leases', params),
  get: (id: string) => api<Lease>({ url: `/leases/${id}` }),
  create: (body: Body) => api<Lease>({ method: 'POST', url: '/leases', data: clean(body) }),
  pay: (id: string, body: Body) => api<Lease>({ method: 'POST', url: `/leases/${id}/payments`, data: clean(body) }),
  waive: (id: string, itemId: string, reason: string) => api<Lease>({ method: 'POST', url: `/leases/${id}/waive`, data: { itemId, reason } }),
  inspect: (id: string, body: Body) => api<Lease>({ method: 'POST', url: `/leases/${id}/inspections`, data: clean(body) }),
  renew: (id: string, body: Body) => api<Lease>({ method: 'POST', url: `/leases/${id}/renew`, data: body }),
  end: (id: string, body: Body) => api<Lease>({ method: 'POST', url: `/leases/${id}/end`, data: clean(body) }),
  rentRoll: () => api<RentRoll>({ url: '/leases/rent-roll' }),
};

export const subscriptionApi = {
  get: () => api<SubscriptionInfo>({ url: '/subscription' }),
  request: (plan: string, cycle: string, note?: string) => api<SubscriptionInfo>({ method: 'POST', url: '/subscription/request', data: clean({ plan, cycle, note }) }),
  businesses: (params: Params) => apiPage<PlatformBusiness>('/platform/businesses', params),
  setSubscription: (id: string, body: Body) => api<Entitlements>({ method: 'PATCH', url: `/platform/businesses/${id}/subscription`, data: body }),
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
  duplicates: (params: Params) => api<{ _id: string; propertyId: string; status: string; askingPrice: number }[]>({ url: '/properties/duplicates', params: clean(params) }),
  inventoryReport: () => api<InventoryReport>({ url: '/reports/inventory' }),
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
  async upload(fields: { entityType: string; entityId: string; category: string; fileName?: string; expiresAt?: string }, file: File, onProgress?: (p: number) => void) {
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
  team: () => api<{ rows: { userId: string; fullName: string; role: string; leads: number; hotLeads: number; overdueFollowUps: number; followUpsDoneThisWeek: number; openDeals: number; wonThisMonth: number; commissionThisMonth: number }[]; totals: Record<string, number> }>({ url: '/dashboard/team' }),
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

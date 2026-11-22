import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

/** Which agency this web address belongs to (SaaS mode: agency.<base domain>). */
export interface TenantInfo {
  /** The domain agencies live under, or null when the system runs on one shared address. */
  baseDomain: string | null;
  /** The subdomain in the address bar (null on the shared address). */
  subdomain: string | null;
  /** The agency at this subdomain; null on the shared address or when no agency uses it. */
  tenant: { name: string; subdomain: string; url: string } | null;
}

export const tenantApi = {
  get: () => api<TenantInfo>({ url: '/public/tenant' }),
};

export function useTenantInfo() {
  return useQuery({ queryKey: ['public-tenant'], queryFn: tenantApi.get, staleTime: Infinity, retry: false });
}

/** "Yousuf Estate & Builders" → "yousuf-estate-builders" (same rule as the server). */
export function suggestSubdomain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
}

/** https://<sub>.<base> with the scheme of the current page. */
export function agencyUrl(subdomain: string, baseDomain: string): string {
  return `${window.location.protocol}//${subdomain}.${baseDomain}`;
}

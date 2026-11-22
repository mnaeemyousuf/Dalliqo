import { Business } from '../models/Business';
import { slugifySubdomain, subdomainProblem, tenantService } from '../services/tenantService';

/** SaaS addresses: businesses created before subdomains get one from their website slug or name. */
export async function migrateSubdomains(): Promise<{ assigned: number }> {
  const missing = await Business.find({ $or: [{ subdomain: null }, { subdomain: { $exists: false } }] }).select('name website').lean<{ _id: never; name: string; website?: { slug?: string | null } }[]>();
  let assigned = 0;
  for (const b of missing) {
    const slug = b.website?.slug ? slugifySubdomain(b.website.slug) : null;
    const wanted = slug && !subdomainProblem(slug) && !(await Business.exists({ subdomain: slug })) ? slug : undefined;
    const subdomain = await tenantService.claim(wanted, b.name);
    await Business.updateOne({ _id: b._id, $or: [{ subdomain: null }, { subdomain: { $exists: false } }] }, { $set: { subdomain } });
    assigned++;
  }
  return { assigned };
}

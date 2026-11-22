import type { AuthContext } from './context';
import type { Tenant } from '../services/tenantService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** The agency whose subdomain this request came to (SaaS mode); undefined on the shared address. */
      tenant?: Tenant;
    }
  }
}

export {};

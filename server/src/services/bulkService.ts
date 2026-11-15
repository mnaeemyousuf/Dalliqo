import { CLIENT_STATUSES, ERROR_CODES, PERMISSIONS, PROPERTY_STATUSES, type ClientStatus, type Permission, type PropertyStatus } from '@recrm/shared';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, RequestMeta } from '../types/context';
import { AppError, badRequest, forbidden } from '../utils/AppError';
import { clientService } from './clientService';
import { propertyService } from './propertyService';

export type BulkClientAction = { action: 'ASSIGN'; assignedTo: string } | { action: 'STATUS'; status: ClientStatus } | { action: 'DELETE' };
export type BulkPropertyAction = { action: 'ASSIGN'; agentIds: string[] } | { action: 'STATUS'; status: PropertyStatus; reason?: string } | { action: 'DELETE' };

export interface BulkResult {
  done: number;
  failed: { id: string; message: string }[];
}

/**
 * Applies one change to many records through the normal single-record services, so every
 * permission check, branch scope, audit entry and re-match runs exactly as it does for one
 * record. A record that fails (not found, not allowed) is reported and the rest continue.
 */
async function each(ids: string[], run: (id: string) => Promise<unknown>): Promise<BulkResult> {
  const out: BulkResult = { done: 0, failed: [] };
  for (const id of [...new Set(ids)]) {
    try {
      await run(id);
      out.done += 1;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      out.failed.push({ id, message: err.message });
    }
  }
  return out;
}

const need = (auth: AuthContext, p: Permission) => {
  if (!auth.permissions.includes(p)) throw forbidden();
};

export const bulkService = {
  async clients(auth: AuthContext, ids: string[], input: BulkClientAction, meta: RequestMeta = {}): Promise<BulkResult> {
    if (input.action === 'DELETE') {
      need(auth, PERMISSIONS.CLIENTS_DELETE);
      return each(ids, (id) => clientService.remove(auth, id, { meta }));
    }
    need(auth, PERMISSIONS.CLIENTS_UPDATE);
    if (input.action === 'ASSIGN') {
      if (!(await memberRepository.isActiveMemberUser(auth, input.assignedTo))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Choose an active team member');
      return each(ids, (id) => clientService.update(auth, id, { assignedTo: input.assignedTo } as never, { meta }));
    }
    if (!CLIENT_STATUSES.includes(input.status)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Unknown status');
    return each(ids, (id) => clientService.update(auth, id, { status: input.status } as never, { meta }));
  },

  async properties(auth: AuthContext, ids: string[], input: BulkPropertyAction, meta: RequestMeta = {}): Promise<BulkResult> {
    if (input.action === 'DELETE') {
      need(auth, PERMISSIONS.PROPERTIES_DELETE);
      return each(ids, (id) => propertyService.remove(auth, id, { meta }));
    }
    need(auth, PERMISSIONS.PROPERTIES_UPDATE);
    if (input.action === 'ASSIGN') {
      for (const uid of input.agentIds) {
        if (!(await memberRepository.isActiveMemberUser(auth, uid))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Choose active team members');
      }
      return each(ids, (id) => propertyService.update(auth, id, { agentIds: input.agentIds } as never, { meta }));
    }
    if (!PROPERTY_STATUSES.includes(input.status)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Unknown status');
    return each(ids, (id) => propertyService.changeStatus(auth, id, input.status, input.reason, { meta }));
  },
};

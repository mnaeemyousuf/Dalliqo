import { createHash, randomBytes } from 'node:crypto';
import { API_KEY_PATHS, API_KEY_PERMISSIONS, API_KEY_PREFIX, ERROR_CODES, MAX_API_KEYS, ROLES, resolvePermissions, type Permission } from '@recrm/shared';
import { ApiKey, type ApiKeyDoc } from '../models/ApiKey';
import { memberRepository } from '../repositories/memberRepository';
import { userRepository } from '../repositories/userRepository';
import type { AuthContext, RequestMeta } from '../types/context';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/AppError';
import { auditService } from './auditService';
import { subscriptionService } from './subscriptionService';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const view = (k: ApiKeyDoc) => ({
  _id: k._id,
  name: k.name,
  prefix: k.prefix,
  permissions: k.permissions,
  expiresAt: k.expiresAt ?? null,
  lastUsedAt: k.lastUsedAt ?? null,
  revokedAt: k.revokedAt ?? null,
  createdBy: k.createdBy,
  createdAt: k.createdAt,
});

export const isApiKey = (token: string) => token.startsWith(API_KEY_PREFIX);

export const apiKeyService = {
  async list(auth: AuthContext) {
    const rows = await ApiKey.find({ businessId: auth.businessId }).sort({ createdAt: -1 }).lean<ApiKeyDoc[]>();
    return rows.map(view);
  },

  /** Creates a key for the caller. The secret is returned once and never stored. */
  async create(auth: AuthContext, input: { name: string; permissions: Permission[]; expiresAt?: Date | null }, meta: RequestMeta = {}) {
    const perms = [...new Set(input.permissions)];
    if (!perms.length) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Choose at least one permission for the key');
    if (perms.some((p) => !API_KEY_PERMISSIONS.includes(p))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'That permission cannot be given to an API key');
    if (perms.some((p) => !auth.permissions.includes(p))) throw forbidden(ERROR_CODES.FORBIDDEN, 'A key cannot have a permission you do not have yourself');
    if (input.expiresAt && input.expiresAt <= new Date()) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The expiry date must be in the future');
    const active = await ApiKey.countDocuments({ businessId: auth.businessId, revokedAt: null });
    if (active >= MAX_API_KEYS) throw badRequest(ERROR_CODES.PLAN_LIMIT_REACHED, `A business can have up to ${MAX_API_KEYS} active API keys. Revoke one first.`);
    const secret = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
    const doc = await ApiKey.create({
      businessId: auth.businessId,
      name: input.name,
      prefix: secret.slice(0, API_KEY_PREFIX.length + 6),
      hash: sha(secret),
      permissions: perms,
      memberId: auth.memberId,
      userId: auth.userId,
      expiresAt: input.expiresAt ?? null,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    await auditService.record(auth, { action: 'api_key.created', entityType: 'apiKey', entityId: doc._id, entityLabel: doc.name, meta: { permissions: perms }, ip: meta.ip });
    return { ...view(doc.toObject()), secret };
  },

  async revoke(auth: AuthContext, id: string, meta: RequestMeta = {}) {
    const doc = await ApiKey.findOneAndUpdate({ businessId: auth.businessId, _id: id, revokedAt: null }, { $set: { revokedAt: new Date(), updatedBy: auth.userId } }, { new: true }).lean<ApiKeyDoc>();
    if (!doc) throw notFound(ERROR_CODES.NOT_FOUND, 'API key not found');
    await auditService.record(auth, { action: 'api_key.revoked', entityType: 'apiKey', entityId: doc._id, entityLabel: doc.name, ip: meta.ip });
    return view(doc);
  },

  /**
   * Identity for a request made with a key: the creating member's branch scope, and the key's
   * permissions limited to what that member still holds. Fails when the key is revoked or
   * expired, the member left, the plan no longer includes API access, or the path is off-limits.
   */
  async resolve(secret: string, path: string): Promise<AuthContext> {
    const denied = () => unauthorized(ERROR_CODES.INVALID_TOKEN, 'Invalid or revoked API key');
    // Cross-tenant by design: the key itself identifies the business.
    const key = await ApiKey.findOne({ hash: sha(secret) }).setOptions({ skipTenantGuard: true }).lean<ApiKeyDoc>();
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) throw denied();
    const businessId = key.businessId.toString();
    const userId = key.userId.toString();
    const [member, user] = await Promise.all([memberRepository.findActiveForAuth(businessId, key.memberId.toString(), userId), userRepository.findById(userId)]);
    if (!member || !user || user.status !== 'ACTIVE') throw denied();
    await subscriptionService.assertModule({ businessId, userId }, 'api');
    if (!API_KEY_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) throw forbidden(ERROR_CODES.FORBIDDEN, 'API keys cannot call this endpoint');
    const held = resolvePermissions(member.role, member.permissions);
    const restricted = member.role !== ROLES.OWNER && member.branchAccess === 'SELECTED';
    const allowed = restricted ? (member.branchIds ?? []).map(String) : undefined;
    // "Last used" is stamped at most once a minute per key.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      void ApiKey.updateOne({ businessId: key.businessId, _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return {
      userId,
      businessId,
      memberId: key.memberId.toString(),
      sessionId: `apikey:${key._id.toString()}`,
      role: member.role,
      permissions: (key.permissions as Permission[]).filter((p) => held.includes(p) && API_KEY_PERMISSIONS.includes(p)),
      mustChangePassword: false,
      branchIds: allowed,
      allowedBranchIds: allowed,
    };
  },
};

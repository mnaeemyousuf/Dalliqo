import { Schema, type Aggregate, type MongooseQueryMiddleware, type Query } from 'mongoose';

/**
 * Fields every business-owned document carries. Spread into a schema
 * definition; timestamps come from the schema's `timestamps: true` option.
 */
export const tenantFields = {
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
} as const;

const GUARDED_QUERY_OPS: MongooseQueryMiddleware[] = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
];

export class TenantGuardError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant guard: ${op} on ${model} must filter by businessId`);
    this.name = 'TenantGuardError';
  }
}

/**
 * Defence in depth for multi-tenancy: any query on a tenant collection that
 * does not filter by businessId throws before reaching MongoDB. Repositories
 * always pass businessId; the rare legitimate cross-tenant lookup (e.g. "which
 * businesses does this user belong to" at login) must opt out explicitly with
 * `.setOptions({ skipTenantGuard: true })`.
 */
export function tenantGuardPlugin(schema: Schema): void {
  schema.pre(GUARDED_QUERY_OPS, function (this: Query<unknown, unknown>) {
    const options = this.getOptions() as { skipTenantGuard?: boolean };
    if (options.skipTenantGuard) return;
    const filter = this.getFilter();
    if (!filter || filter.businessId === undefined || filter.businessId === null) {
      throw new TenantGuardError(this.model.modelName, (this as unknown as { op?: string }).op ?? 'query');
    }
  });

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const options = this.options as { skipTenantGuard?: boolean };
    if (options?.skipTenantGuard) return;
    const first = this.pipeline()[0] as { $match?: { businessId?: unknown } } | undefined;
    if (!first?.$match || first.$match.businessId === undefined || first.$match.businessId === null) {
      throw new TenantGuardError(this.model()?.modelName ?? 'unknown', 'aggregate');
    }
  });
}

/**
 * Populate options for references to tenant collections. The ids being
 * populated come from a document that was itself loaded with a businessId
 * filter, so the follow-up lookup by _id cannot cross tenants.
 */
export function scopedPopulate(path: string, select: string) {
  return { path, select, options: { skipTenantGuard: true } };
}

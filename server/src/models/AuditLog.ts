import { Schema, model, type Types } from 'mongoose';
import { tenantGuardPlugin } from './plugins/tenant';

/**
 * Append-only record of security-relevant and data-changing actions.
 * No update or delete path exists in the codebase.
 */
export interface AuditLogDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  action: string;
  entityType: string;
  entityId?: Types.ObjectId;
  entityLabel?: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  meta?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const schema = new Schema<AuditLogDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, immutable: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    entityLabel: { type: String },
    changes: {
      type: [{ _id: false, field: String, oldValue: Schema.Types.Mixed, newValue: Schema.Types.Mixed }],
      default: [],
    },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ businessId: 1, createdAt: -1 });
schema.index({ businessId: 1, entityType: 1, entityId: 1, createdAt: -1 });
schema.index({ businessId: 1, actorUserId: 1, createdAt: -1 });
schema.plugin(tenantGuardPlugin);

export const AuditLog = model<AuditLogDoc>('AuditLog', schema, 'auditLogs');

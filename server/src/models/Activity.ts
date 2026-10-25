import { Schema, model, type Types } from 'mongoose';
import { ACTIVITY_TYPES, ENTITY_TYPES, type ActivityType, type EntityType } from '@recrm/shared';
import { tenantGuardPlugin } from './plugins/tenant';

/**
 * Human-readable business timeline (the audit log is the security record).
 * `refs` lets one activity appear on several timelines, e.g. a follow-up
 * completed for a client about a property shows on both.
 */
export interface ActivityDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  type: ActivityType;
  summary: string;
  refs: { entityType: EntityType; entityId: Types.ObjectId; label?: string }[];
  data?: Record<string, unknown>;
  actorUserId: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<ActivityDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, immutable: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    summary: { type: String, required: true, maxlength: 500 },
    refs: {
      type: [
        {
          _id: false,
          entityType: { type: String, enum: ENTITY_TYPES, required: true },
          entityId: { type: Schema.Types.ObjectId, required: true },
          label: String,
        },
      ],
      default: [],
    },
    data: { type: Schema.Types.Mixed },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ businessId: 1, 'refs.entityId': 1, createdAt: -1 });
schema.index({ businessId: 1, createdAt: -1 });
schema.plugin(tenantGuardPlugin);

export const Activity = model<ActivityDoc>('Activity', schema, 'activities');

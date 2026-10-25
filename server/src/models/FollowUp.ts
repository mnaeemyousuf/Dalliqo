import { Schema, model, type Types } from 'mongoose';
import { FOLLOWUP_STATUSES, FOLLOWUP_TYPES, PRIORITIES, type FollowUpStatus, type FollowUpType, type Priority } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface FollowUpDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  clientId: Types.ObjectId;
  propertyId?: Types.ObjectId;
  type: FollowUpType;
  /** Due date+time as one UTC instant; shown in the business timezone. */
  dueAt: Date;
  priority: Priority;
  notes?: string;
  assignedTo: Types.ObjectId;
  /** OVERDUE is set by the overdue job for PENDING items whose dueAt has passed. */
  status: FollowUpStatus;
  reminderAt?: Date;
  reminderSentAt?: Date | null;
  completedAt?: Date | null;
  outcome?: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<FollowUpDoc>(
  {
    ...tenantFields,
    ...syncFields,
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    type: { type: String, enum: FOLLOWUP_TYPES, required: true },
    dueAt: { type: Date, required: true },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    notes: { type: String, maxlength: 2000 },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: FOLLOWUP_STATUSES, default: 'PENDING' },
    reminderAt: Date,
    reminderSentAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    outcome: { type: String, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, assignedTo: 1, status: 1, dueAt: 1 });
schema.index({ businessId: 1, clientId: 1, dueAt: -1 });
schema.index({ businessId: 1, propertyId: 1, dueAt: -1 });
schema.index({ businessId: 1, status: 1, dueAt: 1 });
// Cross-tenant job index (the reminder job opts out of the tenant guard).
schema.index({ status: 1, reminderAt: 1, reminderSentAt: 1 });
schema.plugin(tenantGuardPlugin);

export const FollowUp = model<FollowUpDoc>('FollowUp', schema, 'followUps');

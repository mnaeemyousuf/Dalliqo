import { Schema, model, type Types } from 'mongoose';
import { tenantGuardPlugin } from './plugins/tenant';

/** Idempotency ledger: a replayed offline mutation returns its stored result. */
export interface SyncRecordDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  mutationId: string;
  userId: Types.ObjectId;
  entity: string;
  entityUuid: string;
  op: 'create' | 'update' | 'delete';
  result: Record<string, unknown>;
  createdAt: Date;
}

const schema = new Schema<SyncRecordDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, required: true },
    mutationId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    entity: { type: String, required: true },
    entityUuid: { type: String, required: true },
    op: { type: String, enum: ['create', 'update', 'delete'], required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ businessId: 1, mutationId: 1 }, { unique: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
schema.plugin(tenantGuardPlugin);

export const SyncRecord = model<SyncRecordDoc>('SyncRecord', schema, 'syncRecords');

/** Lease lock so scheduled jobs run on one API instance at a time. */
interface JobLockDoc {
  _id: string;
  lockedUntil: Date;
  owner: string;
}
const lockSchema = new Schema<JobLockDoc>(
  { _id: { type: String, required: true }, lockedUntil: { type: Date, required: true }, owner: String },
  { versionKey: false },
);
export const JobLock = model<JobLockDoc>('JobLock', lockSchema, 'jobLocks');

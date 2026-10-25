import { Schema, model, type Types } from 'mongoose';
import { ALL_PERMISSIONS, ALL_ROLES, type Role } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface BusinessMemberDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  role: Role;
  /** Stored permissions. Ignored for OWNER, who always holds every permission. */
  permissions: string[];
  status: MemberStatus;
  joinedAt: Date;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const memberSchema = new Schema<BusinessMemberDoc>(
  {
    ...tenantFields,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    role: { type: String, enum: ALL_ROLES, required: true },
    permissions: { type: [{ type: String, enum: ALL_PERMISSIONS }], default: [] },
    status: { type: String, enum: MEMBER_STATUSES, default: 'ACTIVE' },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

memberSchema.index({ businessId: 1, userId: 1 }, { unique: true });
memberSchema.index({ businessId: 1, status: 1 });
memberSchema.index({ userId: 1, status: 1 });
memberSchema.plugin(tenantGuardPlugin);

export const BusinessMember = model<BusinessMemberDoc>('BusinessMember', memberSchema, 'businessMembers');

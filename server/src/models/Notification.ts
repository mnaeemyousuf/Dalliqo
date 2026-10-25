import { Schema, model, type Types } from 'mongoose';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@recrm/shared';
import { tenantGuardPlugin } from './plugins/tenant';

export interface NotificationDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  category: NotificationCategory;
  title: string;
  body: string;
  /** App route to open, e.g. /clients/<id>. */
  deepLink?: string;
  data?: Record<string, unknown>;
  readAt?: Date | null;
  pushedAt?: Date | null;
  createdAt: Date;
}

const schema = new Schema<NotificationDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 1000 },
    deepLink: String,
    data: Schema.Types.Mixed,
    readAt: { type: Date, default: null },
    pushedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ businessId: 1, userId: 1, readAt: 1, createdAt: -1 });
schema.index({ businessId: 1, userId: 1, category: 1, createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
schema.plugin(tenantGuardPlugin);

export const Notification = model<NotificationDoc>('Notification', schema, 'notifications');

export interface DeviceTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  businessId: Types.ObjectId;
  sessionId?: Types.ObjectId;
  token: string;
  platform: 'android' | 'ios' | 'web';
  createdAt: Date;
  updatedAt: Date;
}

const deviceSchema = new Schema<DeviceTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
    token: { type: String, required: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], required: true },
  },
  { timestamps: true, versionKey: false },
);
deviceSchema.index({ token: 1 }, { unique: true });
deviceSchema.index({ userId: 1 });
deviceSchema.index({ sessionId: 1 });

export const DeviceToken = model<DeviceTokenDoc>('DeviceToken', deviceSchema, 'deviceTokens');

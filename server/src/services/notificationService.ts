import { ERROR_CODES, SOCKET_EVENTS, type NotificationCategory } from '@recrm/shared';
import { logger } from '../config/logger';
import { Notification, type NotificationDoc } from '../models/Notification';
import type { TenantContext } from '../types/context';
import { notFound } from '../utils/AppError';
import { eventBus } from '../utils/eventBus';
import { pushService } from './pushService';

export interface NewNotification {
  userIds: string[];
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

export const notificationService = {
  /**
   * Stores one notification per recipient, notifies their open sockets and
   * sends an FCM push to their devices. Never throws into the caller.
   */
  async notify(ctx: TenantContext, n: NewNotification): Promise<void> {
    const userIds = Array.from(new Set(n.userIds));
    if (!userIds.length) return;
    try {
      const docs = await Notification.insertMany(
        userIds.map((userId) => ({
          businessId: ctx.businessId,
          userId,
          category: n.category,
          title: n.title,
          body: n.body,
          deepLink: n.deepLink,
          data: n.data,
        })),
      );
      for (const d of docs) {
        eventBus.publish({
          name: SOCKET_EVENTS.NOTIFICATION_CREATED,
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entity: 'notification',
          entityId: d._id.toString(),
          targetUserId: d.userId.toString(),
          data: { category: d.category, title: d.title, body: d.body, deepLink: d.deepLink },
        });
      }
      const delivered = await pushService.sendToUsers(userIds, {
        title: n.title,
        body: n.body,
        data: { category: n.category, deepLink: n.deepLink ?? '' },
      });
      if (delivered > 0) {
        await Notification.updateMany({ businessId: ctx.businessId, _id: { $in: docs.map((d) => d._id) } }, { $set: { pushedAt: new Date() } });
      }
    } catch (err) {
      logger.error({ err, category: n.category }, 'Failed to create notification');
    }
  },

  async list(ctx: TenantContext, q: { category?: NotificationCategory; unread?: boolean; page: number; limit: number }) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId, userId: ctx.userId };
    if (q.category) filter.category = q.category;
    if (q.unread) filter.readAt = null;
    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean<NotificationDoc[]>(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ businessId: ctx.businessId, userId: ctx.userId, readAt: null }),
    ]);
    return { items, total, unreadCount };
  },

  async markRead(ctx: TenantContext, id: string) {
    const res = await Notification.findOneAndUpdate(
      { _id: id, businessId: ctx.businessId, userId: ctx.userId },
      { $set: { readAt: new Date() } },
      { new: true },
    ).lean();
    if (!res) throw notFound(ERROR_CODES.NOTIFICATION_NOT_FOUND, 'Notification not found');
    return res;
  },

  async markAllRead(ctx: TenantContext, category?: NotificationCategory) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId, userId: ctx.userId, readAt: null };
    if (category) filter.category = category;
    const res = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
    return { updated: res.modifiedCount };
  },
};

import { ERROR_CODES, SOCKET_EVENTS, type NotificationCategory } from '@recrm/shared';
import { logger } from '../config/logger';
import { Notification, type NotificationDoc } from '../models/Notification';
import { Business } from '../models/Business';
import { User } from '../models/User';
import { env } from '../config/env';
import { mailService } from './mailService';
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
  /** At most one notification per user with this key (automation alerts). */
  dedupeKey?: string;
}

/** Email copies for members who switched them on (Profile → Notifications). Best effort. */
async function emailCopies(ctx: TenantContext, userIds: string[], n: NewNotification): Promise<void> {
  try {
    const users = await User.find({ _id: { $in: userIds }, status: 'ACTIVE', 'preferences.emailNotifications': true }).select('email fullName').lean();
    if (!users.length) return;
    const business = await Business.findById(ctx.businessId).select('name').lean();
    const link = n.deepLink ? `${env.APP_WEB_URL.replace(/\/$/, '')}${n.deepLink}` : env.APP_WEB_URL;
    await Promise.all(
      users.map((u) =>
        mailService.send({
          to: u.email,
          subject: `${n.title}${business ? ` — ${business.name}` : ''}`,
          text: `${n.body}\n\nOpen in Dalliqo: ${link}\n\nYou receive these emails because email notifications are on in your profile.`,
        }),
      ),
    );
  } catch (err) {
    logger.warn({ err }, 'Notification email failed');
  }
}

export const notificationService = {
  /**
   * Stores one notification per recipient, notifies their open sockets and
   * sends an FCM push to their devices. Never throws into the caller.
   */
  async notify(ctx: TenantContext, n: NewNotification): Promise<number> {
    let userIds = Array.from(new Set(n.userIds));
    if (n.dedupeKey && userIds.length) {
      const seen = await Notification.find({ businessId: ctx.businessId, userId: { $in: userIds }, dedupeKey: n.dedupeKey }).select('userId').lean();
      const already = new Set(seen.map((s) => s.userId.toString()));
      userIds = userIds.filter((u) => !already.has(u));
    }
    if (!userIds.length) return 0;
    // Lets phones that ring follow-up reminders themselves recognise this one as a duplicate.
    const followUpId = n.category === 'FOLLOWUP' && typeof n.data?.followUpId === 'string' ? n.data.followUpId : undefined;
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
          ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
        })),
        { ordered: false },
      );
      for (const d of docs) {
        eventBus.publish({
          name: SOCKET_EVENTS.NOTIFICATION_CREATED,
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entity: 'notification',
          entityId: d._id.toString(),
          targetUserId: d.userId.toString(),
          data: { category: d.category, title: d.title, body: d.body, deepLink: d.deepLink, ...(followUpId ? { followUpId } : {}) },
        });
      }
      const delivered = await pushService.sendToUsers(userIds, {
        title: n.title,
        body: n.body,
        data: { category: n.category, deepLink: n.deepLink ?? '', ...(followUpId ? { followUpId } : {}) },
        followUpId,
      });
      void emailCopies(ctx, userIds, n);
      if (delivered > 0) {
        await Notification.updateMany({ businessId: ctx.businessId, _id: { $in: docs.map((d) => d._id) } }, { $set: { pushedAt: new Date() } });
      }
      return docs.length;
    } catch (err) {
      // A concurrent run inserting the same de-duplicated alert is expected and harmless.
      if ((err as { code?: number }).code !== 11000) logger.error({ err, category: n.category }, 'Failed to create notification');
      return 0;
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

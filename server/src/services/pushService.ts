import { env } from '../config/env';
import { logger } from '../config/logger';
import { DeviceToken } from '../models/Notification';

type Messaging = import('firebase-admin/messaging').Messaging;

let messaging: Messaging | null | undefined;

/** Firebase Admin is initialised lazily, and only when credentials are configured. */
function getMessaging(): Messaging | null {
  if (messaging !== undefined) return messaging;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    logger.warn('Firebase credentials not configured; push notifications are disabled (in-app notifications still work)');
    messaging = null;
    return messaging;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initializeApp, cert, getApps } = require('firebase-admin/app') as typeof import('firebase-admin/app');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMessaging: gm } = require('firebase-admin/messaging') as typeof import('firebase-admin/messaging');
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  messaging = gm(app);
  return messaging;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
  /**
   * Set for follow-up reminders. Devices that schedule reminders locally get a data-only
   * message with this id, so the app can skip it when its own reminder already rang.
   */
  followUpId?: string;
}

/** Reminder pushes to devices that ring reminders locally are sent data-only (see PushMessage.followUpId). */
export function splitDevices<T extends { localReminders?: boolean; platform: string }>(devices: T[], message: PushMessage) {
  const dataOnly = message.followUpId ? devices.filter((d) => d.localReminders && d.platform !== 'web') : [];
  return { dataOnly, normal: devices.filter((d) => !dataOnly.includes(d)) };
}

export function dataOnlyMessage(tokens: string[], message: PushMessage) {
  return {
    tokens,
    data: {
      ...(message.data ?? {}),
      type: 'FOLLOWUP_REMINDER',
      followUpId: message.followUpId!,
      title: message.title,
      body: message.body,
    },
    android: { priority: 'high' as const },
    apns: { headers: { 'apns-priority': '10' }, payload: { aps: { contentAvailable: true } } },
  };
}

export const pushService = {
  get enabled(): boolean {
    return getMessaging() !== null;
  },

  async registerDevice(input: { userId: string; businessId: string; sessionId: string; token: string; platform: 'android' | 'ios' | 'web'; localReminders?: boolean }) {
    await DeviceToken.findOneAndUpdate({ token: input.token }, { $set: { ...input, localReminders: input.localReminders ?? false } }, { upsert: true });
  },

  async unregisterDevice(userId: string, token: string) {
    await DeviceToken.deleteOne({ userId, token });
  },

  async removeForSession(sessionId: string) {
    await DeviceToken.deleteMany({ sessionId });
  },

  /** Sends to every registered device of the users. Returns the number delivered. */
  async sendToUsers(userIds: string[], message: PushMessage): Promise<number> {
    const m = getMessaging();
    if (!m || userIds.length === 0) return 0;
    const devices = await DeviceToken.find({ userId: { $in: userIds } }).lean();
    if (devices.length === 0) return 0;
    const { dataOnly, normal } = splitDevices(devices, message);
    try {
      const results = await Promise.all([
        normal.length
          ? m.sendEachForMulticast({
              tokens: normal.map((d) => d.token),
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: { priority: 'high', notification: { channelId: 'crm_default' } },
              apns: { payload: { aps: { sound: 'default' } } },
            })
          : null,
        dataOnly.length ? m.sendEachForMulticast(dataOnlyMessage(dataOnly.map((d) => d.token), message)) : null,
      ]);
      // Drop tokens Firebase reports as no longer valid.
      const stale: string[] = [];
      results.forEach((res, k) => {
        const group = k === 0 ? normal : dataOnly;
        res?.responses.forEach((r, i) => {
          if (!r.success && r.error && /registration-token-not-registered|invalid-argument/.test(r.error.code)) stale.push(group[i].token);
        });
      });
      if (stale.length) await DeviceToken.deleteMany({ token: { $in: stale } });
      return results.reduce((n, r) => n + (r?.successCount ?? 0), 0);
    } catch (err) {
      logger.error({ err }, 'FCM send failed');
      return 0;
    }
  },
};

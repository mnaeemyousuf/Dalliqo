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
}

export const pushService = {
  get enabled(): boolean {
    return getMessaging() !== null;
  },

  async registerDevice(input: { userId: string; businessId: string; sessionId: string; token: string; platform: 'android' | 'ios' | 'web' }) {
    await DeviceToken.findOneAndUpdate({ token: input.token }, { $set: input }, { upsert: true });
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
    try {
      const res = await m.sendEachForMulticast({
        tokens: devices.map((d) => d.token),
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high', notification: { channelId: 'crm_default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      // Drop tokens Firebase reports as no longer valid.
      const stale = res.responses
        .map((r, i) => (!r.success && r.error && /registration-token-not-registered|invalid-argument/.test(r.error.code) ? devices[i].token : null))
        .filter((t): t is string => !!t);
      if (stale.length) await DeviceToken.deleteMany({ token: { $in: stale } });
      return res.successCount;
    } catch (err) {
      logger.error({ err }, 'FCM send failed');
      return 0;
    }
  },
};

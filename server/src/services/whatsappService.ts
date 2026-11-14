import { Types } from 'mongoose';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ERROR_CODES, whatsappLink } from '@recrm/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Business, type BusinessDoc } from '../models/Business';
import { Client } from '../models/Client';
import type { AuthContext, TenantContext } from '../types/context';
import { AppError, badRequest, notFound } from '../utils/AppError';
import { normalizePhone } from '../utils/phone';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { intakeLead } from './leadIntakeService';

/** Platform-level credentials present (the Meta app). */
export const whatsappPlatformReady = () => !!env.WHATSAPP_ACCESS_TOKEN;

interface InboundPayload {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: { id?: string; from?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
      };
    }[];
  }[];
}

export const whatsappService = {
  async status(ctx: TenantContext) {
    const b = await Business.findById(ctx.businessId).select('whatsapp').lean<BusinessDoc>();
    return {
      platformConfigured: whatsappPlatformReady(),
      webhookConfigured: !!(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
      phoneNumberId: b?.whatsapp?.phoneNumberId ?? null,
      displayNumber: b?.whatsapp?.displayNumber ?? null,
      mode: whatsappPlatformReady() && b?.whatsapp?.phoneNumberId ? 'cloud' : 'link',
    };
  },

  async updateSettings(auth: AuthContext, input: { phoneNumberId?: string | null; displayNumber?: string | null }) {
    if (input.phoneNumberId) {
      const taken = await Business.exists({ 'whatsapp.phoneNumberId': input.phoneNumberId, _id: { $ne: auth.businessId } });
      if (taken) throw badRequest(ERROR_CODES.DUPLICATE_KEY, 'This WhatsApp number is already connected to another business');
    }
    const set: Record<string, unknown> = {};
    if (input.phoneNumberId !== undefined) set['whatsapp.phoneNumberId'] = input.phoneNumberId || null;
    if (input.displayNumber !== undefined) set['whatsapp.displayNumber'] = input.displayNumber || null;
    await Business.updateOne({ _id: auth.businessId }, { $set: set });
    await auditService.record(auth, { action: 'whatsapp.settings_updated', entityType: 'business', entityId: new Types.ObjectId(auth.businessId) });
    return whatsappService.status(auth);
  },

  /**
   * Sends a text through the Cloud API when connected; otherwise returns a wa.me link for the user
   * to open (their own WhatsApp). Note: Meta only allows free-form text within 24 hours of the
   * customer's last message — outside that window an approved template is required, and Meta's
   * error is passed back to the user.
   */
  async send(auth: AuthContext, input: { to: string; text: string; clientId?: string }) {
    const to = normalizePhone(input.to) ?? input.to;
    const b = await Business.findById(auth.businessId).select('whatsapp').lean<BusinessDoc>();
    const client = input.clientId ? await Client.findOne({ businessId: auth.businessId, _id: input.clientId, deletedAt: null }).select('fullName').lean() : null;
    if (input.clientId && !client) throw notFound(ERROR_CODES.CLIENT_NOT_FOUND, 'Client not found');
    const record = async (via: string) => {
      if (client) await activityService.record(auth, 'WHATSAPP_SENT', `WhatsApp ${via} to ${client.fullName}: “${input.text.slice(0, 200)}”`, [{ entityType: 'client', entityId: client._id, label: client.fullName }]);
    };
    if (!whatsappPlatformReady() || !b?.whatsapp?.phoneNumberId) {
      await record('opened');
      return { mode: 'link' as const, url: whatsappLink(to, input.text) };
    }
    const res = await fetch(`${env.WHATSAPP_GRAPH_URL}/${env.WHATSAPP_API_VERSION}/${b.whatsapp.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g, ''), type: 'text', text: { preview_url: true, body: input.text } }),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) {
      logger.warn({ status: res.status, error: body.error }, 'WhatsApp send failed');
      throw new AppError(502, ERROR_CODES.INTEGRATION_NOT_CONFIGURED, `WhatsApp did not accept the message: ${body.error?.message ?? res.statusText}`, { fallbackUrl: whatsappLink(to, input.text) });
    }
    await record('sent');
    return { mode: 'cloud' as const, messageId: body.messages?.[0]?.id ?? null };
  },

  /** Meta's webhook verification handshake. */
  verify(q: Record<string, unknown>): string | null {
    if (q['hub.mode'] === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN) return String(q['hub.challenge'] ?? '');
    return null;
  },

  signatureValid(raw: Buffer | undefined, header: string | undefined): boolean {
    if (!env.WHATSAPP_APP_SECRET || !raw || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return expected.length === got.length && timingSafeEqual(expected, got);
  },

  /** Inbound messages become leads (or activity on the matching client). Returns messages handled. */
  async inbound(payload: InboundPayload): Promise<number> {
    let handled = 0;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        const pid = v?.metadata?.phone_number_id;
        if (!pid || !v?.messages?.length) continue;
        const business = await Business.findOne({ 'whatsapp.phoneNumberId': pid, status: 'ACTIVE' }).lean<BusinessDoc>();
        if (!business) continue;
        for (const m of v.messages) {
          if (!m.from) continue;
          const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? `WhatsApp +${m.from}`;
          const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type ?? 'message'}]`;
          try {
            await intakeLead(business, { channel: 'WHATSAPP', name, phone: `+${m.from}`, message: text.slice(0, 2000), externalId: m.id ?? null });
            handled++;
          } catch (err) {
            logger.error({ err }, 'WhatsApp inbound message could not be processed');
          }
        }
      }
    }
    return handled;
  },
};

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outbox used when SMTP is not configured (development and tests only —
 * production refuses to start without SMTP_HOST). Tests read reset links here.
 */
export const devOutbox: MailMessage[] = [];

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  if (!env.SMTP_HOST) return undefined;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE ?? false,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export const mailService = {
  async send(message: MailMessage): Promise<void> {
    const t = getTransporter();
    if (!t) {
      devOutbox.push(message);
      if (devOutbox.length > 100) devOutbox.shift();
      logger.info({ to: message.to, subject: message.subject }, 'SMTP not configured; message kept in dev outbox');
      if (env.NODE_ENV === 'development') logger.info(message.text);
      return;
    }
    await t.sendMail({ from: env.MAIL_FROM, ...message });
  },
};

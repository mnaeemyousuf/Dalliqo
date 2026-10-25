import { Types } from 'mongoose';
import { z } from 'zod';
import { normalizePhone } from '../utils/phone';

export const objectId = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v) && /^[a-f\d]{24}$/i.test(v), { message: 'Invalid id' });

export const idParams = z.object({ id: objectId });

export const email = z.string().trim().toLowerCase().email('Invalid email address').max(254);

/** Accepts local Pakistani or international formats; outputs E.164. */
export const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalised = normalizePhone(v);
    if (!normalised) {
      ctx.addIssue({ code: 'custom', message: 'Invalid mobile number' });
      return z.NEVER;
    }
    return normalised;
  });

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Password must contain letters and numbers' });

export const personName = z.string().trim().min(2, 'Name is too short').max(120);

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

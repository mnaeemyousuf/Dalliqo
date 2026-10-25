import { z } from 'zod';
import { SIZE_UNITS } from '@recrm/shared';
import { email, phone } from './common';

export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    phone: phone.optional(),
    email: email.optional(),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(100).optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    timezone: z
      .string()
      .trim()
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone')
      .optional(),
    defaultSizeUnit: z.enum(SIZE_UNITS).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

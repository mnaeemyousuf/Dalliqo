import { z } from 'zod';
import { LANGUAGES, THEMES } from '@recrm/shared';
import { email, objectId, password, personName, phone } from './common';

export const registerSchema = z.object({
  fullName: personName,
  email,
  password,
  mobileNumber: phone.optional(),
  businessName: z.string().trim().min(2, 'Business name is too short').max(150),
  deviceName: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  deviceName: z.string().trim().max(100).optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200).optional() });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const updateProfileSchema = z
  .object({
    fullName: personName.optional(),
    mobileNumber: phone.optional(),
    preferences: z
      .object({ language: z.enum(LANGUAGES).optional(), theme: z.enum(THEMES).optional() })
      .strict()
      .optional(),
  })
  .strict();

export const sessionIdParams = z.object({ id: objectId });

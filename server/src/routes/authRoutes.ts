import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authenticate, requirePasswordCurrent } from '../middleware/authenticate';
import { loginLimiter, passwordResetLimiter, refreshLimiter, registerLimiter } from '../middleware/rateLimiters';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/http';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdParams,
  updateProfileSchema,
} from '../validators/auth.schemas';

const r = Router();

// Public
r.post('/register', registerLimiter, validate({ body: registerSchema }), asyncHandler(authController.register));
r.post('/login', loginLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
r.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), asyncHandler(authController.refresh));
r.post('/logout', validate({ body: refreshSchema }), asyncHandler(authController.logout));
r.post('/forgot-password', passwordResetLimiter, validate({ body: forgotPasswordSchema }), asyncHandler(authController.forgotPassword));
r.post('/reset-password', passwordResetLimiter, validate({ body: resetPasswordSchema }), asyncHandler(authController.resetPassword));

// Authenticated — reachable even while a temporary password must be changed
r.get('/me', authenticate, asyncHandler(authController.me));
r.post('/change-password', authenticate, validate({ body: changePasswordSchema }), asyncHandler(authController.changePassword));
r.post('/logout-all', authenticate, asyncHandler(authController.logoutAll));

// Authenticated — normal access
r.patch('/me', authenticate, requirePasswordCurrent, validate({ body: updateProfileSchema }), asyncHandler(authController.updateProfile));
r.get('/sessions', authenticate, requirePasswordCurrent, asyncHandler(authController.listSessions));
r.delete('/sessions/:id', authenticate, requirePasswordCurrent, validate({ params: sessionIdParams }), asyncHandler(authController.revokeSession));

export default r;

import { Router } from 'express';
import {
  checkUsername,
  forgotPassword,
  login,
  logout,
  register,
  resendOtp,
  resetPassword,
  verifyOtp,
} from '../controllers/authController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { authRateLimiter } from '../middleware/rateLimit.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.get('/check-username', asyncHandler(checkUsername));
router.post('/register', authRateLimiter, asyncHandler(register));
router.post('/login', authRateLimiter, asyncHandler(login));
router.post('/verify-otp', authRateLimiter, asyncHandler(verifyOtp));
router.post('/resend-otp', authRateLimiter, asyncHandler(resendOtp));
router.post('/forgot-password', authRateLimiter, asyncHandler(forgotPassword));
router.post('/reset-password', authRateLimiter, asyncHandler(resetPassword));
router.post('/logout', requireAuth, asyncHandler(logout));

export default router;

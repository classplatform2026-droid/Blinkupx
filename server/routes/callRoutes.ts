import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  acceptCallHttp,
  declineCallHttp,
  deleteCallEntry,
  getActiveCall,
  getCallSession,
  getCallToken,
  listCallHistory,
} from '../controllers/callController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const callTokenRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'CALL_TOKEN_RATE_LIMITED',
    message: 'Too many call token requests. Please wait a moment.',
  },
});

const router = Router();

router.use(requireAuth);
router.post('/token', callTokenRateLimiter, asyncHandler(getCallToken));
router.get('/active', asyncHandler(getActiveCall));
router.get('/history', asyncHandler(listCallHistory));
router.get('/:callId', asyncHandler(getCallSession));
router.post('/:callId/accept', asyncHandler(acceptCallHttp));
router.post('/:callId/decline', asyncHandler(declineCallHttp));
router.delete('/:id', asyncHandler(deleteCallEntry));

export default router;
